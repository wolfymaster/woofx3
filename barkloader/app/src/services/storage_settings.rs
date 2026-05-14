use anyhow::{anyhow, Result};
use lib_repository::{FileRepositoryConfig, RepositoryConfig, S3RepositoryConfig};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
    value: Option<SettingValue>,
}

#[derive(Debug, Deserialize)]
struct SettingValue {
    #[serde(rename = "stringValue", default)]
    string_value: Option<String>,
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
        .and_then(|v| v.string_value)
        .filter(|s| !s.is_empty()))
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
    let provider = if let Some(url) = db_proxy_url {
        match get_setting(url, "storage.provider").await {
            Ok(value) => value,
            Err(e) => {
                warn!("Failed to fetch storage.provider from db-proxy: {}; falling back to env", e);
                None
            }
        }
    } else {
        None
    };
    let provider = env_or_setting(provider, "STORAGE_PROVIDER")
        .unwrap_or_else(|| "file".to_string());

    match provider.as_str() {
        "file" => {
            let destination_str = if let Some(url) = db_proxy_url {
                get_setting(url, "storage.file.destination").await.ok().flatten()
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
    async fn lookup(db_proxy_url: Option<&str>, key: &str) -> Option<String> {
        if let Some(url) = db_proxy_url {
            return get_setting(url, key).await.ok().flatten();
        }
        None
    }

    let bucket = env_or_setting(lookup(db_proxy_url, "storage.s3.bucket").await, "S3_BUCKET")
        .ok_or_else(|| anyhow!("S3 storage requires 'storage.s3.bucket' setting or S3_BUCKET env"))?;
    let prefix = env_or_setting(lookup(db_proxy_url, "storage.s3.prefix").await, "S3_PREFIX");
    let region = env_or_setting(lookup(db_proxy_url, "storage.s3.region").await, "S3_REGION");
    let endpoint = env_or_setting(lookup(db_proxy_url, "storage.s3.endpoint").await, "S3_ENDPOINT");
    let access_key = env_or_setting(
        lookup(db_proxy_url, "storage.s3.access_key").await,
        "S3_ACCESS_KEY",
    );
    let secret_key = env_or_setting(
        lookup(db_proxy_url, "storage.s3.secret_key").await,
        "S3_SECRET_KEY",
    );
    let force_path_style = env_or_setting(
        lookup(db_proxy_url, "storage.s3.force_path_style").await,
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
