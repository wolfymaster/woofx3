use anyhow::{anyhow, Result};
use lib_repository::{FileRepositoryConfig, RepositoryConfig, S3RepositoryConfig};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

/// Settings keys read from the engine's `settings` table to compose
/// the active repository. All keys are application-scoped to the
/// default application — barkloader is single-application.
///
/// Provider selector:
///   - `storage.provider` → "file" | "s3"
///
/// File repository:
///   - `storage.file.destination` → absolute or relative path
///
/// S3-compatible repository (works for AWS S3, Cloudflare R2, MinIO):
///   - `storage.s3.bucket`
///   - `storage.s3.prefix`           (optional, defaults to none)
///   - `storage.s3.region`           (default "auto" for R2; e.g. "us-east-1" for S3)
///   - `storage.s3.endpoint`         (custom endpoint URL; empty for default AWS)
///   - `storage.s3.access_key`       (optional; falls back to default AWS credential chain)
///   - `storage.s3.secret_key`       (optional; matches access_key)
///   - `storage.s3.force_path_style` (boolean; required for MinIO)
///
/// When a required setting is missing, callers fall back to the
/// matching environment variable so dev / local-first runs keep
/// working without bootstrapping settings rows first.

#[derive(Debug, Serialize)]
struct GetSettingRequest<'a> {
    key: &'a str,
    #[serde(rename = "applicationId")]
    application_id: &'a str,
}

#[derive(Debug, Deserialize)]
struct GetSettingResponse {
    setting: Option<SettingPayload>,
}

#[derive(Debug, Deserialize)]
struct SettingPayload {
    // `value` is a `google.protobuf.Value` on the wire. protojson (used by
    // Twirp's JSON codec) maps that well-known type to the bare JSON value
    // it wraps rather than an object with a `stringValue` field — e.g. a
    // string setting round-trips as `"value": "file"`, not
    // `"value": {"stringValue": "file"}`. All settings barkloader reads are
    // written as strings (see db-proxy's SetSetting), so a plain `String`
    // here matches what's actually on the wire.
    value: Option<String>,
}

/// Look up a single setting by key. Returns `Ok(None)` when the
/// setting is unset; `Err` only for transport errors. The
/// application id is empty string today (barkloader has no notion of
/// applicationId at startup; the db-proxy treats empty as
/// "default application").
pub async fn get_setting(db_proxy_url: &str, key: &str) -> Result<Option<String>> {
    let url = format!("{}/twirp/setting.SettingService/GetSetting", db_proxy_url);
    let body = GetSettingRequest {
        key,
        application_id: "",
    };
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("GetSetting {} request failed: {}", key, e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        // 404 / NotFound from the db-proxy means the key isn't set.
        // Twirp emits these as 4xx with a `not_found` code — treat as
        // None rather than an error.
        if status.as_u16() == 404 || text.contains("not_found") {
            return Ok(None);
        }
        return Err(anyhow!("GetSetting {} failed {}: {}", key, status, text));
    }
    let parsed: GetSettingResponse = response
        .json()
        .await
        .map_err(|e| anyhow!("GetSetting {} response parse failed: {}", key, e))?;
    Ok(parsed
        .setting
        .and_then(|s| s.value)
        .filter(|s| !s.is_empty()))
}

/// Readiness probe against db-proxy's public `Ping` RPC. That route is
/// deliberately exempt from authorization and touches no database (see
/// `db/app/routes/ping.go`), so a successful response means the process
/// is up and serving Twirp -- the same signal the Go and TypeScript
/// runtimes check through their registered `db` service.
pub async fn ping(db_proxy_url: &str) -> Result<()> {
    let url = format!("{}/twirp/common.CommonService/Ping", db_proxy_url);
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| anyhow!("Ping request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("Ping failed {}: {}", status, text));
    }
    Ok(())
}

