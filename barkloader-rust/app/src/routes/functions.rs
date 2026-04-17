use actix_multipart::Multipart;
use actix_web::web::Data;
use actix_web::{Error, HttpResponse, patch, post, web::ServiceConfig};
use lib_repository::{CreateFileRequest, Repository};
use lib_sandbox::models::function::Function;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Read as _;
use std::path::PathBuf;
use tokio::task;

use crate::services::module_service::db_proxy::complete_module_install;
use crate::services::file_service::FileService;
use crate::services::module_service::module_delete::{
    notify_delete, resolve_module, run_delete_resolved, DeleteError,
};
use crate::services::module_service::{db_proxy, ModuleFileKind, ModuleService, ModuleServiceConfig};
use crate::types::{AppContext, SafeTempDir};

#[derive(Serialize)]
struct UploadResponse {
    success: bool,
    original_filename: String,
    extension: Option<String>,
    message: String,
}

#[derive(Deserialize)]
struct StateRequest {
    state: String,
}

#[derive(Deserialize)]
struct RollbackQuery {
    version: String,
}

#[derive(Deserialize)]
struct UploadQuery {
    force: Option<bool>,
}

#[derive(Deserialize)]
struct DeleteQuery {
    client_id: Option<String>,
    module_key: Option<String>,
}

