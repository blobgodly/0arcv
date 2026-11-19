use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::json;

use crate::models::MediaKind;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

pub async fn imdb_search_handler(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Response {
    let q = query.q.unwrap_or_default().trim().to_string();
    if q.is_empty() {
        return Json(json!({ "results": [] })).into_response();
    }

    let results = state
        .media
        .search_imdb(&q, query.kind.as_deref())
        .await;

    Json(json!({ "results": results })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaDetailsPayload {
    pub title: Option<String>,
    pub year: Option<serde_json::Value>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub poster_url: Option<String>,
}

pub async fn imdb_details_handler(
    State(state): State<AppState>,
    Json(payload): Json<MediaDetailsPayload>,
) -> Response {
    let Some(title) = payload.title.filter(|s| !s.trim().is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Title is required" })),
        )
            .into_response();
    };

    let year = payload.year.and_then(|y| {
        if let Some(n) = y.as_i64() {
            Some(n as i32)
        } else if let Some(s) = y.as_str() {
            s.parse::<i32>().ok()
        } else {
            None
        }
    });

    let kind = match payload.kind.as_deref() {
        Some("series") => MediaKind::Series,
        Some("anime") => MediaKind::Anime,
        _ => MediaKind::Movie,
    };

    let details = state
        .media
        .resolve_media_details(title.trim().to_string(), year, kind, payload.poster_url)
        .await;

    Json(details).into_response()
}

#[derive(Deserialize)]
pub struct GeminiLookupPayload {
    pub title: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
}

pub async fn gemini_lookup_handler(
    State(state): State<AppState>,
    Json(payload): Json<GeminiLookupPayload>,
) -> Response {
    let Some(title) = payload.title.filter(|s| !s.trim().is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Title is required" })),
        )
            .into_response();
    };

    let details = state
        .media
        .lookup_media(title.trim(), payload.kind.as_deref())
        .await;

    Json(details).into_response()
}
