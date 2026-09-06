use std::sync::RwLock;
use std::time::{Duration, Instant};

use tracing::warn;

use super::storage_settings::get_setting;

/// Barkloader-owned public base URL for widget resource delivery
/// (`storage.publicUrl`), distinct from the older `overlay.publicUrl`
/// setting owned by streamware/workflow — that one is tied to the
/// `/overlay/assets` proxy convention this service doesn't use.
/// Resources served under this base must be directly reachable by a
/// browser (see `routes::widgets`), whether that's barkloader itself
/// or a reverse proxy in front of it.
const SETTING_KEY: &str = "storage.publicUrl";
const ENV_VAR: &str = "WOOFX3_STORAGE_PUBLIC_URL";
const TTL: Duration = Duration::from_secs(30);

/// TTL-cached resolver, same shape as the TS/Go `overlay.publicUrl`
/// resolvers: db-proxy setting, then env, then a caller-supplied
/// default. Unlike `overlay.publicUrl` (deliberately no default),
/// this one defaults to barkloader's own configured URL — usable out
/// of the box in local dev where nothing fronts barkloader yet.
pub struct PublicUrlResolver {
    db_proxy_url: Option<String>,
    default_url: String,
    cache: RwLock<Option<(String, Instant)>>,
    // Injectable so tests never touch the real process environment —
    // `std::env::set_var`/`remove_var` are process-global and Rust
    // tests run concurrently by default, so two tests mutating the
    // same real env var raced each other here before this was added
    // (see the git history of this file's tests for the flaky
    // version this replaced).
    env_lookup: Box<dyn Fn(&str) -> Option<String> + Send + Sync>,
}

impl PublicUrlResolver {
    pub fn new(db_proxy_url: Option<String>, default_url: String) -> Self {
        Self::with_env_lookup(db_proxy_url, default_url, |key| std::env::var(key).ok())
    }

    fn with_env_lookup(
        db_proxy_url: Option<String>,
        default_url: String,
        env_lookup: impl Fn(&str) -> Option<String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            db_proxy_url,
            default_url,
            cache: RwLock::new(None),
            env_lookup: Box::new(env_lookup),
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
        (self.env_lookup)(ENV_VAR)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| self.default_url.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn falls_back_to_default_when_nothing_configured() {
        let resolver = PublicUrlResolver::with_env_lookup(None, "http://127.0.0.1:9653".to_string(), |_| None);
        assert_eq!(resolver.resolve().await, "http://127.0.0.1:9653");
    }

    #[tokio::test]
    async fn env_var_wins_over_default() {
        let resolver = PublicUrlResolver::with_env_lookup(None, "http://127.0.0.1:9653".to_string(), |key| {
            assert_eq!(key, ENV_VAR);
            Some("https://cdn.example.test".to_string())
        });
        assert_eq!(resolver.resolve().await, "https://cdn.example.test");
    }

    #[tokio::test]
    async fn caches_within_ttl() {
        // Fake env lookup that changes value on the second call — the
        // resolver must not observe it because the first result is
        // still within TTL.
        let calls = AtomicUsize::new(0);
        let resolver = PublicUrlResolver::with_env_lookup(None, "http://default".to_string(), move |_| {
            let n = calls.fetch_add(1, Ordering::SeqCst);
            Some(if n == 0 { "https://first.example.test" } else { "https://second.example.test" }.to_string())
        });
        assert_eq!(resolver.resolve().await, "https://first.example.test");
        // Still cached — env change within TTL isn't observed yet.
        assert_eq!(resolver.resolve().await, "https://first.example.test");
    }
}
