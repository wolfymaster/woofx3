//! Generic user-asset upload and processing.
//!
//! Three endpoints, all under the `user/` key prefix that
//! `routes::assets` already serves reads from:
//!
//!   `POST /assets/upload-url`     ask for permission to upload
//!   `PUT  /assets/upload/{token}` send the bytes (file backend only)
//!   `POST /assets/process`        derive a thumbnail, asynchronously
//!   `DELETE /assets/resource/{application_id}/{resource_id}`
//!                                 purge one resource's stored bytes
//!
//! The upload-url response is deliberately identical whichever storage
//! backend is live. On S3 the `uploadUrl` is a genuine presigned PUT
//! straight at the bucket; on local disk it points back at this
//! service's own token-guarded PUT. Either way the caller gets
//! `{uploadUrl, method, headers, expiresAt}` and performs one PUT, so
//! nothing upstream ever branches on the provider.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use actix_web::web::{Bytes, Data, Json, Path, ServiceConfig};
use actix_web::{HttpResponse, delete, post, put};
use lib_repository::{CreateFileRequest, Repository, UploadEndpoint, UploadRequest};
use tracing::{error, info, warn};
use serde::{Deserialize, Serialize};

use crate::callback::{send_processing_failure_callback, send_processing_success_callback};
use crate::services::thumbnail::{self, ThumbnailOutcome};
use crate::services::upload_token::{self, TokenError};
use crate::types::AppContext;

/// Upload grants are capabilities to write into the store, so they are
/// short-lived by default and hard-capped regardless of what the caller
/// asks for.
const DEFAULT_UPLOAD_TTL_SECONDS: u64 = 300;
const MAX_UPLOAD_TTL_SECONDS: u64 = 3600;

/// Ceiling on a single proxied upload. Only applies to the file
/// backend; S3 uploads never pass through this process.
const MAX_PROXIED_UPLOAD_BYTES: usize = 512 * 1024 * 1024;

/// The only processing utility implemented today. Named rather than
/// implied so adding a second one is an additive change.
const UTILITY_THUMBNAIL: &str = "thumbnail";

#[derive(Deserialize)]
struct UploadUrlRequest {
    /// Owner scope. Keys are `user/{application_id}/{resource_id}/...`,
    /// mirroring how `modules/` scopes by module key.
    application_id: String,
    resource_id: String,
    file_name: String,
    content_type: Option<String>,
    ttl_seconds: Option<u64>,
}

/// The provider-agnostic upload contract. `headers` must be sent
/// verbatim: on S3 they are covered by the signature.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadUrlResponse {
    repository_key: String,
    upload_url: String,
    method: &'static str,
    headers: Vec<UploadHeader>,
    /// Unix seconds. Absolute so the caller does not have to reason
    /// about clock skew against a relative TTL.
    expires_at: i64,
}

#[derive(Serialize)]
struct UploadHeader {
    name: String,
    value: String,
}

