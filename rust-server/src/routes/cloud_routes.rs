use std::convert::Infallible;
use std::time::Duration;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json, Response,
    },
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;
use tokio_stream::wrappers::BroadcastStream;

use crate::models::{CloudFile, CloudImage, SyncRequest};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SseQuery {
    pub client_id: Option<String>,
}

pub async fn get_cloud_data_handler(State(state): State<AppState>) -> Response {
    let (vault, is_mongo_connected) = state.store.get_vault_data().await;

    Json(json!({
        "ok": true,
        "data": {
            "tools": vault.tools,
            "notes": vault.notes,
            "media": vault.media,
            "settings": vault.settings,
            "version": vault.version,
            "updatedAt": vault.updated_at,
            "isMongoConnected": is_mongo_connected,
        }
    }))
    .into_response()
}

pub async fn post_cloud_sync_handler(
    State(state): State<AppState>,
    Json(payload): Json<SyncRequest>,
) -> Response {
    let (ok, version, updated_at) = state.store.save_vault_data(payload).await;
    Json(json!({
        "ok": ok,
        "version": version,
        "updatedAt": updated_at
    }))
    .into_response()
}

pub async fn sse_events_handler(
    State(state): State<AppState>,
    Query(query): Query<SseQuery>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let client_id = query.client_id.unwrap_or_else(|| {
        format!(
            "device-{}-{}",
            chrono::Utc::now().timestamp_millis(),
            &uuid::Uuid::new_v4().to_string()[..5]
        )
    });

    let (vault, _) = state.store.get_vault_data().await;
    let initial_event = Event::default()
        .event("connected")
        .data(json!({ "clientId": client_id, "version": vault.version }).to_string());

    let rx = state.store.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(move |item| {
        let this_client_id = client_id.clone();
        async move {
            match item {
                Ok(event) => {
                    if let Some(ref sender) = event.sender_client_id {
                        if sender == &this_client_id {
                            return None; // Skip echo to sender
                        }
                    }
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    Some(Ok(Event::default().event("vault_update").data(data)))
                }
                Err(_) => None,
            }
        }
    });

    let combined = futures_util::stream::once(async move { Ok(initial_event) }).chain(stream);

    Sse::new(combined).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(25))
            .text("heartbeat"),
    )
}

pub async fn get_storage_usage_handler(State(state): State<AppState>) -> Response {
    let usage = state.store.get_storage_usage().await;
    Json(usage).into_response()
}

pub async fn get_images_handler(State(state): State<AppState>) -> Response {
    let images = state.store.get_images().await;
    Json(json!({ "ok": true, "images": images })).into_response()
}

#[derive(Deserialize)]
pub struct SaveImagesPayload {
    pub images: Option<Vec<CloudImage>>,
}

pub async fn post_images_handler(
    State(state): State<AppState>,
    Json(payload): Json<SaveImagesPayload>,
) -> Response {
    let images = payload.images.unwrap_or_default();

    for img in &images {
        if img.id.is_empty() || img.data_url.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "ok": false, "error": "Invalid image payload" })),
            )
                .into_response();
        }
        if img.size > 10 * 1024 * 1024 {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({ "ok": false, "error": "Each image must be 10 MB or smaller." })),
            )
                .into_response();
        }
    }

    state.store.save_images(images).await;
    Json(json!({ "ok": true })).into_response()
}

pub async fn delete_image_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    state.store.delete_image(&id).await;
    Json(json!({ "ok": true })).into_response()
}

pub async fn get_files_handler(State(state): State<AppState>) -> Response {
    let files = state.store.get_files().await;
    Json(json!({ "ok": true, "files": files })).into_response()
}

#[derive(Deserialize)]
pub struct SaveFilesPayload {
    pub files: Option<Vec<CloudFile>>,
}

pub async fn post_files_handler(
    State(state): State<AppState>,
    Json(payload): Json<SaveFilesPayload>,
) -> Response {
    let files = payload.files.unwrap_or_default();

    for f in &files {
        if f.id.is_empty() || f.name.is_empty() || f.data_url.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "ok": false, "error": "Invalid file payload" })),
            )
                .into_response();
        }
        if f.size > 10 * 1024 * 1024 {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({ "ok": false, "error": "Each file must be 10 MB or smaller." })),
            )
                .into_response();
        }
    }

    state.store.save_files(files).await;
    Json(json!({ "ok": true })).into_response()
}

pub async fn delete_file_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    state.store.delete_file(&id).await;
    Json(json!({ "ok": true })).into_response()
}

pub async fn get_mongo_status_handler(State(state): State<AppState>) -> Response {
    let (is_connected, has_custom, masked_uri, storage_type) = state.store.get_mongo_status().await;
    Json(json!({
        "ok": true,
        "isMongoConnected": is_connected,
        "hasCustomMongo": has_custom,
        "mongoUriMasked": masked_uri,
        "storageType": storage_type
    }))
    .into_response()
}

#[derive(Deserialize)]
pub struct MongoConfigPayload {
    pub uri: Option<String>,
}

pub async fn post_mongo_config_handler(
    State(state): State<AppState>,
    Json(payload): Json<MongoConfigPayload>,
) -> Response {
    let Some(uri) = payload.uri else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "message": "MongoDB connection URI is required." })),
        )
            .into_response();
    };

    let (ok, message) = state.store.set_mongo_uri(uri).await;
    Json(json!({ "ok": ok, "message": message })).into_response()
}

pub async fn supabase_fallback_handler(
    State(state): State<AppState>,
    body: Option<Json<SyncRequest>>,
) -> Response {
    if let Some(Json(req)) = body {
        let (ok, version, updated_at) = state.store.save_vault_data(req).await;
        return Json(json!({ "ok": ok, "version": version, "updatedAt": updated_at })).into_response();
    }
    let (vault, is_connected) = state.store.get_vault_data().await;
    Json(json!({ "ok": true, "data": vault, "isMongoConnected": is_connected })).into_response()
}
