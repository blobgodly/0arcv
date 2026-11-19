pub mod auth_routes;
pub mod cloud_routes;
pub mod media_routes;
pub mod static_routes;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Json, Response},
    routing::{delete, get, post},
    Router,
};
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};
use tower_http::compression::CompressionLayer;

use crate::auth::PRIVATE_LOGIN_PAGE;
use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api_routes = Router::new()
        // Auth
        .route("/api/auth/login", post(auth_routes::login_handler))
        .route("/api/auth/logout", post(auth_routes::logout_handler))
        // IMDb & Media
        .route("/api/imdb/search", get(media_routes::imdb_search_handler))
        .route("/api/imdb/q", get(media_routes::imdb_search_handler))
        .route("/api/imdb/details", post(media_routes::imdb_details_handler))
        .route("/api/gemini/media-lookup", post(media_routes::gemini_lookup_handler))
        // Cloud Vault & Sync
        .route("/api/cloud/data", get(cloud_routes::get_cloud_data_handler))
        .route("/api/cloud/sync", post(cloud_routes::post_cloud_sync_handler))
        .route("/api/cloud/sync/events", get(cloud_routes::sse_events_handler))
        .route("/api/cloud/events", get(cloud_routes::sse_events_handler))
        .route("/api/cloud/storage-usage", get(cloud_routes::get_storage_usage_handler))
        .route("/api/cloud/mongo-status", get(cloud_routes::get_mongo_status_handler))
        .route("/api/cloud/mongo-config", post(cloud_routes::post_mongo_config_handler))
        // Images & Files
        .route("/api/cloud/images", get(cloud_routes::get_images_handler).post(cloud_routes::post_images_handler))
        .route("/api/cloud/images/{id}", delete(cloud_routes::delete_image_handler))
        .route("/api/cloud/files", get(cloud_routes::get_files_handler).post(cloud_routes::post_files_handler))
        .route("/api/cloud/files/{id}", delete(cloud_routes::delete_file_handler))
        // Supabase backwards compatibility fallback
        .route("/api/supabase/*path", post(cloud_routes::supabase_fallback_handler).get(cloud_routes::supabase_fallback_handler));

    Router::new()
        .merge(api_routes)
        .fallback(static_routes::spa_fallback_handler)
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .layer(middleware::from_fn_with_state(state.clone(), security_headers_middleware))
        .layer(CompressionLayer::new())
        .layer(cors)
        .with_state(state)
}

async fn auth_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path();

    // Skip auth check if authentication is not required or on login/logout paths
    if !state.auth.requires_auth() || path.starts_with("/api/auth/") {
        return next.run(req).await;
    }

    // Verify session cookie
    let cookie_header = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();

    if state.auth.verify_cookie(cookie_header) {
        return next.run(req).await;
    }

    // Unauthenticated: reject API requests with JSON 401, or serve login page for UI
    if path.starts_with("/api/") {
        return (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, "no-store")],
            Json(json!({ "ok": false, "error": "Authentication required" })),
        )
            .into_response();
    }

    (
        StatusCode::UNAUTHORIZED,
        [(header::CACHE_CONTROL, "no-store")],
        Html(PRIVATE_LOGIN_PAGE),
    )
        .into_response()
}

async fn security_headers_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    headers.insert(header::REFERRER_POLICY, "strict-origin-when-cross-origin".parse().unwrap());
    headers.insert(
        header::HeaderName::from_static("permissions-policy"),
        "camera=(), microphone=(), geolocation=()".parse().unwrap(),
    );

    if state.config.is_production {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            "max-age=63072000".parse().unwrap(),
        );
    }

    response
}