#[derive(Deserialize)]
struct ProcessRequest {
    repository_key: String,
    content_type: Option<String>,
    utility: String,
    /// Where to POST the outcome. Optional: without it the work still
    /// runs, it is simply fire-and-forget.
    callback_url: Option<String>,
    /// Opaque to barkloader, echoed back on the callback so the caller
    /// can correlate the completion with the row it is waiting on.
    resource_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessAcceptedResponse {
    accepted: bool,
    utility: String,
    repository_key: String,
}

/// Issue an upload grant for one `user/` key.
#[post("/assets/upload-url")]
async fn upload_url_handler(
    ctx: Data<AppContext>,
    body: Json<UploadUrlRequest>,
) -> HttpResponse {
    let request = body.into_inner();

    let key = match user_resource_key(&request.application_id, &request.resource_id, &request.file_name) {
        Ok(key) => key,
        Err(message) => {
            return HttpResponse::BadRequest().json(error_body(&message));
        }
    };

    let ttl = Duration::from_secs(
        request
            .ttl_seconds
            .unwrap_or(DEFAULT_UPLOAD_TTL_SECONDS)
            .clamp(1, MAX_UPLOAD_TTL_SECONDS),
    );
    let now = unix_now();
    let expires_at = now.saturating_add(ttl.as_secs() as i64);

    let repository = ctx.repository.current();
    let endpoint = repository
        .presign_upload(UploadRequest {
            key: &key,
            content_type: request.content_type.as_deref(),
            ttl,
        })
        .await;

    let (upload_url, headers) = match endpoint {
        Ok(UploadEndpoint::Presigned { url, headers }) => (
            url,
            headers
                .into_iter()
                .map(|(name, value)| UploadHeader { name, value })
                .collect(),
        ),
        Ok(UploadEndpoint::Unsupported) => {
            // Local disk: mint our own grant and point the caller at the
            // PUT endpoint below. Same shape, same single request.
            let secret = upload_secret();
            let issued = upload_token::issue(
                &secret,
                &key,
                request.content_type.as_deref(),
                ttl,
                now,
            );
            let Ok((token, _)) = issued else {
                error!("Failed to issue upload token for {}", key);
                return HttpResponse::InternalServerError()
                    .json(error_body("could not issue an upload grant"));
            };
            let base = ctx.public_url_resolver.resolve().await;
            let headers = match request.content_type.as_deref() {
                Some(content_type) => vec![UploadHeader {
                    name: "Content-Type".to_string(),
                    value: content_type.to_string(),
                }],
                None => Vec::new(),
            };
            (
                format!("{}/assets/upload/{}", base.trim_end_matches('/'), token),
                headers,
            )
        }
        Err(err) => {
            error!("Storage backend could not issue an upload grant for {}: {}", key, err);
            return HttpResponse::InternalServerError()
                .json(error_body("storage backend rejected the upload request"));
        }
    };

    info!("Issued upload grant for {} (expires {})", key, expires_at);
    HttpResponse::Ok().json(UploadUrlResponse {
        repository_key: key,
        upload_url,
        method: "PUT",
        headers,
        expires_at,
    })
}

/// Accept the bytes for a token-guarded upload. Only reached on the
/// file backend; the token names the key, so the request body is the
/// only thing the client controls here.
#[put("/assets/upload/{token}")]
async fn upload_handler(
    ctx: Data<AppContext>,
    path: Path<String>,
    body: Bytes,
) -> HttpResponse {
    let token = path.into_inner();
    let secret = upload_secret();

    let grant = match upload_token::verify(&secret, &token, unix_now()) {
        Ok(grant) => grant,
        Err(TokenError::Expired) => {
            return HttpResponse::Gone().json(error_body("upload grant expired"));
        }
        Err(err) => {
            warn!("Rejected upload token: {}", err);
            return HttpResponse::Forbidden().json(error_body("invalid upload grant"));
        }
    };

    // The signature already pins the key, but re-check the prefix: a
    // secret leak should still not become write access to `modules/`.
    if !grant.key.starts_with("user/") {
        error!("Upload token named a non-user key: {}", grant.key);
        return HttpResponse::Forbidden().json(error_body("invalid upload grant"));
    }
    if body.len() > MAX_PROXIED_UPLOAD_BYTES {
        return HttpResponse::PayloadTooLarge().json(error_body("upload exceeds size limit"));
    }
    if body.is_empty() {
        return HttpResponse::BadRequest().json(error_body("upload body was empty"));
    }

    let extension = std::path::Path::new(&grant.key)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_string());

    let repository = ctx.repository.current();
    let mut failed = Vec::new();
    let wrote = repository
        .create(
            [CreateFileRequest {
                content: Some(body.to_vec()),
                extension,
                file_name: grant.key.clone(),
            }],
            &mut failed,
        )
        .await;

    if wrote.is_err() || !failed.is_empty() {
        error!("Failed to store upload at {}", grant.key);
        return HttpResponse::InternalServerError().json(error_body("failed to store upload"));
    }

    info!("Stored {} bytes at {}", body.len(), grant.key);
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "repositoryKey": grant.key,
        "size": body.len(),
    }))
}

/// Kick off a processing utility. Returns 202 immediately; the outcome
/// arrives on `callback_url`, mirroring how module installs report
/// completion rather than blocking the request.
#[post("/assets/process")]
async fn process_handler(ctx: Data<AppContext>, body: Json<ProcessRequest>) -> HttpResponse {
    let request = body.into_inner();

    if request.utility != UTILITY_THUMBNAIL {
        return HttpResponse::BadRequest().json(error_body(&format!(
            "unknown processing utility {}",
            request.utility
        )));
    }
    if !request.repository_key.starts_with("user/") {
        return HttpResponse::BadRequest()
            .json(error_body("only user/ resources can be processed"));
    }

    let accepted = ProcessAcceptedResponse {
        accepted: true,
        utility: request.utility.clone(),
        repository_key: request.repository_key.clone(),
    };

    let repository = ctx.repository.current();
    tokio::spawn(async move {
        let outcome = thumbnail::generate(
            &repository,
            &request.repository_key,
            request.content_type.as_deref(),
        )
        .await;

        let Some(callback_url) = request.callback_url.as_deref() else {
            match outcome {
                Ok(result) => {
                    info!("Thumbnail job for {} finished: {:?}", request.repository_key, result);
                }
                Err(err) => {
                    error!("Thumbnail job for {} failed: {}", request.repository_key, err);
                }
            }
            return;
        };

        let resource_id = request.resource_id.as_deref().unwrap_or_default();
        match outcome {
            Ok(ThumbnailOutcome::Generated { repository_key, content_type, .. }) => {
                send_processing_success_callback(
                    callback_url,
                    resource_id,
                    &request.repository_key,
                    UTILITY_THUMBNAIL,
                    Some(&repository_key),
                    Some(&content_type),
                    None,
                )
                .await;
            }
            // Not an error: audio has no frame to show. The caller
            // records "no thumbnail" and stops asking.
            Ok(ThumbnailOutcome::NotApplicable { reason }) => {
                send_processing_success_callback(
                    callback_url,
                    resource_id,
                    &request.repository_key,
                    UTILITY_THUMBNAIL,
                    None,
                    None,
                    Some(&reason),
                )
                .await;
            }
            Err(err) => {
                send_processing_failure_callback(
                    callback_url,
                    resource_id,
                    &request.repository_key,
                    UTILITY_THUMBNAIL,
                    &err.to_string(),
                )
                .await;
            }
        }
    });

    HttpResponse::Accepted().json(accepted)
}

