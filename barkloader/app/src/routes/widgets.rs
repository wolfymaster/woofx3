use std::collections::HashSet;

use actix_web::web::{Data, Path, Query, ServiceConfig};
use actix_web::{HttpResponse, get};
use lib_repository::Repository;
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::services::frame_cache::{FrameCache, FrameKey};
use crate::types::AppContext;
use lib_module::db_proxy::{self as db_rpc, ModuleRecord};
use lib_module::db_proxy_client::{HttpDbProxyClient, ModuleDbProxy};
use lib_module::module_manifest::ModuleManifest;
use lib_module::theme::{self, InstalledModule, ResolvedTheme, SelectedTheme, ThemeListing};

#[derive(Serialize)]
pub struct FrameResponse {
    #[serde(rename = "entryHtml")]
    entry_html: String,
    #[serde(rename = "resourceBaseUrl")]
    resource_base_url: String,
    /// What the widget renders with when it declares a theme contract, or
    /// `null` for a widget that cannot be themed.
    theme: Option<ResolvedTheme>,
    /// The ids of the widget's `font` settings, whose families the scene
    /// manager serves to the frame.
    #[serde(rename = "fontSettings")]
    font_settings: Vec<String>,
}

/// Frames are resolved once per installed version and served from here; see
/// `services::frame_cache`.
pub type WidgetFrameCache = FrameCache<FrameResponse>;

#[derive(Deserialize)]
struct FrameQuery {
    /// The theme canonical id a placement's settings select, if any.
    #[serde(default)]
    theme: Option<String>,
}

/// Why a frame could not be resolved, as the status the handler answers.
/// Each is logged where it happens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrameError {
    NotFound,
    Internal,
}

/// Resolves a module widget's frame: raw entry HTML (fetched
/// server-to-server, for the caller to inject its own boot payload/shim
/// into) plus a ready-to-use public base URL for every other resource
/// under that widget's version-scoped asset root. Every widget resolves
/// through here, the bundled `woofx3` ones included -- there is no second
/// path serving widget frames from anywhere else.
///
/// Served from `ctx.frame_cache`: only the first request for a widget and
/// theme after an install, uninstall or storage swap resolves it.
#[get("/widgets/{module_key}/{manifest_id}/frame")]
#[tracing::instrument(
    name = "GET /widgets/{module_key}/{manifest_id}/frame",
    skip_all,
    fields(module_key = %path.0, manifest_id = %path.1)
)]
async fn widget_frame_handler(
    ctx: Data<AppContext>,
    path: Path<(String, String)>,
    query: Query<FrameQuery>,
) -> HttpResponse {
    let (module_key, manifest_id) = path.into_inner();
    let Some(db_proxy_url) = ctx.db_proxy_url.clone() else {
        warn!(
            "widget_frame: db_proxy_url not configured; refusing {}:{}",
            module_key, manifest_id
        );
        return HttpResponse::ServiceUnavailable().finish();
    };
    let theme = query
        .into_inner()
        .theme
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    let public_url = ctx.public_url_resolver.resolve().await;
    let key = FrameKey {
        module_key: module_key.clone(),
        manifest_id: manifest_id.clone(),
        theme: theme.clone(),
        public_url: public_url.clone(),
    };

    let resolved = ctx
        .frame_cache
        .get_or_resolve(key, || {
            resolve_frame(
                &ctx,
                &db_proxy_url,
                &module_key,
                &manifest_id,
                theme.as_deref(),
                &public_url,
            )
        })
        .await;
    match resolved {
        Ok(frame) => HttpResponse::Ok().json(&*frame),
        Err(FrameError::NotFound) => HttpResponse::NotFound().finish(),
        Err(FrameError::Internal) => HttpResponse::InternalServerError().finish(),
    }
}