/// Retry delay schedule: 1s doubling to a 60s ceiling, then back to the
/// minimum. Mirrors `shared/common/golang/runtime/backoff.go` and the
/// TypeScript `calculateNextBackoffDelay` so every service in the repo
/// waits on db-proxy along the same curve.
struct Backoff {
    current: Duration,
}

impl Backoff {
    const MIN: Duration = Duration::from_secs(1);
    const MAX: Duration = Duration::from_secs(60);
    const FACTOR: u32 = 2;

    fn new() -> Self {
        Self { current: Self::MIN }
    }

    fn next(&mut self) -> Duration {
        let next = self.current * Self::FACTOR;
        if next > Self::MAX {
            self.current = Self::MIN;
            return Self::MIN;
        }
        self.current = next;
        next
    }
}

/// Block until db-proxy answers `Ping`.
///
/// Application configuration lives in the engine's `settings` table, so
/// nothing that reads it -- the storage provider above all -- may run
/// before the connection is established. A db-proxy that is merely slow
/// to bind would otherwise resolve every setting to whatever the
/// environment defaults happen to be, silently seating the process on
/// the wrong storage backend for its entire lifetime.
///
/// Retries indefinitely rather than giving up: barkloader can do no
/// useful work without db-proxy, and the Go and TypeScript runtimes
/// hold their application init exactly the same way.
pub async fn wait_for_db_proxy(db_proxy_url: &str) {
    let mut backoff = Backoff::new();
    let mut attempt: u32 = 1;

    loop {
        match ping(db_proxy_url).await {
            Ok(()) => {
                info!("db-proxy ready at {} (attempt {})", db_proxy_url, attempt);
                return;
            }
            Err(e) => {
                let delay = backoff.next();
                warn!(
                    "db-proxy not ready at {} (attempt {}): {}; retrying in {:?}",
                    db_proxy_url, attempt, e, delay
                );
                tokio::time::sleep(delay).await;
                attempt += 1;
            }
        }
    }
}

fn env_or_setting(setting: Option<String>, env_var: &str) -> Option<String> {
    setting.or_else(|| std::env::var(env_var).ok().filter(|s| !s.is_empty()))
}

/// Resolve the active repository configuration. Tries the db-proxy
/// settings first (when available); falls back to environment
/// variables for any value not set there. Returns the legacy
/// File repo using `MODULES_DIR` (or `./modules`) when nothing else
/// is configured — the existing dev-mode default.
pub async fn resolve_repository_config(
    db_proxy_url: Option<&str>,
    default_modules_dir: &str,
) -> Result<RepositoryConfig> {
    // A transport error here is fatal, not a cue to fall back: callers
    // establish the db-proxy connection first (see `wait_for_db_proxy`),
    // so a failure now means db-proxy went away mid-startup rather than
    // that the setting is absent. `get_setting` already reports a truly
    // unset key as `Ok(None)`, which is what the env fallback is for.
    let provider = if let Some(url) = db_proxy_url {
        get_setting(url, "storage.provider")
            .await
            .map_err(|e| anyhow!("Failed to read storage.provider from db-proxy: {}", e))?
    } else {
        None
    };
    let provider = env_or_setting(provider, "STORAGE_PROVIDER")
        .unwrap_or_else(|| "file".to_string());

    match provider.as_str() {
        "file" => {
            let destination_str = if let Some(url) = db_proxy_url {
                get_setting(url, "storage.file.destination").await?
            } else {
                None
            };
            let destination = env_or_setting(destination_str, "MODULES_DIR")
                .unwrap_or_else(|| default_modules_dir.to_string());
            info!("Storage provider: file (destination: {})", destination);
            Ok(RepositoryConfig::File(FileRepositoryConfig {
                destination: PathBuf::from(destination),
            }))
        }
        "s3" => {
            let cfg = resolve_s3_config(db_proxy_url).await?;
            info!(
                "Storage provider: s3 (bucket: {}, endpoint: {:?}, region: {:?})",
                cfg.bucket, cfg.endpoint, cfg.region
            );
            Ok(RepositoryConfig::S3(cfg))
        }
        other => Err(anyhow!(
            "Unknown storage provider: {} (expected 'file' or 's3')",
            other
        )),
    }
}

