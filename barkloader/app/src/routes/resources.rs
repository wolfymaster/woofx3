//! Generic user-asset upload and processing.
//!
//! Three endpoints, all under the `user/` key prefix that
//! `routes::assets` already serves reads from:
//!
//!   `POST /assets/upload-url`     ask for permission to upload
//!   `PUT  /assets/upload/{token}` send the bytes (file backend only)
//!   `POST /assets/process`        derive a thumbnail, asynchronously
//!   `DELETE /assets/resource`     purge one resource's stored bytes
//!
//! The upload-url response is deliberately identical whichever storage
//! backend is live. On S3 the `uploadUrl` is a genuine presigned PUT
//! straight at the bucket; on local disk it points back at this
//! service's own token-guarded PUT. Either way the caller gets
//! `{uploadUrl, method, headers, expiresAt}` and performs one PUT, so
//! nothing upstream ever branches on the provider.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use actix_web::error::PayloadError;
use actix_web::http::header;
use actix_web::web::{Bytes, Data, Json, Path, Payload, ServiceConfig};
use actix_web::{HttpRequest, HttpResponse, delete, post, put};
use futures_util::{Stream, StreamExt};
use lib_repository::{
    CreateFileRequest, Repository, RepositoryImpl, UploadEndpoint, UploadRequest,
};
use serde::{Deserialize, Serialize};
use tracing::{error, info, warn};

use crate::callback::{send_processing_failure_callback, send_processing_success_callback};
use crate::services::storage_settings::get_setting;
use crate::services::thumbnail::{self, ThumbnailOutcome};
use crate::services::upload_token::{self, TokenError};
use crate::types::{AppContext, SharedRepository};

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

/// Where the browser is told to send the bytes: `relay` (default) or `direct`.
///
/// A presigned PUT straight at the bucket is only usable from a browser if
/// that bucket carries a CORS policy allowing PUT from the dashboard's origin,
/// which the operator has to add by hand — an unconfigured bucket refuses the
/// preflight and the upload fails before a byte is sent, with nothing here able
/// to see it happen. Relaying goes through an edge that already answers the
/// preflight, so an upload works against any backend with no bucket
/// configuration. `direct` opts back into spending the bucket's bandwidth
/// rather than the engine's, for an operator who has configured CORS.
const SETTING_UPLOAD_MODE: &str = "storage.uploadMode";
const UPLOAD_MODE_DIRECT: &str = "direct";

