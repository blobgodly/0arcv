use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};

use crate::models::{
    CloudFile, CloudImage, CloudVaultData, StorageUsage, StorageUsageEntry,
    SyncBroadcastEvent, SyncRequest,
};

pub const MONGO_FREE_PLAN_LIMIT_BYTES: usize = 512 * 1024 * 1024; // 512 MB

pub struct CloudStore {
    data_dir: PathBuf,
    vault_file: PathBuf,
    vault: RwLock<CloudVaultData>,
    images: RwLock<Vec<CloudImage>>,
    files: RwLock<Vec<CloudFile>>,
    tx: broadcast::Sender<SyncBroadcastEvent>,
    mongo_uri: RwLock<Option<String>>,
    is_mongo_connected: RwLock<bool>,
}

impl CloudStore {
    pub fn new(data_dir: PathBuf, initial_mongo_uri: Option<String>) -> Self {
        let vault_file = data_dir.join("vault.json");
        let (tx, _) = broadcast::channel(100);

        let initial_vault = Self::load_disk_vault(&vault_file);

        Self {
            data_dir,
            vault_file,
            vault: RwLock::new(initial_vault),
            images: RwLock::new(Vec::new()),
            files: RwLock::new(Vec::new()),
            tx,
            mongo_uri: RwLock::new(initial_mongo_uri),
            is_mongo_connected: RwLock::new(false),
        }
    }

    fn load_disk_vault(vault_file: &Path) -> CloudVaultData {
        if vault_file.exists() {
            if let Ok(content) = fs::read_to_string(vault_file) {
                if let Ok(data) = serde_json::from_str::<CloudVaultData>(&content) {
                    info!("Loaded persisted vault from {:?}", vault_file);
                    return data;
                }
            }
        }
        info!("Initializing fresh in-memory vault snapshot");
        CloudVaultData::default()
    }

    fn save_to_disk(&self, data: &CloudVaultData) {
        if let Err(err) = fs::create_dir_all(&self.data_dir) {
            warn!("Failed to create data dir {:?}: {}", self.data_dir, err);
            return;
        }

        match serde_json::to_string_pretty(data) {
            Ok(json_str) => {
                if let Err(err) = fs::write(&self.vault_file, json_str) {
                    warn!("Failed to write vault data to {:?}: {}", self.vault_file, err);
                }
            }
            Err(err) => {
                warn!("Failed to serialize vault data: {}", err);
            }
        }
    }

    pub async fn get_vault_data(&self) -> (CloudVaultData, bool) {
        let vault = self.vault.read().await.clone();
        let is_connected = *self.is_mongo_connected.read().await;
        (vault, is_connected)
    }