async fn resolve_s3_config(db_proxy_url: Option<&str>) -> Result<S3RepositoryConfig> {
    async fn lookup(db_proxy_url: Option<&str>, key: &str) -> Result<Option<String>> {
        if let Some(url) = db_proxy_url {
            return get_setting(url, key).await;
        }
        Ok(None)
    }

    let bucket = env_or_setting(lookup(db_proxy_url, "storage.s3.bucket").await?, "S3_BUCKET")
        .ok_or_else(|| anyhow!("S3 storage requires 'storage.s3.bucket' setting or S3_BUCKET env"))?;
    let prefix = env_or_setting(lookup(db_proxy_url, "storage.s3.prefix").await?, "S3_PREFIX");
    let region = env_or_setting(lookup(db_proxy_url, "storage.s3.region").await?, "S3_REGION");
    let endpoint = env_or_setting(lookup(db_proxy_url, "storage.s3.endpoint").await?, "S3_ENDPOINT");
    let access_key = env_or_setting(
        lookup(db_proxy_url, "storage.s3.access_key").await?,
        "S3_ACCESS_KEY",
    );
    let secret_key = env_or_setting(
        lookup(db_proxy_url, "storage.s3.secret_key").await?,
        "S3_SECRET_KEY",
    );
    let force_path_style = env_or_setting(
        lookup(db_proxy_url, "storage.s3.force_path_style").await?,
        "S3_FORCE_PATH_STYLE",
    )
    .map(|v| v == "true" || v == "1" || v == "yes")
    .unwrap_or(false);

    Ok(S3RepositoryConfig {
        bucket,
        prefix,
        region,
        endpoint,
        access_key,
        secret_key,
        force_path_style,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // db-proxy's Twirp JSON codec (protojson) collapses `google.protobuf.Value`
    // to the bare JSON scalar it wraps, not `{"stringValue": ...}` — this is
    // what protojson.Marshal actually emits for a string-valued Setting.
    #[test]
    fn deserializes_protojson_collapsed_value() {
        let body = r#"{"setting":{"id":"1","key":"storage.provider","value":"s3","valueType":"string","applicationId":"","userId":""}}"#;
        let parsed: GetSettingResponse = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.setting.and_then(|s| s.value), Some("s3".to_string()));
    }

    #[test]
    fn deserializes_missing_setting_as_none() {
        let body = r#"{"setting":null}"#;
        let parsed: GetSettingResponse = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.setting.and_then(|s| s.value), None);
    }

    // Matches `Backoff.Next()` in shared/common/golang/runtime/backoff.go:
    // the first delay is already doubled (min * factor), the ceiling is
    // exclusive-on-exceed, and overflow wraps to min instead of pinning
    // at max -- so a long outage keeps producing a fast first retry.
    #[test]
    fn backoff_matches_shared_runtime_curve() {
        let mut backoff = Backoff::new();
        let delays: Vec<u64> = (0..8).map(|_| backoff.next().as_secs()).collect();
        assert_eq!(delays, vec![2, 4, 8, 16, 32, 1, 2, 4]);
    }

    #[test]
    fn backoff_never_exceeds_max() {
        let mut backoff = Backoff::new();
        for _ in 0..100 {
            assert!(backoff.next() <= Backoff::MAX);
        }
    }

    #[test]
    fn env_or_setting_prefers_setting_over_env() {
        // SAFETY: test-only env mutation; not run concurrently with other
        // tests that touch this var.
        unsafe {
            std::env::set_var("STORAGE_SETTINGS_TEST_VAR", "from-env");
        }
        let result = env_or_setting(Some("from-setting".to_string()), "STORAGE_SETTINGS_TEST_VAR");
        assert_eq!(result, Some("from-setting".to_string()));
        unsafe {
            std::env::remove_var("STORAGE_SETTINGS_TEST_VAR");
        }
    }
}
