use actix_web::web::{Data, ServiceConfig};
use actix_web::{Error, HttpResponse, post};
use lib_repository::{Repository, RepositoryConfig, RepositoryFactory, RepositoryImpl};
use log::{error, info, warn};
use std::collections::BTreeSet;

use crate::services::storage_settings::resolve_repository_config;
use crate::types::AppContext;

/// Repository prefix holding installed module content. Used both as the
/// validation probe and as the basis for the stranded-module report.
const MODULES_PREFIX: &str = "modules";

/// Re-read storage settings and swap the live backend.
///
/// Storage settings are editable from the UI, so the backend resolved at
/// boot is not final. `api.setStorageConfig` writes its keys one at a
/// time and then calls this once, which is why the trigger is explicit:
/// reacting to individual key writes would observe torn configuration --
/// `storage.provider` already flipped to "s3" while `storage.s3.bucket`
/// is still unwritten.
///
/// The new backend is built and probed before it replaces the current
/// one. A bad credential or a typo'd endpoint therefore fails this
/// request and leaves the running process on its working backend,
/// rather than surfacing later as every asset returning 500.
#[post("/storage/reload")]
async fn reload_storage_handler(ctx: Data<AppContext>) -> Result<HttpResponse, Error> {
    let db_proxy_url = ctx.db_proxy_url.as_deref().ok_or_else(|| {
        actix_web::error::ErrorInternalServerError("databaseProxyUrl is not configured in .woofx3.json")
    })?;

    let config = resolve_repository_config(Some(db_proxy_url), crate::DEFAULT_MODULE_DIR)
        .await
        .map_err(|e| {
            error!("Storage reload: failed to resolve settings: {}", e);
            actix_web::error::ErrorBadGateway(format!("Failed to read storage settings: {}", e))
        })?;

    let candidate = RepositoryFactory::new(&config).await.map_err(|e| {
        error!("Storage reload: failed to build {}: {}", describe(&config), e);
        actix_web::error::ErrorBadRequest(format!("Failed to build storage backend: {}", e))
    })?;
    candidate.setup().map_err(|e| {
        error!("Storage reload: setup failed for {}: {}", describe(&config), e);
        actix_web::error::ErrorBadRequest(format!("Storage backend setup failed: {}", e))
    })?;

    // Probe before publishing. `setup` is a no-op for S3, so this listing
    // is the first thing that actually exercises the credentials, the
    // endpoint, and the bucket's existence.
    let new_keys = candidate.list_prefix(MODULES_PREFIX).await.map_err(|e| {
        error!("Storage reload: probe failed for {}: {}", describe(&config), e);
        actix_web::error::ErrorBadRequest(format!(
            "Storage backend unreachable or misconfigured: {}",
            e
        ))
    })?;

    let previous = ctx.repository.current();
    let stranded = stranded_modules(&*previous, &new_keys).await;

    ctx.repository.replace(candidate);
    info!("Storage backend reloaded: now {}", describe(&config));

    if !stranded.is_empty() {
        warn!(
            "{} module(s) are not present on the new storage backend and will 404 until reinstalled: {}",
            stranded.len(),
            stranded.join(", ")
        );
    }

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "provider": provider_name(&config),
        "stranded_modules": stranded,
    })))
}

/// Module directories present on the outgoing backend but missing from
/// the incoming one. Switching backends moves no content, so these stay
/// installed as far as the database is concerned while their assets are
/// no longer servable.
///
/// Reported, never fatal: failing to list the old backend (it may be the
/// very thing that was misconfigured) must not block a reload that is
/// fixing it.
async fn stranded_modules(previous: &RepositoryImpl, new_keys: &[String]) -> Vec<String> {
    let old_keys = match previous.list_prefix(MODULES_PREFIX).await {
        Ok(keys) => keys,
        Err(e) => {
            warn!("Storage reload: could not list current backend to report stranded modules: {}", e);
            return Vec::new();
        }
    };
    let new_dirs = module_dirs(new_keys);
    module_dirs(&old_keys)
        .into_iter()
        .filter(|dir| !new_dirs.contains(dir))
        .collect()
}

/// Collapse repository keys to their `modules/{module_key}/{version_dir}`
/// prefix. Keys below that depth are per-file and would report the same
/// module many times over.
fn module_dirs(keys: &[String]) -> BTreeSet<String> {
    keys.iter()
        .filter_map(|key| {
            let parts: Vec<&str> = key.split('/').collect();
            if parts.len() >= 3 && parts[0] == MODULES_PREFIX {
                Some(format!("{}/{}/{}", parts[0], parts[1], parts[2]))
            } else {
                None
            }
        })
        .collect()
}

fn provider_name(config: &RepositoryConfig) -> &'static str {
    match config {
        RepositoryConfig::File(_) => "file",
        RepositoryConfig::S3(_) => "s3",
    }
}

/// Credential-free description for logs.
fn describe(config: &RepositoryConfig) -> String {
    match config {
        RepositoryConfig::File(c) => format!("file (destination: {})", c.destination.display()),
        RepositoryConfig::S3(c) => format!(
            "s3 (bucket: {}, endpoint: {:?}, region: {:?})",
            c.bucket, c.endpoint, c.region
        ),
    }
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(reload_storage_handler);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_dirs_collapses_files_to_version_directories() {
        let keys = vec![
            "modules/spotify/4ede4a7/functions/poll.js".to_string(),
            "modules/spotify/4ede4a7/widgets/now_playing/index.html".to_string(),
            "modules/wolfy_profile/abc1234/manifest.json".to_string(),
        ];
        let dirs = module_dirs(&keys);
        assert_eq!(dirs.len(), 2);
        assert!(dirs.contains("modules/spotify/4ede4a7"));
        assert!(dirs.contains("modules/wolfy_profile/abc1234"));
    }

    #[test]
    fn module_dirs_ignores_keys_outside_modules_and_too_shallow() {
        let keys = vec![
            "archives/spotify:1.0.0:4ede4a7.zip".to_string(),
            "user/avatar.png".to_string(),
            "modules/spotify".to_string(),
        ];
        assert!(module_dirs(&keys).is_empty());
    }
}