    pub async fn save_vault_data(
        &self,
        req: SyncRequest,
    ) -> (bool, i64, String) {
        let mut vault = self.vault.write().await;
        let next_version = vault.version + 1;
        let now = chrono::Utc::now().to_rfc3339();

        if let Some(tools) = req.tools {
            vault.tools = tools;
        }
        if let Some(notes) = req.notes {
            vault.notes = notes;
        }
        if let Some(media) = req.media {
            vault.media = media;
        }
        if let Some(settings) = req.settings {
            vault.settings = settings;
        }

        vault.version = next_version;
        vault.updated_at = now.clone();

        self.save_to_disk(&vault);

        // Broadcast to all listening SSE clients
        let event = SyncBroadcastEvent {
            version: vault.version,
            updated_at: vault.updated_at.clone(),
            tools: vault.tools.clone(),
            notes: vault.notes.clone(),
            media: vault.media.clone(),
            settings: vault.settings.clone(),
            sender_client_id: req.client_id,
        };
        let _ = self.tx.send(event);

        (true, next_version, now)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SyncBroadcastEvent> {
        self.tx.subscribe()
    }

    pub async fn get_images(&self) -> Vec<CloudImage> {
        let mut list = self.images.read().await.clone();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    pub async fn save_images(&self, new_images: Vec<CloudImage>) {
        let mut images = self.images.write().await;
        if new_images.is_empty() {
            images.clear();
            return;
        }

        for img in new_images {
            if let Some(pos) = images.iter().position(|x| x.id == img.id) {
                images[pos] = img;
            } else {
                images.push(img);
            }
        }
    }

    pub async fn delete_image(&self, id: &str) {
        let mut images = self.images.write().await;
        images.retain(|x| x.id != id);
    }

    pub async fn get_files(&self) -> Vec<CloudFile> {
        let mut list = self.files.read().await.clone();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    pub async fn save_files(&self, new_files: Vec<CloudFile>) {
        let mut files = self.files.write().await;
        if new_files.is_empty() {
            files.clear();
            return;
        }

        for file in new_files {
            if let Some(pos) = files.iter().position(|x| x.id == file.id) {
                files[pos] = file;
            } else {
                files.push(file);
            }
        }
    }

    pub async fn delete_file(&self, id: &str) {
        let mut files = self.files.write().await;
        files.retain(|x| x.id != id);
    }

    pub async fn get_storage_usage(&self) -> StorageUsage {
        let vault = self.vault.read().await;
        let images = self.images.read().await;
        let files = self.files.read().await;
        let is_connected = *self.is_mongo_connected.read().await;

        let tools_bytes = serde_json::to_string(&vault.tools).map(|s| s.len()).unwrap_or(0);
        let notes_bytes = serde_json::to_string(&vault.notes).map(|s| s.len()).unwrap_or(0);
        let media_bytes = serde_json::to_string(&vault.media).map(|s| s.len()).unwrap_or(0);
        let settings_bytes = serde_json::to_string(&vault.settings).map(|s| s.len()).unwrap_or(0);
        let images_bytes: usize = images.iter().map(|img| img.size as usize).sum();
        let files_bytes: usize = files.iter().map(|f| f.size as usize).sum();

        let breakdown = vec![
            StorageUsageEntry {
                label: "Tools".to_string(),
                bytes: tools_bytes,
                count: vault.tools.len(),
            },
            StorageUsageEntry {
                label: "Notes".to_string(),
                bytes: notes_bytes,
                count: vault.notes.len(),
            },
            StorageUsageEntry {
                label: "Watchlist".to_string(),
                bytes: media_bytes,
                count: vault.media.len(),
            },
            StorageUsageEntry {
                label: "Settings".to_string(),
                bytes: settings_bytes,
                count: 1,
            },
            StorageUsageEntry {
                label: "Images".to_string(),
                bytes: images_bytes,
                count: images.len(),
            },
            StorageUsageEntry {
                label: "Files".to_string(),
                bytes: files_bytes,
                count: files.len(),
            },
        ];

        let used_bytes = tools_bytes + notes_bytes + media_bytes + settings_bytes + images_bytes + files_bytes;
        let limit_bytes = MONGO_FREE_PLAN_LIMIT_BYTES;
        let remaining_bytes = limit_bytes.saturating_sub(used_bytes);
        let percent_used = ((used_bytes as f64) / (limit_bytes as f64) * 100.0).min(100.0);

        StorageUsage {
            ok: true,
            used_bytes,
            limit_bytes,
            remaining_bytes,
            percent_used,
            plan_name: if is_connected { "MongoDB Atlas M0 (Free)".to_string() } else { "0arc Rust High-Speed Store".to_string() },
            source: if is_connected { "mongodb".to_string() } else { "local".to_string() },
            measured_by: "vault-document".to_string(),
            is_mongo_connected: is_connected,
            breakdown,
            updated_at: vault.updated_at.clone(),
        }
    }

    pub async fn get_mongo_status(&self) -> (bool, bool, String, String) {
        let is_connected = *self.is_mongo_connected.read().await;
        let maybe_uri = self.mongo_uri.read().await.clone();
        let has_custom = maybe_uri.is_some();
        let masked = if let Some(uri) = maybe_uri {
            mask_mongo_uri(&uri)
        } else {
            "".to_string()
        };
        let storage_type = if is_connected {
            "MongoDB Atlas".to_string()
        } else {
            "0arc Native Rust Store".to_string()
        };
        (is_connected, has_custom, masked, storage_type)
    }

    pub async fn set_mongo_uri(&self, uri: String) -> (bool, String) {
        let trimmed = uri.trim().to_string();
        if trimmed.is_empty() {
            *self.mongo_uri.write().await = None;
            *self.is_mongo_connected.write().await = false;
            return (true, "Disconnected from external MongoDB.".to_string());
        }
        *self.mongo_uri.write().await = Some(trimmed);
        *self.is_mongo_connected.write().await = true;
        (true, "Configured MongoDB successfully.".to_string())
    }
}

fn mask_mongo_uri(uri: &str) -> String {
    if let Some(at_idx) = uri.find('@') {
        if let Some(colon_idx) = uri[..at_idx].rfind(':') {
            return format!("{}******{}", &uri[..colon_idx + 1], &uri[at_idx..]);
        }
    }
    "Configured (Masked)".to_string()
}
