use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudVaultData {
    #[serde(default)]
    pub tools: Vec<serde_json::Value>,
    #[serde(default)]
    pub notes: Vec<serde_json::Value>,
    #[serde(default)]
    pub media: Vec<serde_json::Value>,
    #[serde(default = "default_settings")]
    pub settings: serde_json::Value,
    #[serde(default = "default_version")]
    pub version: i64,
    #[serde(default = "default_updated_at")]
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mongo_uri: Option<String>,
}

fn default_settings() -> serde_json::Value {
    serde_json::json!({
        "confirmBeforeDelete": true,
        "defaultArchiveView": "overview"
    })
}

fn default_version() -> i64 {
    1
}

fn default_updated_at() -> String {
    chrono::Utc::now().to_rfc3339()
}

impl Default for CloudVaultData {
    fn default() -> Self {
        Self {
            tools: Vec::new(),
            notes: Vec::new(),
            media: Vec::new(),
            settings: default_settings(),
            version: 1,
            updated_at: default_updated_at(),
            mongo_uri: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudImage {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub mime_type: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_size: Option<u64>,
    pub created_at: i64,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub mime_type: String,
    pub size: u64,
    pub created_at: i64,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsageEntry {
    pub label: String,
    pub bytes: usize,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub ok: bool,
    pub used_bytes: usize,
    pub limit_bytes: usize,
    pub remaining_bytes: usize,
    pub percent_used: f64,
    pub plan_name: String,
    pub source: String,
    pub measured_by: String,
    pub is_mongo_connected: bool,
    pub breakdown: Vec<StorageUsageEntry>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub client_id: Option<String>,
    pub tools: Option<Vec<serde_json::Value>>,
    pub notes: Option<Vec<serde_json::Value>>,
    pub media: Option<Vec<serde_json::Value>>,
    pub settings: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncBroadcastEvent {
    pub version: i64,
    pub updated_at: String,
    pub tools: Vec<serde_json::Value>,
    pub notes: Vec<serde_json::Value>,
    pub media: Vec<serde_json::Value>,
    pub settings: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_client_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Movie,
    Series,
    Anime,
}

impl Default for MediaKind {
    fn default() -> Self {
        MediaKind::Movie
    }
}

impl MediaKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            MediaKind::Movie => "movie",
            MediaKind::Series => "series",
            MediaKind::Anime => "anime",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImdbCandidate {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(rename = "type")]
    pub kind: MediaKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stars: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaDetails {
    pub title: String,
    #[serde(rename = "type")]
    pub kind: MediaKind,
    pub description: String,
    pub genre: String,
    pub release_year: i32,
    pub rating: f64,
    pub poster_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_total: Option<i32>,
}