async fn resolve_frame(
    ctx: &AppContext,
    db_proxy_url: &str,
    module_key: &str,
    manifest_id: &str,
    theme: Option<&str>,
    public_url: &str,
) -> Result<FrameResponse, FrameError> {
    let db_proxy = HttpDbProxyClient::new(db_proxy_url.to_string());

    let entry = match db_proxy.get_widget_entry(module_key, manifest_id).await {
        Ok(Some(entry)) => entry,
        Ok(None) => {
            warn!(
                "widget_frame: no widget registered for {}:{}",
                module_key, manifest_id
            );
            return Err(FrameError::NotFound);
        }
        Err(e) => {
            warn!(
                "widget_frame: entry lookup failed for {}:{}: {}",
                module_key, manifest_id, e
            );
            return Err(FrameError::Internal);
        }
    };
    let Some(entry) = sanitize_entry(&entry) else {
        warn!(
            "widget_frame: registered entry rejected by traversal check: {}",
            entry
        );
        return Err(FrameError::NotFound);
    };

    let record = match db_rpc::get_module_record_by_module_id(db_proxy_url, module_key).await {
        Ok(Some(record)) => record,
        Ok(None) => {
            warn!(
                "widget_frame: module {} has no resolvable installed version",
                module_key
            );
            return Err(FrameError::NotFound);
        }
        Err(e) => {
            warn!(
                "widget_frame: version resolve failed for {}: {}",
                module_key, e
            );
            return Err(FrameError::Internal);
        }
    };

    let Some(version_dir) = version_dir_of(&record) else {
        warn!(
            "widget_frame: module {} has no version directory in its key {:?}",
            module_key, record.module_key
        );
        return Err(FrameError::NotFound);
    };

    let repo_key = format!("modules/{module_key}/{version_dir}/widgets/{manifest_id}/{entry}");
    let entry_html = match ctx.repository.current().read_file(&repo_key).await {
        Ok(bytes) => match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(e) => {
                warn!(
                    "widget_frame: entry document is not valid UTF-8 at {}: {}",
                    repo_key, e
                );
                return Err(FrameError::Internal);
            }
        },
        Err(e) => {
            warn!(
                "widget_frame: repository read_file failed for key {}: {}",
                repo_key, e
            );
            return Err(FrameError::NotFound);
        }
    };

    let resource_base_url = format!(
        "{}/assets/modules/{module_key}/{version_dir}/widgets/{manifest_id}/",
        public_url.trim_end_matches('/')
    );

    let theme = resolve_frame_theme(
        ctx,
        db_proxy_url,
        &record,
        module_key,
        manifest_id,
        &resource_base_url,
        public_url,
        theme,
    )
    .await;

    let font_settings = record
        .manifest_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<ModuleManifest>(json).ok())
        .and_then(|manifest| {
            theme::find_target_widget(&manifest, manifest_id).map(|w| w.font_setting_ids())
        })
        .unwrap_or_default();

    Ok(FrameResponse {
        entry_html,
        resource_base_url,
        theme,
        font_settings,
    })
}

