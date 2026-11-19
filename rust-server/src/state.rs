use std::sync::Arc;
use crate::auth::AuthManager;
use crate::config::Config;
use crate::media::MediaResolver;
use crate::store::CloudStore;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub auth: Arc<AuthManager>,
    pub store: Arc<CloudStore>,
    pub media: Arc<MediaResolver>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let auth = Arc::new(AuthManager::new(
            config.access_password.clone(),
            config.session_secret.clone(),
            config.is_production,
        ));

        let store = Arc::new(CloudStore::new(
            config.data_dir.clone(),
            config.mongodb_uri.clone(),
        ));

        let media = Arc::new(MediaResolver::new(config.tmdb_api_key.clone()));

        Self {
            config: Arc::new(config),
            auth,
            store,
            media,
        }
    }
}