#[post("/functions")]
async fn upload_handler(
    _req: actix_web::HttpRequest,
    ctx: Data<AppContext>,
    multipart: Multipart,
    query: actix_web::web::Query<UploadQuery>,
) -> Result<HttpResponse, Error> {
    let force = query.force.unwrap_or(false);

    let file_service = FileService::new("./uploads");

    // upload the file to temporary location for processing;
    // multipart fields client_id and module_key are extracted alongside the file
    let metadata: crate::services::file_service::FileMetadata =
        file_service.process_upload(multipart).await?;

    let expected_module_key = metadata.module_key.clone().unwrap_or_default();

    let mut request_context = {
        let client_id = metadata.client_id.clone().unwrap_or_default();
        let application_id = ctx.application_id.clone().unwrap_or_default();
        info!(
            "Upload form fields: client_id={:?} module_key={:?} application_id={:?}",
            metadata.client_id, metadata.module_key, application_id
        );
        Some(db_proxy::RequestContext {
            client_id,
            application_id,
            module_key: String::new(),
        })
    };

    // archive the zip file (in case we need it at some later point)

    let response = UploadResponse {
        success: true,
        original_filename: metadata.file_name.clone(),
        extension: metadata.file_extension.clone(),
        message: "File uploaded successfully".to_string(),
    };

    task::spawn(async move {
        // SafeTempDir with automatic cleanup on drop
        let _upload_cleanup = SafeTempDir::new(PathBuf::from(&metadata.temp_dir_path), PathBuf::from("./uploads"));

        // save original zip path before processing extracts files
        let original_zip_path = PathBuf::from(&metadata.temp_dir_path).join(&metadata.file_name);

        // compute SHA-256 hash of the zip for the composite module_key
        let zip_hash = match fs::read(&original_zip_path) {
            Ok(bytes) => {
                let mut hasher = Sha256::new();
                hasher.update(&bytes);
                format!("{:x}", hasher.finalize())
            }
            Err(e) => {
                error!("Failed to read zip for hashing: {}", e);
                "0000000".to_string()
            }
        };
        let zip_hash_short = zip_hash[..7_usize.min(zip_hash.len())].to_string();

        // Helper: send install status notification to db proxy via outbox
        async fn notify_install(
            db_proxy_url: Option<&str>,
            module_name: &str,
            version: &str,
            status: &str,
            error_msg: &str,
            request_context: Option<&db_proxy::RequestContext>,
        ) {
            let Some(url) = db_proxy_url else {
                warn!("DB_PROXY_URL not set, skipping install notification for {}/{}", module_name, version);
                return;
            };

            info!("Notifying db proxy: module={}/{} status={}", module_name, version, status);

            // Try to resolve module_id from db proxy; use empty string if not found
            let module_id = match super::super::services::module_service::db_proxy::get_module_by_name(url, module_name).await {
                Ok(Some(resp)) => {
                    let v: serde_json::Value = serde_json::from_str(&resp).unwrap_or_default();
                    v.get("module").and_then(|m| m.get("id")).and_then(|v| v.as_str()).unwrap_or("").to_string()
                }
                _ => String::new(),
            };

            info!("Sending CompleteModuleInstall: module_id={} name={} version={} status={}", module_id, module_name, version, status);
            match complete_module_install(url, &module_id, module_name, version, status, error_msg, request_context).await {
                Ok(_) => info!("CompleteModuleInstall succeeded for {}/{} (status={})", module_name, version, status),
                Err(e) => error!("CompleteModuleInstall failed for {}/{}: {}", module_name, version, e),
            }
        }

        // process uploaded file into list of file metadata
        let metadatas = file_service.process_uploaded_file(metadata).await;
        if metadatas.is_err() {
            let err_msg = format!("{}", metadatas.err().unwrap());
            error!("Failed to process uploaded file: {}", err_msg);
            notify_install(ctx.db_proxy_url.as_deref(), "unknown", "unknown", "failed", &err_msg, request_context.as_ref()).await;
            return;
        }

        // hand list of metadata to be processed by module service
        let file_metadata = metadatas.ok().unwrap();

        let module_config = ModuleServiceConfig {
            repository: ctx.repository.clone(),
        };
        let mut module = ModuleService::new(module_config);

        // DEBUG: log all extracted files
        log::info!("=== ZIP CONTENTS ({} entries) ===", file_metadata.len());
        for data in &file_metadata {
            log::info!(
                "  file: {:?}  ext: {:?}  dir: {:?}",
                data.file_name,
                data.file_extension,
                data.temp_dir_path,
            );
        }
        log::info!("=== END ZIP CONTENTS ===");

        // loop the file meta and add files to module
        // skip the original zip folder in the directory
        for data in file_metadata {
            // if there is no extension, skip
            let Some(extension) = &data.file_extension else {
                warn!("missing file extension on file: {}", &data.file_name);
                continue;
            };

            // if we can't handle the extension, skip
            let kind = match extension.parse::<ModuleFileKind>() {
                Ok(k) => k,
                Err(_) => {
                    if extension.to_lowercase().trim() == "zip" {
                        continue;
                    }
                    warn!("skipping file extension: {}", &extension);
                    continue;
                }
            };

            let file_path = std::path::PathBuf::from(&data.temp_dir_path).join(&data.file_name);
            let Ok(contents) = fs::read(&file_path) else {
                error!("Failed to read file contents: {}", &data.file_name);
                continue;
            };

            module.add_file(kind, &data.file_name, contents);
        }

        // DEBUG: log what files were added to the module service
        log::info!("=== FILES ADDED TO MODULE SERVICE ===");
        for f in module.files() {
            log::info!("  name: {:?}  kind: {:?}", f.name, f.kind);
        }
        log::info!("=== END FILES ADDED ===");

        // run workflow to create module and upload files to repository
        let module_plan = match module.create_plan() {
            Ok(v) => v,
            Err(err) => {
                let err_msg = err.to_string();
                error!("Failed to create module plan: {}", err_msg);
                notify_install(ctx.db_proxy_url.as_deref(), "unknown", "unknown", "failed", &err_msg, request_context.as_ref()).await;
                return;
            }
        };

        let (module_id, module_name, module_version) = match (module.module_id(), module.module_name(), module.module_version()) {
            (Some(id), Some(n), Some(v)) => (id, n, v),
            _ => {
                let err_msg = "module identity missing after create_plan";
                error!("{}", err_msg);
                notify_install(ctx.db_proxy_url.as_deref(), "unknown", "unknown", "failed", err_msg, request_context.as_ref()).await;
                return;
            }
        };

        // Compute the composite module_key: {id}:{version}:{hash[:7]}
        let computed_module_key = format!("{}:{}:{}", module_id, module_version, zip_hash_short);
        info!(
            "module_key components: id={} name={} version={} hash={} (full_hash={}) => {}",
            module_id, module_name, module_version, zip_hash_short, zip_hash, computed_module_key
        );

        // Validate against expected module_key if one was provided by the caller
        if !expected_module_key.is_empty() && expected_module_key != computed_module_key {
            let err_msg = format!(
                "ModuleKeyMismatch: expected '{}', computed '{}'",
                expected_module_key, computed_module_key
            );
            error!("{}", err_msg);
            // Inject module_key into request context for the notification
            if let Some(ref mut rc) = request_context {
                rc.module_key = expected_module_key.clone();
            }
            notify_install(ctx.db_proxy_url.as_deref(), module_name, module_version, "failed", &err_msg, request_context.as_ref()).await;
            return;
        }

        // Inject module_key into request context
        if let Some(ref mut rc) = request_context {
            rc.module_key = computed_module_key.clone();
        }

        let archive_key = format!("archives/{}.zip", computed_module_key);

        if !force {
            if ctx.repository.exists(&archive_key).await.unwrap_or(false) {
                let err_msg = format!(
                    "Module '{}' version '{}' already exists. Use force=true to overwrite.",
                    module_name, module_version
                );
                error!("{}", err_msg);
                notify_install(ctx.db_proxy_url.as_deref(), module_name, module_version, "failed", &err_msg, request_context.as_ref()).await;
                return;
            }
        }

        let upload_client_id = request_context
            .as_ref()
            .map(|rc| rc.client_id.clone())
            .unwrap_or_default();
        if let Err(e) = module
            .execute_plan(
                &module_plan,
                &archive_key,
                ctx.db_proxy_url.as_deref(),
                ctx.application_id.as_deref(),
                force,
                &computed_module_key,
                &upload_client_id,
            )
            .await
        {
            let err_msg = e.to_string();
            error!("Module install failed: {}", err_msg);
            notify_install(ctx.db_proxy_url.as_deref(), module_name, module_version, "failed", &err_msg, request_context.as_ref()).await;
            return;
        }

        // archive the original zip keyed by module_key
        if let (Some(name), Some(version)) = (module.module_name(), module.module_version()) {
            if let Ok(zip_bytes) = fs::read(&original_zip_path) {
                let archive_key = format!("archives/{}.zip", computed_module_key);
                let req = CreateFileRequest {
                    content: Some(zip_bytes),
                    extension: Some("zip".to_string()),
                    file_name: archive_key.clone(),
                };
                let mut failed: Vec<String> = Vec::new();
                match ctx.repository.create([req], &mut failed).await {
                    Ok(_) if failed.is_empty() => {
                        info!("Archived module zip to {}", archive_key);
                    }
                    Ok(_) => {
                        error!("Failed to archive zip to {}", archive_key);
                    }
                    Err(err) => {
                        error!("Failed to archive zip: {}", err);
                    }
                }
            } else {
                warn!("Original zip not found at {}, skipping archive", original_zip_path.display());
            }

            notify_install(ctx.db_proxy_url.as_deref(), name, version, "completed", "", request_context.as_ref()).await;
        }
    });

    Ok(HttpResponse::Ok().json(response))
}

