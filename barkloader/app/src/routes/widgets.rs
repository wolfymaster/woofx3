use actix_web::web::{Data, Path, ServiceConfig};
use actix_web::{HttpResponse, get};
use lib_repository::Repository;
use tracing::warn;
use serde::Serialize;

use crate::types::AppContext;
use lib_module::db_proxy_client::{HttpDbProxyClient, ModuleDbProxy};

#[derive(Serialize)]
struct FrameResponse {
    #[serde(rename = "entryHtml")]
    entry_html: String,
    #[serde(rename = "resourceBaseUrl")]
    resource_base_url: String,
}

/// Resolves a module widget's frame: raw entry HTML (fetched
/// server-to-server, for the caller to inject its own boot payload/shim
/// into) plus a ready-to-use public base URL for every other resource
/// under that widget's version-scoped asset root. Builtin widgets are
/// out of scope here — the caller (sceneManager) serves those from its
/// own local disk, same as streamware does today.
#[get("/widgets/{module_key}/{manifest_id}/frame")]
#[tracing::instrument(
    name = "GET /widgets/{module_key}/{manifest_id}/frame",
    skip_all,
    fields(module_key = %path.0, manifest_id = %path.1)
)]
async fn widget_frame_handler(ctx: Data<AppContext>, path: Path<(String, String)>) -> HttpResponse {
    let (module_key, manifest_id) = path.into_inner();
    let Some(db_proxy_url) = ctx.db_proxy_url.as_ref() else {
        warn!("widget_frame: db_proxy_url not configured; refusing {}:{}", module_key, manifest_id);
        return HttpResponse::ServiceUnavailable().finish();
    };
    let db_proxy = HttpDbProxyClient::new(db_proxy_url.clone());

    let entry = match db_proxy.get_widget_entry(&module_key, &manifest_id).await {
        Ok(Some(entry)) => entry,
        Ok(None) => {
            warn!("widget_frame: no widget registered for {}:{}", module_key, manifest_id);
            return HttpResponse::NotFound().finish();
        }
        Err(e) => {
            warn!("widget_frame: entry lookup failed for {}:{}: {}", module_key, manifest_id, e);
            return HttpResponse::InternalServerError().finish();
        }
    };
    let Some(entry) = sanitize_entry(&entry) else {
        warn!("widget_frame: registered entry rejected by traversal check: {}", entry);
        return HttpResponse::NotFound().finish();
    };

    let version_dir = match db_proxy.resolve_module_version_dir(&module_key).await {
        Ok(Some(dir)) => dir,
        Ok(None) => {
            warn!("widget_frame: module {} has no resolvable installed version", module_key);
            return HttpResponse::NotFound().finish();
        }
        Err(e) => {
            warn!("widget_frame: version resolve failed for {}: {}", module_key, e);
            return HttpResponse::InternalServerError().finish();
        }
    };

    let repo_key = format!("modules/{module_key}/{version_dir}/widgets/{manifest_id}/{entry}");
    let entry_html = match ctx.repository.current().read_file(&repo_key).await {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(e) => {
                warn!("widget_frame: entry document is not valid UTF-8 at {}: {}", repo_key, e);
                return HttpResponse::InternalServerError().finish();
            }
        },
        Err(e) => {
            warn!("widget_frame: repository read_file failed for key {}: {}", repo_key, e);
            return HttpResponse::NotFound().finish();
        }
    };

    let public_url = ctx.public_url_resolver.resolve().await;
    let resource_base_url = format!(
        "{}/assets/modules/{module_key}/{version_dir}/widgets/{manifest_id}/",
        public_url.trim_end_matches('/')
    );

    HttpResponse::Ok().json(FrameResponse {
        entry_html,
        resource_base_url,
    })
}

/// Registered `entry` values are operator/module-author data, not raw
/// request input, but they get the same traversal treatment as
/// `routes::assets`'s request-path sanitizer for defense in depth —
/// this endpoint reads a file server-side on the caller's behalf.
fn sanitize_entry(raw: &str) -> Option<String> {
    let entry = if raw.is_empty() { "index.html" } else { raw };
    if entry.contains('\\') {
        return None;
    }
    let segments: Vec<&str> = entry.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return None;
    }
    if segments.iter().any(|s| *s == "." || *s == "..") {
        return None;
    }
    Some(segments.join("/"))
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(widget_frame_handler);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_entry_defaults_to_index_html() {
        assert_eq!(sanitize_entry("").as_deref(), Some("index.html"));
    }

    #[test]
    fn sanitize_entry_rejects_traversal() {
        assert_eq!(sanitize_entry("../secret.html"), None);
        assert_eq!(sanitize_entry("a/../../b.html"), None);
        assert_eq!(sanitize_entry("a\\b.html"), None);
    }

    #[test]
    fn sanitize_entry_passes_through_valid_paths() {
        assert_eq!(sanitize_entry("index.html").as_deref(), Some("index.html"));
        assert_eq!(sanitize_entry("nested/entry.html").as_deref(), Some("nested/entry.html"));
    }
}
