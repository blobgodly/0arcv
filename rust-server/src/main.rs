mod auth;
mod config;
mod models;
mod media;
mod routes;
mod state;
mod store;

use config::Config;
use routes::create_router;
use state::AppState;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load local environment files
    let _ = dotenvy::from_filename(".env.development.local");
    let _ = dotenvy::dotenv();

    // Set up structured logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);

    let config = Config::from_env();
    let bind_addr = format!("{}:{}", config.host, config.port);
    let auth_status = if config.access_password.is_some() { "Enabled (Password protected)" } else { "Disabled (Open access)" };

    let state = AppState::new(config);
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;

    println!("============================================================");
    println!("🦀 0arc High-Performance Rust Server Active");
    println!("📡 Server listening on http://{}", bind_addr);
    println!("🔒 Authentication: {}", auth_status);
    println!("🚀 Tokio Multi-threaded Async Runtime");
    println!("============================================================");

    info!("Starting 0arc Rust Server on {}", bind_addr);
    axum::serve(listener, app).await?;

    Ok(())
}