#[derive(Deserialize)]
struct UploadUrlRequest {
    /// Keys are `user/{resource_id}/...`, mirroring how `modules/`
    /// scopes by module key.
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

/// Whether grants should presign straight at the backend instead of relaying.
/// Unreadable settings mean relay: it works everywhere, so it is the safe
/// answer when the answer is unknown.
async fn direct_upload_enabled(ctx: &AppContext) -> bool {
    let Some(db_proxy_url) = ctx.db_proxy_url.as_deref() else {
        return false;
    };
    match get_setting(db_proxy_url, SETTING_UPLOAD_MODE).await {
        Ok(Some(value)) => value.trim().eq_ignore_ascii_case(UPLOAD_MODE_DIRECT),
        Ok(None) => false,
        Err(err) => {
            warn!(
                "Failed to read {}: {}; relaying this upload",
                SETTING_UPLOAD_MODE, err
            );
            false
        }
    }
}

/// Issue an upload grant for one `user/` key.
#[post("/assets/upload-url")]
async fn upload_url_handler(ctx: Data<AppContext>, body: Json<UploadUrlRequest>) -> HttpResponse {
    let request = body.into_inner();

    let key = match user_resource_key(&request.resource_id, &request.file_name) {
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
    let endpoint = if direct_upload_enabled(&ctx).await {
        repository
            .presign_upload(UploadRequest {
                key: &key,
                content_type: request.content_type.as_deref(),
                ttl,
            })
            .await
    } else {
        Ok(UploadEndpoint::Unsupported)
    };

    let (upload_url, headers) = match endpoint {
        Ok(UploadEndpoint::Presigned { url, headers }) => (
            url,
            headers
                .into_iter()
                .map(|(name, value)| UploadHeader { name, value })
                .collect(),
        ),
        Ok(UploadEndpoint::Unsupported) => {
            // Relaying, either by configuration or because the backend cannot
            // presign at all (local disk): mint our own grant and point the
            // caller at the PUT endpoint below. Same shape, same single request.
            let secret = upload_secret();
            let issued =
                upload_token::issue(&secret, &key, request.content_type.as_deref(), ttl, now);
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
            error!(
                "Storage backend could not issue an upload grant for {}: {}",
                key, err
            );
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

/// Accept the bytes for a token-guarded upload. Reached whenever the grant
/// relays rather than presigns; the token names the key, so the request body
/// is the only thing the client controls here.
///
/// The body is read as a stream rather than through the `Bytes`
/// extractor, whose default 256 KiB limit would refuse most media long
/// before `MAX_PROXIED_UPLOAD_BYTES` applied.
#[put("/assets/upload/{token}")]
async fn upload_handler(
    repository: Data<SharedRepository>,
    request: HttpRequest,
    path: Path<String>,
    payload: Payload,
) -> HttpResponse {
    let token = path.into_inner();
    let declared_content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    let declared_length = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    accept_upload(
        &repository.current(),
        &upload_secret(),
        &token,
        declared_content_type,
        declared_length,
        payload,
        unix_now(),
    )
    .await
}

/// Everything `upload_handler` decides, with the secret, clock, and body
/// passed in so it can be exercised without a running app.
///
/// Checks run cheapest first and all of them before the body is read, so
/// a request that was never going to be stored is turned away without
/// its bytes crossing the wire.
///
/// A grant is honoured once: its key must not already hold an object.
/// That makes a leaked or replayed upload URL unable to overwrite a
/// resource after it has landed, without keeping a table of spent
/// tokens -- the stored object is the record that the grant was used.
async fn accept_upload<S>(
    repository: &RepositoryImpl,
    secret: &str,
    token: &str,
    declared_content_type: Option<&str>,
    declared_length: Option<u64>,
    mut body: S,
    now: i64,
) -> HttpResponse
where
    S: Stream<Item = Result<Bytes, PayloadError>> + Unpin,
{
    let grant = match upload_token::verify(secret, token, now) {
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

    // Same contract as an S3 presigned PUT, which signs the content type:
    // the bytes must be sent as what the grant was issued for.
    if let Some(granted) = grant.content_type.as_deref() {
        let matches = declared_content_type
            .is_some_and(|declared| declared.trim().eq_ignore_ascii_case(granted.trim()));
        if !matches {
            return HttpResponse::Forbidden()
                .json(error_body("content type does not match upload grant"));
        }
    }

    if declared_length.is_some_and(|length| length > MAX_PROXIED_UPLOAD_BYTES as u64) {
        return HttpResponse::PayloadTooLarge().json(error_body("upload exceeds size limit"));
    }

    match repository.exists(&grant.key).await {
        Ok(false) => {}
        Ok(true) => {
            return HttpResponse::Conflict().json(error_body("upload grant already used"));
        }
        Err(err) => {
            error!(
                "Failed to check for an existing upload at {}: {}",
                grant.key, err
            );
            return HttpResponse::InternalServerError().json(error_body("failed to store upload"));
        }
    }

    let mut content = Vec::with_capacity(
        declared_length
            .map(|length| length as usize)
            .unwrap_or(0)
            .min(MAX_PROXIED_UPLOAD_BYTES),
    );
    while let Some(chunk) = body.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(err) => {
                warn!("Upload body for {} ended with an error: {}", grant.key, err);
                return HttpResponse::BadRequest()
                    .json(error_body("upload body could not be read"));
            }
        };
        if content.len() + chunk.len() > MAX_PROXIED_UPLOAD_BYTES {
            return HttpResponse::PayloadTooLarge().json(error_body("upload exceeds size limit"));
        }
        content.extend_from_slice(&chunk);
    }
    if content.is_empty() {
        return HttpResponse::BadRequest().json(error_body("upload body was empty"));
    }

    let extension = std::path::Path::new(&grant.key)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_string());
    let size = content.len();

    let mut failed = Vec::new();
    let wrote = repository
        .create(
            [CreateFileRequest {
                content: Some(content),
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

    info!("Stored {} bytes at {}", size, grant.key);
    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "repositoryKey": grant.key,
        "size": size,
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
                    info!(
                        "Thumbnail job for {} finished: {:?}",
                        request.repository_key, result
                    );
                }
                Err(err) => {
                    error!(
                        "Thumbnail job for {} failed: {}",
                        request.repository_key, err
                    );
                }
            }
            return;
        };

        let resource_id = request.resource_id.as_deref().unwrap_or_default();
        match outcome {
            Ok(ThumbnailOutcome::Generated {
                repository_key,
                content_type,
                ..
            }) => {
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

/// Build `user/{resource_id}/{file_name}`, rejecting anything that
/// would escape that shape. The id must be a plain segment and the file
/// name is sanitized -- the resulting key is then re-checked by
/// `routes::assets::sanitize_asset_key` on read.
fn user_resource_key(resource_id: &str, file_name: &str) -> Result<String, String> {
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
    Ok(format!("user/{}/{}", resource_id, sanitized))
}

/// The directory holding every object stored for the resource whose
/// upload lives at `repository_key`, with a trailing `/`.
///
/// Callers pass the key exactly as it was stored rather than ids to
/// rebuild it from, because stored keys do not share one shape: current
/// uploads are `user/{resource_id}/{file}` while older rows carry an
/// extra leading segment. Whatever the depth, the upload and its derived
/// thumbnail share the key's parent directory.
///
/// The key must sit under `user/` with no empty, `.` or `..` segments,
/// and at least one directory below `user/` -- a key directly under
/// `user/` would make the directory every user upload at once.
fn resource_directory_for_key(repository_key: &str) -> Result<String, String> {
    let Some(rest) = repository_key.strip_prefix("user/") else {
        return Err("repositoryKey must start with user/".to_string());
    };
    let segments: Vec<&str> = rest.split('/').collect();
    for segment in &segments {
        if segment.is_empty() || *segment == "." || *segment == ".." {
            return Err("repositoryKey must not contain empty, . or .. segments".to_string());
        }
    }
    if segments.len() < 2 {
        return Err("repositoryKey must name a file inside a resource directory".to_string());
    }
    let directory = &segments[..segments.len() - 1];
    Ok(format!("user/{}/", directory.join("/")))
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
    crate::util::get_env_or_default_with_key("WOOFX3_BARKLOADER_KEY", Some("barkloaderKey"), "")
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteResourceRequest {
    /// The resource's `repository_key` exactly as stored.
    repository_key: String,
}

/// Purge every object stored for one resource.
///
/// Deletes the whole directory containing the stored key (see
/// `resource_directory_for_key`), which takes the upload and any
/// derived thumbnail together, so a thumbnail is never left orphaned
/// behind its source.
///
/// Idempotent: a prefix that stores nothing is a success, so a retried
/// delete does not fail.
#[delete("/assets/resource")]
async fn delete_resource_handler(
    ctx: Data<AppContext>,
    body: Json<DeleteResourceRequest>,
) -> HttpResponse {
    let prefix = match resource_directory_for_key(&body.repository_key) {
        Ok(prefix) => prefix,
        Err(message) => {
            return HttpResponse::BadRequest().json(error_body(&message));
        }
    };
    let repository = ctx.repository.current();
    match repository.delete_prefix(&prefix).await {
        Ok(()) => {
            info!("Deleted stored objects under {}", prefix);
            HttpResponse::NoContent().finish()
        }
        Err(err) => {
            error!("Failed to delete stored objects under {}: {}", prefix, err);
            HttpResponse::InternalServerError().json(error_body("failed to delete stored objects"))
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
            user_resource_key("res-1", "photo.png").unwrap(),
            "user/res-1/photo.png"
        );
    }

    #[test]
    fn rejects_ids_that_would_escape_the_user_prefix() {
        for bad in ["..", ".", "", "a/b", "a\\b", "a b", "../etc"] {
            assert!(
                user_resource_key(bad, "photo.png").is_err(),
                "resource_id {bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn sanitizes_the_file_name_rather_than_rejecting_it() {
        // Traversal in the file name is stripped, not honored.
        let key = user_resource_key("res-1", "../../etc/passwd").unwrap();
        assert_eq!(key, "user/res-1/etcpasswd");
        assert!(!key.contains(".."));
    }

    #[test]
    fn resource_directory_is_the_parent_of_the_stored_key() {
        assert_eq!(
            resource_directory_for_key("user/res-1/photo.png").unwrap(),
            "user/res-1/"
        );
        // Older rows carry an extra leading segment; the directory still
        // comes from the key itself, never from ids.
        assert_eq!(
            resource_directory_for_key("user/0b7c/res-1/photo.png").unwrap(),
            "user/0b7c/res-1/"
        );
    }

    #[test]
    fn resource_directory_rejects_keys_outside_a_resource_directory() {
        for bad in [
            "",
            "user/",
            "user/photo.png",
            "modules/m1/widget.html",
            "/user/res-1/photo.png",
            "users/res-1/photo.png",
            "user//photo.png",
            "user/res-1//photo.png",
            "user/res-1/",
            "user/../photo.png",
            "user/res-1/../../etc/passwd",
            "user/./photo.png",
        ] {
            assert!(
                resource_directory_for_key(bad).is_err(),
                "repositoryKey {bad:?} should be rejected"
            );
        }
    }

    mod upload {
        use super::super::*;
        use actix_web::App;
        use actix_web::test as actix_test;
        use futures_util::stream;
        use lib_repository::{FileRepository, FileRepositoryConfig};

        const SECRET: &str = "upload-test-secret";
        const NOW: i64 = 1_700_000_000;
        const KEY: &str = "user/res-1/clip.png";

        fn file_repo(root: &std::path::Path) -> RepositoryImpl {
            let repo = FileRepository::new(FileRepositoryConfig {
                destination: root.to_path_buf(),
            });
            repo.setup().expect("repo setup");
            RepositoryImpl::File(repo)
        }

        fn token_for(key: &str, content_type: Option<&str>) -> String {
            upload_token::issue(SECRET, key, content_type, Duration::from_secs(300), NOW)
                .expect("issue token")
                .0
        }

        fn body_of(
            chunks: &[&[u8]],
        ) -> impl Stream<Item = Result<Bytes, PayloadError>> + Unpin + use<> {
            let chunks: Vec<Result<Bytes, PayloadError>> = chunks
                .iter()
                .map(|chunk| Ok(Bytes::copy_from_slice(chunk)))
                .collect();
            stream::iter(chunks)
        }

        /// A body that fails the test if anything reads it: for checks
        /// that must refuse before the bytes are pulled.
        fn unread_body() -> impl Stream<Item = Result<Bytes, PayloadError>> + Unpin {
            stream::poll_fn(|_| panic!("the body must not be read"))
        }

        async fn status_of(response: HttpResponse) -> u16 {
            response.status().as_u16()
        }

        #[actix_web::test]
        async fn valid_grant_writes_the_bytes_at_the_key_under_the_storage_root() {
            let root = tempfile::tempdir().expect("tempdir");
            let repo = file_repo(root.path());

            let response = accept_upload(
                &repo,
                SECRET,
                &token_for(KEY, Some("image/png")),
                Some("image/png"),
                Some(10),
                body_of(&[b"\x89PNG", b"-bytes"]),
                NOW,
            )
            .await;

            assert_eq!(status_of(response).await, 200);
            let on_disk = std::fs::read(root.path().join(KEY)).expect("upload on disk");
            assert_eq!(on_disk, b"\x89PNG-bytes");
            let leftovers: Vec<_> = std::fs::read_dir(root.path().join("user/res-1"))
                .expect("resource dir")
                .map(|entry| entry.expect("dir entry").file_name())
                .collect();
            assert_eq!(leftovers, vec![std::ffi::OsString::from("clip.png")]);
        }

        #[actix_web::test]
        async fn a_grant_is_good_for_one_upload() {
            let root = tempfile::tempdir().expect("tempdir");
            let repo = file_repo(root.path());
            let token = token_for(KEY, Some("image/png"));

            let first = accept_upload(
                &repo,
                SECRET,
                &token,
                Some("image/png"),
                None,
                body_of(&[b"original"]),
                NOW,
            )
            .await;
            assert_eq!(status_of(first).await, 200);

            let replay = accept_upload(
                &repo,
                SECRET,
                &token,
                Some("image/png"),
                None,
                unread_body(),
                NOW + 1,
            )
            .await;
            assert_eq!(status_of(replay).await, 409);
            assert_eq!(std::fs::read(root.path().join(KEY)).unwrap(), b"original");
        }

        #[actix_web::test]
        async fn expired_grant_is_refused_and_writes_nothing() {
            let root = tempfile::tempdir().expect("tempdir");
            let repo = file_repo(root.path());

            let response = accept_upload(
                &repo,
                SECRET,
                &token_for(KEY, Some("image/png")),
                Some("image/png"),
                None,
                unread_body(),
                NOW + 300,
            )
            .await;

            assert_eq!(status_of(response).await, 410);
            assert!(!root.path().join(KEY).exists());
        }

        #[actix_web::test]
        async fn forged_grant_is_refused() {
            let root = tempfile::tempdir().expect("tempdir");
            let repo = file_repo(root.path());
            let token =
                upload_token::issue("another-secret", KEY, None, Duration::from_secs(300), NOW)
                    .expect("issue token")
                    .0;

            let response =
                accept_upload(&repo, SECRET, &token, None, None, unread_body(), NOW).await;

            assert_eq!(status_of(response).await, 403);
            assert!(!root.path().join(KEY).exists());
        }

        #[actix_web::test]
        async fn grant_for_a_non_user_key_is_refused() {
            let root = tempfile::tempdir().expect("tempdir");
            let repo = file_repo(root.path());

            let response = accept_upload(
                &repo,
                SECRET,
                &token_for("modules/m1/index.js", None),
                None,
                None,
                unread_body(),
                NOW,
            )
            .await;

            assert_eq!(status_of(response).await, 403);
        }

        #[actix_web::test]
        async fn bytes_must_be_sent_as_the_granted_content_type() {
            let root = tempfile::tempdir().expect("tempdir");
            let repo = file_repo(root.path());
            let token = token_for(KEY, Some("image/png"));

            for declared in [Some("text/html"), None] {
                let response =
                    accept_upload(&repo, SECRET, &token, declared, None, unread_body(), NOW).await;
                assert_eq!(status_of(response).await, 403, "declared {declared:?}");
            }

            // Media types are case-insensitive.
            let response = accept_upload(
                &repo,
                SECRET,
                &token,
                Some("Image/PNG"),
                None,
                body_of(&[b"x"]),
                NOW,
            )
            .await;
            assert_eq!(status_of(response).await, 200);
        }

        #[actix_web::test]
        async fn declared_oversize_is_refused_before_reading() {
            let root = tempfile::tempdir().expect("tempdir");
            let repo = file_repo(root.path());

            let response = accept_upload(
                &repo,
                SECRET,
                &token_for(KEY, None),
                None,
                Some(MAX_PROXIED_UPLOAD_BYTES as u64 + 1),
                unread_body(),
                NOW,
            )
            .await;

            assert_eq!(status_of(response).await, 413);
        }

        #[actix_web::test]
        async fn empty_body_is_refused() {
            let root = tempfile::tempdir().expect("tempdir");
            let repo = file_repo(root.path());

            let response = accept_upload(
                &repo,
                SECRET,
                &token_for(KEY, None),
                None,
                Some(0),
                body_of(&[]),
                NOW,
            )
            .await;

            assert_eq!(status_of(response).await, 400);
            assert!(!root.path().join(KEY).exists());
        }

        /// Through the real route, so the extractor in front of
        /// `accept_upload` is covered too: a body past actix's 256 KiB
        /// default payload limit must still be stored.
        #[actix_web::test]
        async fn route_stores_a_body_larger_than_the_default_payload_limit() {
            // SAFETY: test-only env mutation. No other test reads this
            // variable, and the value is fixed.
            unsafe {
                std::env::set_var("WOOFX3_BARKLOADER_KEY", SECRET);
            }
            let secret = upload_secret();
            assert!(
                !secret.is_empty(),
                "upload secret must resolve for this test"
            );

            let root = tempfile::tempdir().expect("tempdir");
            let app = actix_test::init_service(
                App::new()
                    .app_data(Data::new(SharedRepository::new(file_repo(root.path()))))
                    .service(upload_handler),
            )
            .await;

            let (token, _) = upload_token::issue(
                &secret,
                "user/res-2/clip.mp4",
                Some("video/mp4"),
                Duration::from_secs(300),
                unix_now(),
            )
            .expect("issue token");
            let bytes = vec![7u8; 1024 * 1024];
            let request = actix_test::TestRequest::put()
                .uri(&format!("/assets/upload/{token}"))
                .insert_header((header::CONTENT_TYPE, "video/mp4"))
                .set_payload(bytes.clone())
                .to_request();
            let response = actix_test::call_service(&app, request).await;

            assert_eq!(response.status(), 200);
            let stored =
                std::fs::read(root.path().join("user/res-2/clip.mp4")).expect("upload on disk");
            assert_eq!(stored.len(), bytes.len());
        }
    }

    #[test]
    fn rejects_file_names_that_sanitize_to_nothing() {
        assert!(user_resource_key("res-1", "").is_err());
        assert!(user_resource_key("res-1", "..").is_err());
    }
}