#[post("/functions/{name}/register")]
async fn register_handler(
    ctx: Data<AppContext>,
    path: actix_web::web::Path<String>,
) -> Result<HttpResponse, Error> {
    let module_name = path.into_inner();

    let prefix = format!("modules/{}/", module_name);
    let file_keys = ctx.repository.list_prefix(&prefix)
        .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

    if file_keys.is_empty() {
        return Ok(HttpResponse::NotFound().json(serde_json::json!({
            "error": format!("No files found for module '{}'", module_name)
        })));
    }

    let mut functions = HashMap::new();
    for key in &file_keys {
        let ext = std::path::Path::new(key)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if ext != "lua" && ext != "js" {
            continue;
        }
        let file_name = std::path::Path::new(key).file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let func_name = std::path::Path::new(file_name).file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        let bytes = ctx.repository.read_file(key)
            .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;
        let code = String::from_utf8_lossy(&bytes).to_string();

        functions.insert(func_name.to_string(), Function::new(
            func_name.to_string(),
            file_name.to_string(),
            code,
            false,
        ));
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let module = lib_sandbox::RegisteredModule {
        metadata: lib_sandbox::ModuleMetadata {
            name: module_name.clone(),
            version: "1.0.0".to_string(),
            installed_at: now,
            updated_at: now,
        },
        functions,
        state: lib_sandbox::ModuleState::Active,
    };

    ctx.registry.register_module(module_name.clone(), module)
        .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "module": module_name,
        "message": "Module registered successfully"
    })))
}