/// Build `user/{application_id}/{resource_id}/{file_name}`, rejecting
/// anything that would escape that shape. Both ids must be plain
/// segments and the file name is sanitized -- the resulting key is
/// then re-checked by `routes::assets::sanitize_asset_key` on read.
fn user_resource_key(
    application_id: &str,
    resource_id: &str,
    file_name: &str,
) -> Result<String, String> {
    if !is_safe_segment(application_id) {
        return Err("application_id must be a plain path segment".to_string());
    }
    if !is_safe_segment(resource_id) {
        return Err("resource_id must be a plain path segment".to_string());
    }
    // `sanitize` strips separators but preserves dots, so "../../etc/passwd"
    // arrives here as "....etcpasswd". That cannot escape the prefix once the
    // separators are gone, but it still reads as traversal and would create a
    // dotfile. Leading dots carry no meaning for an uploaded asset, so drop
    // them; interior dots are left alone to preserve extensions.
    let sanitized = sanitize_filename::sanitize(file_name);
    let sanitized = sanitized.trim_start_matches('.').to_string();
    if sanitized.is_empty() {
        return Err("file_name is not a usable file name".to_string());
    }
    Ok(format!("user/{}/{}/{}", application_id, resource_id, sanitized))
}

/// A usable path segment: non-empty, no separators, no traversal, and
/// restricted to characters that survive a URL round trip unescaped.
fn is_safe_segment(value: &str) -> bool {
    if value.is_empty() || value == "." || value == ".." {
        return false;
    }
    value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The signing secret for locally-issued upload grants. Startup already
/// fails without it (`validate_required_config`), so an empty value
/// here means the process is misconfigured rather than that a default
/// is wanted -- `upload_token::issue` rejects it.
fn upload_secret() -> String {
    crate::util::get_env_or_default_with_key(
        "WOOFX3_BARKLOADER_KEY",
        Some("barkloaderKey"),
        "",
    )
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn error_body(message: &str) -> serde_json::Value {
    serde_json::json!({ "success": false, "error": message })
}

/// Purge every object stored for one resource.
///
/// Addressed by id segments rather than a raw key so there is no
/// caller-supplied path to sanitize: the prefix is rebuilt here from
/// two validated segments and can only ever name a directory under
/// `user/`. Deleting the whole directory takes the upload and any
/// derived thumbnail together, which is what callers always want and
/// removes the chance of leaving a thumbnail orphaned behind its
/// source.
///
/// Idempotent: a prefix that stores nothing is a success, so a retried
/// delete does not fail.
#[delete("/assets/resource/{application_id}/{resource_id}")]
async fn delete_resource_handler(
    ctx: Data<AppContext>,
    path: Path<(String, String)>,
) -> HttpResponse {
    let (application_id, resource_id) = path.into_inner();
    if !is_safe_segment(&application_id) {
        return HttpResponse::BadRequest()
            .json(error_body("application_id must be a plain path segment"));
    }
    if !is_safe_segment(&resource_id) {
        return HttpResponse::BadRequest()
            .json(error_body("resource_id must be a plain path segment"));
    }

    let prefix = format!("user/{}/{}/", application_id, resource_id);
    let repository = ctx.repository.current();
    match repository.delete_prefix(&prefix).await {
        Ok(()) => {
            info!("Deleted stored objects under {}", prefix);
            HttpResponse::NoContent().finish()
        }
        Err(err) => {
            error!("Failed to delete stored objects under {}: {}", prefix, err);
            HttpResponse::InternalServerError()
                .json(error_body("failed to delete stored objects"))
        }
    }
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(upload_url_handler);
    cfg.service(upload_handler);
    cfg.service(process_handler);
    cfg.service(delete_resource_handler);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_documented_key_shape() {
        assert_eq!(
            user_resource_key("app-1", "res-1", "photo.png").unwrap(),
            "user/app-1/res-1/photo.png"
        );
    }

    #[test]
    fn rejects_ids_that_would_escape_the_user_prefix() {
        for bad in ["..", ".", "", "a/b", "a\\b", "a b", "../etc"] {
            assert!(
                user_resource_key(bad, "res-1", "photo.png").is_err(),
                "application_id {bad:?} should be rejected"
            );
            assert!(
                user_resource_key("app-1", bad, "photo.png").is_err(),
                "resource_id {bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn sanitizes_the_file_name_rather_than_rejecting_it() {
        // Traversal in the file name is stripped, not honored.
        let key = user_resource_key("app-1", "res-1", "../../etc/passwd").unwrap();
        assert_eq!(key, "user/app-1/res-1/etcpasswd");
        assert!(!key.contains(".."));
    }

    #[test]
    fn rejects_file_names_that_sanitize_to_nothing() {
        assert!(user_resource_key("app-1", "res-1", "").is_err());
        assert!(user_resource_key("app-1", "res-1", "..").is_err());
    }
}