fn version_dir_of(record: &ModuleRecord) -> Option<String> {
    record
        .module_key
        .rsplit(':')
        .next()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// The theme a frame renders with, or `None` for a widget without a contract.
///
/// Never fails the frame: a theme that cannot be found, read or fitted
/// resolves to the contract defaults with the reason in `fallback`.
#[allow(clippy::too_many_arguments)]
async fn resolve_frame_theme(
    ctx: &AppContext,
    db_proxy_url: &str,
    record: &ModuleRecord,
    module_key: &str,
    manifest_id: &str,
    resource_base_url: &str,
    public_url: &str,
    selected: Option<&str>,
) -> Option<ResolvedTheme> {
    let manifest: ModuleManifest = serde_json::from_str(record.manifest_json.as_deref()?).ok()?;
    let widget = theme::find_target_widget(&manifest, manifest_id)?;
    widget.theme.as_ref()?;
    let widget_canonical_id = format!("{module_key}:widget:{manifest_id}");

    let selected = match selected.map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(canonical_id) => {
            let owner = match theme::parse_theme_id(canonical_id) {
                Some((theme_module, _)) if theme_module == module_key => {
                    InstalledModule::from_record(record.clone())
                }
                Some((theme_module, _)) => {
                    match db_rpc::get_module_record_by_module_id(db_proxy_url, theme_module).await {
                        Ok(found) => found.and_then(InstalledModule::from_record),
                        Err(e) => {
                            warn!(
                                "widget_frame: theme module lookup failed for {}: {}",
                                canonical_id, e
                            );
                            None
                        }
                    }
                }
                None => None,
            };
            Some((canonical_id.to_string(), owner))
        }
    };

    let Some((canonical_id, owner)) = selected else {
        return theme::resolve(widget, &widget_canonical_id, resource_base_url, None);
    };
    let found = owner.as_ref().and_then(|module| {
        let (_, theme_id) = theme::parse_theme_id(&canonical_id)?;
        let declared = module.manifest.themes.iter().find(|t| t.id == theme_id)?;
        Some((module, declared))
    });
    let mut missing_files: HashSet<String> = HashSet::new();
    if let Some((module, declared)) = found {
        let repository = ctx.repository.current();
        for path in declared.assets.values() {
            let present =
                match declared.repository_key(&module.module_id, &module.version_dir, path) {
                    Ok(key) => repository.exists(&key).await.unwrap_or(false),
                    Err(_) => false,
                };
            if !present {
                missing_files.insert(path.clone());
            }
        }
    }
    theme::resolve(
        widget,
        &widget_canonical_id,
        resource_base_url,
        Some(SelectedTheme {
            canonical_id,
            found: found.map(|(module, declared)| {
                (
                    declared,
                    theme::theme_base_url(public_url, module, declared),
                )
            }),
            missing_files,
        }),
    )
}

#[derive(Deserialize)]
struct ThemesQuery {
    /// The widget whose themes to list, as `{moduleId}:widget:{id}`.
    widget: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThemesResponse {
    widget: String,
    /// The widget's current contract version, or `null` when it declares no
    /// contract (and so has no themes to pick).
    contract_version: Option<u32>,
    themes: Vec<ThemeListing>,
}

/// Every installed theme made for one widget, for the settings picker.
/// Themes live in installed manifests, so this reads the module list rather
/// than a table of its own: installing or uninstalling a module is the only
/// thing that changes the answer.
#[get("/themes")]
#[tracing::instrument(name = "GET /themes", skip_all, fields(widget = %query.widget))]
async fn list_themes_handler(ctx: Data<AppContext>, query: Query<ThemesQuery>) -> HttpResponse {
    let widget = query.into_inner().widget;
    let Ok((widget_module, widget_id)) = theme::parse_widget_target(&widget) else {
        return HttpResponse::BadRequest().body("`widget` must be `{moduleId}:widget:{id}`");
    };
    let Some(db_proxy_url) = ctx.db_proxy_url.as_ref() else {
        warn!("list_themes: db_proxy_url not configured");
        return HttpResponse::ServiceUnavailable().finish();
    };
    let installed: Vec<InstalledModule> = match db_rpc::list_modules(db_proxy_url, None).await {
        Ok(records) => records
            .into_iter()
            .filter_map(InstalledModule::from_record)
            .collect(),
        Err(e) => {
            warn!("list_themes: ListModules failed: {}", e);
            return HttpResponse::InternalServerError().finish();
        }
    };
    let contract_version = installed
        .iter()
        .find(|m| m.module_id == widget_module)
        .and_then(|m| theme::find_target_widget(&m.manifest, widget_id))
        .and_then(|w| w.theme.as_ref())
        .map(|c| c.contract_version);
    let public_url = ctx.public_url_resolver.resolve().await;
    let themes = theme::list_for_widget(&installed, &widget, &public_url);
    HttpResponse::Ok().json(ThemesResponse {
        widget,
        contract_version,
        themes,
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
    cfg.service(list_themes_handler);
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
        assert_eq!(
            sanitize_entry("nested/entry.html").as_deref(),
            Some("nested/entry.html")
        );
    }
}