#[actix_web::delete("/functions/{name}")]
async fn delete_handler(
    ctx: Data<AppContext>,
    path: actix_web::web::Path<String>,
    query: actix_web::web::Query<DeleteQuery>,
) -> Result<HttpResponse, Error> {
    let module_name = path.into_inner();
    let client_id = query.client_id.clone().unwrap_or_default();
    // Caller-supplied moduleKey. Used as a fallback when the engine no
    // longer has a record of the module (idempotent delete): the UI still
    // needs a moduleKey on the callback to correlate with its local state.
    let caller_module_key = query.module_key.clone().unwrap_or_default();
    let application_id = ctx.application_id.clone().unwrap_or_default();

    // Acknowledge the request synchronously. Actual deletion runs in a
    // background task and communicates its result via CompleteModuleDelete,
    // which the db-proxy publishes to NATS for the API layer to forward to
    // the UI over webhook.
    let ack = serde_json::json!({
        "requested": true,
        "module": module_name,
        "message": "Module deletion requested"
    });

    let Some(db_proxy_url) = ctx.db_proxy_url.clone() else {
        warn!("DB_PROXY_ADDR not set; cannot process module delete request for {}", module_name);
        return Ok(HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "error": "db_proxy_url not configured"
        })));
    };

    let ctx_clone = ctx.clone();
    let module_name_task = module_name.clone();

    tokio::spawn(async move {
        let mut request_context = db_proxy::RequestContext {
            client_id,
            application_id: application_id.clone(),
            module_key: caller_module_key.clone(),
        };

        let app_id_opt = if application_id.is_empty() { None } else { Some(application_id.as_str()) };
        let registry = ctx_clone.registry.clone();

        // Resolve the module eagerly so the callback always carries
        // module_key — both on success and on any subsequent failure.
        //
        // If the module does not exist, treat the delete as already-done and
        // report success (idempotent delete — the end state is what the
        // caller wanted).
        let resolved = match resolve_module(&db_proxy_url, &module_name_task).await {
            Ok(Some(r)) => r,
            Ok(None) => {
                // request_context.module_key was seeded with the caller's
                // moduleKey, so the UI receives the key it sent in the
                // deletion request even though we have no DB record.
                info!(
                    "Module {} already absent (caller module_key={:?}), treating delete as no-op success",
                    module_name_task, request_context.module_key
                );
                notify_delete(
                    &db_proxy_url,
                    "",
                    &module_name_task,
                    "completed",
                    "",
                    &[],
                    Some(&request_context),
                ).await;
                return;
            }
            Err(e) => {
                let msg = format!("failed to resolve module {}: {}", module_name_task, e);
                error!("{}", msg);
                notify_delete(
                    &db_proxy_url,
                    "",
                    &module_name_task,
                    "failed",
                    &msg,
                    &[],
                    Some(&request_context),
                ).await;
                return;
            }
        };
        request_context.module_key = resolved.module_key.clone();

        match run_delete_resolved(
            &resolved,
            &module_name_task,
            &db_proxy_url,
            app_id_opt,
            &ctx_clone.repository,
            registry,
        ).await {
            Ok(_) => {
                info!(
                    "Module {} deleted successfully (id={}, key={})",
                    module_name_task, resolved.module_id, resolved.module_key
                );
                notify_delete(
                    &db_proxy_url,
                    &resolved.module_id,
                    &module_name_task,
                    "completed",
                    "",
                    &[],
                    Some(&request_context),
                ).await;
            }
            Err(DeleteError::InUse(list)) => {
                error!("Module {} cannot be deleted: {} resource(s) still in use", module_name_task, list.len());
                notify_delete(
                    &db_proxy_url,
                    &resolved.module_id,
                    &module_name_task,
                    "failed",
                    "One or more resources are still in use by other workflows or commands",
                    &list,
                    Some(&request_context),
                ).await;
            }
            Err(DeleteError::Other(e)) => {
                let msg = e.to_string();
                error!("Module {} delete failed: {}", module_name_task, msg);
                notify_delete(
                    &db_proxy_url,
                    &resolved.module_id,
                    &module_name_task,
                    "failed",
                    &msg,
                    &[],
                    Some(&request_context),
                ).await;
            }
        }
    });

    Ok(HttpResponse::Accepted().json(ack))
}

#[patch("/functions/{name}/state")]
async fn state_handler(
    ctx: Data<AppContext>,
    path: actix_web::web::Path<String>,
    body: actix_web::web::Json<StateRequest>,
) -> Result<HttpResponse, Error> {
    let module_name = path.into_inner();
    let new_state = match body.state.as_str() {
        "active" => lib_sandbox::ModuleState::Active,
        "disabled" => lib_sandbox::ModuleState::Disabled,
        _ => return Ok(HttpResponse::BadRequest().json(serde_json::json!({
            "error": "state must be 'active' or 'disabled'"
        }))),
    };

    ctx.registry.set_module_state(&module_name, new_state)
        .map_err(|e| actix_web::error::ErrorNotFound(e.to_string()))?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "module": module_name,
        "state": body.state
    })))
}

