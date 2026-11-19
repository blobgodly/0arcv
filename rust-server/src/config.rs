use std::env;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub access_password: Option<String>,
    pub session_secret: Vec<u8>,
    pub tmdb_api_key: Option<String>,
    pub mongodb_uri: Option<String>,
    pub is_production: bool,
    pub data_dir: std::path::PathBuf,
    pub dist_dir: std::path::PathBuf,
}

impl Config {
    pub fn from_env() -> Self {
        let host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(3000);

        let access_password = env::var("APP_ACCESS_PASSWORD")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let session_secret = if let Ok(sec) = env::var("APP_SESSION_SECRET") {
            if !sec.trim().is_empty() {
                sec.trim().as_bytes().to_vec()
            } else {
                Self::derive_secret(&access_password)
            }
        } else {
            Self::derive_secret(&access_password)
        };

        let tmdb_api_key = env::var("TMDB_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != "MY_TMDB_API_KEY");

        let mongodb_uri = env::var("MONGODB_URI")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let node_env = env::var("NODE_ENV").unwrap_or_else(|_| "development".to_string());
        let is_production = node_env.eq_ignore_ascii_case("production");

        let data_dir = env::var("DATA_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("data"));

        let dist_dir = env::var("DIST_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("dist"));

        Self {
            host,
            port,
            access_password,
            session_secret,
            tmdb_api_key,
            mongodb_uri,
            is_production,
            data_dir,
            dist_dir,
        }
    }

    fn derive_secret(access_password: &Option<String>) -> Vec<u8> {
        let mut hasher = Sha256::new();
        if let Some(ref pwd) = access_password {
            hasher.update(pwd.as_bytes());
        } else {
            hasher.update(uuid::Uuid::new_v4().as_bytes());
        }
        hasher.finalize().to_vec()
    }
}
