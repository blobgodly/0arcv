use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
};
use std::path::PathBuf;
use tokio::fs;

use crate::auth::PRIVATE_LOGIN_PAGE;
use crate::state::AppState;

pub async fn spa_fallback_handler(
    State(state): State<AppState>,
    uri: Uri,
    req: Request<Body>,
) -> Response {
    let path_str = uri.path().trim_start_matches('/');

    // Check if client requested a specific static file inside dist
    let mut file_path = state.config.dist_dir.clone();
    if !path_str.is_empty() {
        for segment in path_str.split('/') {
            if segment == ".." || segment.is_empty() {
                continue;
            }
            file_path.push(segment);
        }
    }

    if file_path.is_file() {
        if let Ok(content) = fs::read(&file_path).await {
            let mime = mime_guess::from_path(&file_path)
                .first_or_octet_stream()
                .to_string();

            let mut response = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime);

            // Immutable cache for fingerprinted Vite assets
            if path_str.starts_with("assets/") {
                response = response.header(
                    header::CACHE_CONTROL,
                    "public, max-age=31536000, immutable",
                );
            }

            if let Ok(resp) = response.body(Body::from(content)) {
                return resp;
            }
        }
    }

    // Fallback: serve dist/index.html for client-side SPA routing
    let index_file = state.config.dist_dir.join("index.html");
    if index_file.is_file() {
        if let Ok(html) = fs::read_to_string(&index_file).await {
            return Html(html).into_response();
        }
    }

    // Default welcoming splash if dist has not been built yet
    Html(r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>0arc — High-Performance Rust Server</title>
  <style>
    body { margin: 0; background: #09090b; color: #fafafa; font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; }
    main { max-width: 480px; padding: 32px; border: 1px solid #27272a; border-radius: 16px; background: #111113; text-align: center; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { color: #a1a1aa; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
    code { background: #1c1c1f; padding: 4px 8px; border-radius: 6px; font-size: 13px; color: #38bdf8; }
  </style>
</head>
<body>
  <main>
    <h1>🦀 0arc Rust Core Active</h1>
    <p>The high-performance Axum Rust backend is active and listening for API requests.</p>
    <p>To serve the full user interface, build the frontend with: <br><br><code>npm run build</code></p>
  </main>
</body>
</html>"#).into_response()
}

mod mime_guess {
    use std::path::Path;

    pub struct MimeType(&'static str);
    impl MimeType {
        pub fn first_or_octet_stream(&self) -> &'static str {
            self.0
        }
    }

    pub fn from_path(path: &Path) -> MimeType {
        match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
            "html" => MimeType("text/html; charset=utf-8"),
            "css" => MimeType("text/css; charset=utf-8"),
            "js" | "mjs" => MimeType("application/javascript; charset=utf-8"),
            "json" => MimeType("application/json"),
            "svg" => MimeType("image/svg+xml"),
            "png" => MimeType("image/png"),
            "jpg" | "jpeg" => MimeType("image/jpeg"),
            "webp" => MimeType("image/webp"),
            "ico" => MimeType("image/x-icon"),
            "woff" => MimeType("font/woff"),
            "woff2" => MimeType("font/woff2"),
            "ttf" => MimeType("font/ttf"),
            _ => MimeType("application/octet-stream"),
        }
    }
}
