use std::sync::RwLock;
use std::time::{Duration, Instant};

use tracing::warn;

use super::storage_settings::get_setting;

const SETTING_KEY: &str = "scene.publicUrl";
const TTL: Duration = Duration::from_secs(30);

pub struct PublicUrlResolver {
    db_proxy_url: Option<String>,
    default_url: String,
    cache: RwLock<Option<(String, Instant)>>,
}

impl PublicUrlResolver {
    pub fn new(db_proxy_url: Option<String>, default_url: String) -> Self {
        Self {
            db_proxy_url,
            default_url,
            cache: RwLock::new(None),
        }
    }

    pub async fn resolve(&self) -> String {
        if let Some((value, at)) = self.cache.read().expect("public url cache lock poisoned").clone() {
            if at.elapsed() < TTL {
                return value;
            }
        }
        let resolved = self.resolve_uncached().await;
        *self.cache.write().expect("public url cache lock poisoned") = Some((resolved.clone(), Instant::now()));
        resolved
    }

    async fn resolve_uncached(&self) -> String {
        if let Some(url) = &self.db_proxy_url {
            match get_setting(url, SETTING_KEY).await {
                Ok(Some(value)) if !value.is_empty() => return value,
                Ok(_) => {}
                Err(e) => warn!("Failed to fetch {} from db-proxy: {}; falling back", SETTING_KEY, e),
            }
        }
        self.default_url.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn falls_back_to_the_configured_url_without_a_db_proxy() {
        let resolver = PublicUrlResolver::new(None, "https://scene.example.test".to_string());
        assert_eq!(resolver.resolve().await, "https://scene.example.test");
    }
}