#[patch("/functions/reload")]
async fn reload_handler(_ctx: Data<AppContext>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Modules reloaded"
    })))
}

#[actix_web::get("/functions")]
async fn list_handler(ctx: Data<AppContext>) -> Result<HttpResponse, Error> {
    let modules = ctx.registry.list_registered_modules();
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "modules": modules.iter().map(|m| serde_json::json!({
            "name": m.metadata.name,
            "version": m.metadata.version,
            "state": format!("{:?}", m.state).to_lowercase(),
        })).collect::<Vec<_>>()
    })))
}

#[actix_web::get("/functions/{name}")]
async fn get_handler(
    ctx: Data<AppContext>,
    path: actix_web::web::Path<String>,
) -> Result<HttpResponse, Error> {
    let module_name = path.into_inner();
    let modules = ctx.registry.list_modules();
    let module = modules.iter().find(|m| m.name == module_name);

    match module {
        Some(m) => Ok(HttpResponse::Ok().json(serde_json::json!({
            "name": m.name,
            "version": m.version,
        }))),
        None => Ok(HttpResponse::NotFound().json(serde_json::json!({
            "error": format!("Module '{}' not found", module_name)
        }))),
    }
}

#[actix_web::get("/functions/{name}/versions")]
async fn versions_handler(
    ctx: Data<AppContext>,
    path: actix_web::web::Path<String>,
) -> Result<HttpResponse, Error> {
    let module_name = path.into_inner();

    let prefix = format!("archives/{}/", module_name);
    let archive_keys = ctx.repository.list_prefix(&prefix)
        .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

    let versions: Vec<String> = archive_keys.iter()
        .filter_map(|key| {
            std::path::Path::new(key).file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .collect();

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "module": module_name,
        "versions": versions
    })))
}

#[post("/functions/{name}/rollback")]
async fn rollback_handler(
    ctx: Data<AppContext>,
    path: actix_web::web::Path<String>,
    query: actix_web::web::Query<RollbackQuery>,
) -> Result<HttpResponse, Error> {
    let module_name = path.into_inner();
    let version = &query.version;

    let archive_key = format!("archives/{}/{}.zip", module_name, version);
    let zip_bytes = ctx.repository.read_file(&archive_key)
        .map_err(|e| actix_web::error::ErrorNotFound(
            format!("Archive not found for module '{}' version '{}': {}", module_name, version, e)
        ))?;

    let temp_dir = tempfile::tempdir()
        .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

    let zip_path = temp_dir.path().join(format!("{}.zip", version));
    fs::write(&zip_path, &zip_bytes)
        .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

    let zip_file = fs::File::open(&zip_path)
        .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

    let module_prefix = format!("modules/{}", module_name);
    let _ = ctx.repository.delete_prefix(&module_prefix);

    let mut functions = HashMap::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

        if file.is_dir() {
            continue;
        }

        let file_name = file.name().to_string();
        let extension = std::path::Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        let mut contents = Vec::new();
        file.read_to_end(&mut contents)
            .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

        if extension == "js" || extension == "lua" {
            let base_name = std::path::Path::new(&file_name)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&file_name);

            let repo_key = format!("modules/{}/{}", module_name, base_name);
            let req = CreateFileRequest {
                content: Some(contents.clone()),
                extension: Some(extension.to_string()),
                file_name: repo_key,
            };
            let mut failed = Vec::new();
            ctx.repository.create([req], &mut failed).await
                .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

            let func_name = std::path::Path::new(base_name).file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            let code = String::from_utf8_lossy(&contents).to_string();
            functions.insert(func_name.to_string(), Function::new(
                func_name.to_string(),
                base_name.to_string(),
                code,
                false,
            ));
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let module = lib_sandbox::RegisteredModule {
        metadata: lib_sandbox::ModuleMetadata {
            name: module_name.clone(),
            version: version.clone(),
            installed_at: now,
            updated_at: now,
        },
        functions,
        state: lib_sandbox::ModuleState::Active,
    };

    ctx.registry.register_module(module_name.clone(), module)
        .map_err(|e| actix_web::error::ErrorInternalServerError(e.to_string()))?;

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "module": module_name,
        "version": version,
        "message": format!("Module rolled back to version {}", version)
    })))
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(upload_handler)
       .service(register_handler)
       .service(delete_handler)
       .service(state_handler)
       .service(reload_handler)
       .service(versions_handler)
       .service(rollback_handler)
       .service(list_handler)
       .service(get_handler);
}
