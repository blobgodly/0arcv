use axum::{
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct LoginPayload {
    pub password: Option<String>,
}

pub async fn login_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Option<Json<LoginPayload>>,
) -> Response {
    let client_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string());

    if !state.auth.allow_login_attempt(&client_ip).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "ok": false, "error": "Too many attempts. Try again later." })),
        )
            .into_response();
    }

    let password = payload
        .and_then(|p| p.password.clone())
        .unwrap_or_default();

    if !state.auth.verify_password(&password) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "error": "Invalid credentials" })),
        )
            .into_response();
    }

    let cookie = state.auth.create_session_cookie();

    let mut response = Json(json!({ "ok": true })).into_response();
    let res_headers = response.headers_mut();
    res_headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    if let Ok(cookie_val) = cookie.parse() {
        res_headers.insert(header::SET_COOKIE, cookie_val);
    }

    response
}

pub async fn logout_handler(State(state): State<AppState>) -> Response {
    let cookie = state.auth.clear_session_cookie();
    let mut response = Json(json!({ "ok": true })).into_response();
    let res_headers = response.headers_mut();
    res_headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    if let Ok(cookie_val) = cookie.parse() {
        res_headers.insert(header::SET_COOKIE, cookie_val);
    }
    response
}
