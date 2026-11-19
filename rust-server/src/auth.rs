use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use tokio::sync::Mutex;

type HmacSha256 = Hmac<Sha256>;

const SESSION_TTL_SECONDS: u64 = 60 * 60 * 12; // 12 hours
const LOGIN_WINDOW_SECS: u64 = 15 * 60; // 15 minutes
const MAX_LOGIN_ATTEMPTS: u32 = 10;

#[derive(Clone)]
struct LoginWindow {
    started_at: u64,
    count: u32,
}

#[derive(Clone)]
pub struct AuthManager {
    access_password: Option<String>,
    session_secret: Vec<u8>,
    is_production: bool,
    attempts: Arc<Mutex<HashMap<String, LoginWindow>>>,
}

impl AuthManager {
    pub fn new(access_password: Option<String>, session_secret: Vec<u8>, is_production: bool) -> Self {
        Self {
            access_password,
            session_secret,
            is_production,
            attempts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn requires_auth(&self) -> bool {
        self.access_password.is_some()
    }

    pub async fn allow_login_attempt(&self, client_ip: &str) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut map = self.attempts.lock().await;

        if let Some(entry) = map.get_mut(client_ip) {
            if now.saturating_sub(entry.started_at) >= LOGIN_WINDOW_SECS {
                entry.started_at = now;
                entry.count = 1;
                return true;
            }
            if entry.count >= MAX_LOGIN_ATTEMPTS {
                return false;
            }
            entry.count += 1;
            true
        } else {
            // Clean up old entries if map grows too big
            if map.len() >= 1000 {
                map.retain(|_, v| now.saturating_sub(v.started_at) < LOGIN_WINDOW_SECS);
                if map.len() >= 1000 {
                    return false;
                }
            }
            map.insert(client_ip.to_string(), LoginWindow { started_at: now, count: 1 });
            true
        }
    }

    pub fn verify_password(&self, input: &str) -> bool {
        let Some(ref expected) = self.access_password else {
            return false;
        };
        let input_bytes = input.as_bytes();
        let expected_bytes = expected.as_bytes();
        if input_bytes.len() != expected_bytes.len() {
            return false;
        }
        input_bytes.ct_eq(expected_bytes).into()
    }

    pub fn sign_session(&self, expires_at_ms: u64) -> String {
        let payload = expires_at_ms.to_string();
        let mut mac = HmacSha256::new_from_slice(&self.session_secret)
            .expect("HMAC can take key of any size");
        mac.update(payload.as_bytes());
        let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
        format!("{}.{}", payload, signature)
    }

    pub fn create_session_cookie(&self) -> String {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let expires_at_ms = now_ms + (SESSION_TTL_SECONDS * 1000);
        let token = self.sign_session(expires_at_ms);
        let secure_part = if self.is_production { "; Secure" } else { "" };
        format!(
            "arc_session={}; Max-Age={}; Path=/; HttpOnly; SameSite=Strict{}",
            token, SESSION_TTL_SECONDS, secure_part
        )
    }

    pub fn clear_session_cookie(&self) -> String {
        let secure_part = if self.is_production { "; Secure" } else { "" };
        format!("arc_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict{}", secure_part)
    }

    pub fn verify_cookie(&self, cookie_header: &str) -> bool {
        if !self.requires_auth() {
            return true;
        }

        let Some(cookie_val) = parse_cookie_value(cookie_header, "arc_session") else {
            return false;
        };

        let mut parts = cookie_val.split('.');
        let Some(expires_at_str) = parts.next() else {
            return false;
        };
        let Some(signature_str) = parts.next() else {
            return false;
        };

        let Ok(expires_at_ms) = expires_at_str.parse::<u64>() else {
            return false;
        };

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        if expires_at_ms <= now_ms {
            return false; // Expired
        }

        let mut mac = HmacSha256::new_from_slice(&self.session_secret)
            .expect("HMAC can take key of any size");
        mac.update(expires_at_str.as_bytes());
        let expected_bytes = mac.finalize().into_bytes();

        let Ok(actual_bytes) = URL_SAFE_NO_PAD.decode(signature_str) else {
            return false;
        };

        if expected_bytes.len() != actual_bytes.len() {
            return false;
        }

        expected_bytes.as_slice().ct_eq(actual_bytes.as_slice()).into()
    }
}

pub fn parse_cookie_value<'a>(cookie_header: &'a str, target_name: &str) -> Option<&'a str> {
    for part in cookie_header.split(';') {
        let trimmed = part.trim();
        if let Some((name, val)) = trimmed.split_once('=') {
            if name.trim() == target_name {
                return Some(val.trim());
            }
        }
    }
    None
}

pub const PRIVATE_LOGIN_PAGE: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>0arc — Private Access</title><style>body{margin:0;background:#09090b;color:#fafafa;font:14px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(360px,calc(100% - 40px));padding:28px;border:1px solid #27272a;border-radius:16px;background:#111113}h1{font-size:18px;margin:0 0 8px}p{color:#a1a1aa;font-size:12px;margin:0 0 20px}input,button{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #3f3f46;background:#09090b;color:#fff;font:inherit}button{margin-top:10px;background:#fff;color:#09090b;border:0;font-weight:600;cursor:pointer}#error{color:#f87171;margin-top:12px;min-height:16px}</style></head><body><main><h1>Private archive</h1><p>This site is restricted. Enter the access password to continue.</p><form id="form"><input id="password" type="password" autocomplete="current-password" aria-label="Access password" required><button>Unlock archive</button><div id="error" role="alert"></div></form></main><script>form.addEventListener('submit',async(e)=>{e.preventDefault();error.textContent='';const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:password.value})});if(r.ok)location.reload();else error.textContent='Incorrect password.'})</script></body></html>"#;
