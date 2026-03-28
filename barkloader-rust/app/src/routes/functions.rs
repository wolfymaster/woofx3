use actix_multipart::Multipart;
use actix_web::web::Data;
use actix_web::{Error, HttpResponse, patch, post, web::ServiceConfig};
use lib_repository::{CreateFileRequest, Repository};
use lib_sandbox::models::function::Function;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read as _;
use std::path::PathBuf;
use tokio::task;

use crate::services::file_service::FileService;
use crate::services::module_service::{ModuleFileKind, ModuleService, ModuleServiceConfig};
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

#[post("/functions")]
async fn upload_handler(
    ctx: Data<AppContext>,
    multipart: Multipart,
) -> Result<HttpResponse, Error> {
    /*
    - file upload
    - extract contents
    - read manifest
    - add file ot module service
    - generate plan for module
    - execute plan pipeline
       - everything should be added
    */
    let file_service = FileService::new("./uploads");

    // upload the file to temporary location for processing
    let metadata: crate::services::file_service::FileMetadata =
        file_service.process_upload(multipart).await?;

    // archive the zip file (in case we need it at some later point)

    let response = UploadResponse {
        success: true,
        original_filename: metadata.file_name.clone(),
        extension: metadata.file_extension.clone(),
        message: "File uploaded successfully".to_string(),
    };

    // spawn thread for background processing task
    task::spawn(async move {
        // SafeTempDir with automatic cleanup on drop
        let _upload_cleanup = SafeTempDir::new(PathBuf::from(&metadata.temp_dir_path), PathBuf::from("./uploads"));

        // save original zip path before processing extracts files
        let original_zip_path = PathBuf::from(&metadata.temp_dir_path).join(&metadata.file_name);

        // process uploaded file into list of file metadata
        let metadatas = file_service.process_uploaded_file(metadata).await;
        if metadatas.is_err() {
            log::error!(
                "Failed to process uploaded file: {}",
                metadatas.err().unwrap()
            );
            return;
        }

        // hand list of metadata to be processed by module service
        let file_metadata = metadatas.ok().unwrap();

        let module_config = ModuleServiceConfig {
            repository: ctx.repository.clone(),
        };
        let mut module = ModuleService::new(module_config);

        // loop the file meta and add files to module
        // skip the original zip folder in the directory
        for data in file_metadata {
            // if there is no extension, skip
            let Some(extension) = &data.file_extension else {
                warn!("missing file extension on file: {}", &data.file_name);
                continue;
            };

            // if we can't handle the extension, skip
            let Ok(kind) = extension.parse::<ModuleFileKind>() else {
                // skip if extension is zip
                if extension.to_lowercase().trim() == "zip" {
                    continue;
                }
                warn!("unknown file extension: {}", &extension);
                continue;
            };

            // get file contents
            let file_path = std::path::PathBuf::from(&data.temp_dir_path).join(&data.file_name);
            let Ok(contents) = fs::read_to_string(file_path) else {
                error!("Failed to read file contents: {}", &data.file_name);
                continue;
            };

            module.add_file(kind, &data.file_name, Vec::from(contents));
        }

        // run workflow to create module and upload files to repository
        let module_plan = match module.create_plan() {
            Ok(v) => v,
            Err(err) => {
                error!("Failed to create module plan: {}", err);
                return;
            }
        };

        // execute plan
        module.execute_plan(&module_plan, ctx.db_proxy_url.as_deref()).await;

        // archive the original zip to archives/{module_name}/{version}.zip
        if let (Some(name), Some(version)) = (module.module_name(), module.module_version()) {
            if let Ok(zip_bytes) = fs::read(&original_zip_path) {
                let archive_key = format!("archives/{}/{}.zip", name, version);
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
) -> Result<HttpResponse, Error> {
    let module_name = path.into_inner();

    ctx.registry.unregister_module(&module_name)
        .map_err(|e| actix_web::error::ErrorNotFound(e.to_string()))?;

    let prefix = format!("modules/{}", module_name);
    let _ = ctx.repository.delete_prefix(&prefix);

    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "module": module_name,
        "message": "Module deleted successfully"
    })))
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
async fn reload_handler(ctx: Data<AppContext>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "message": "Modules reloaded"
    })))
}

#[actix_web::get("/functions")]
async fn list_handler(ctx: Data<AppContext>) -> Result<HttpResponse, Error> {
    let modules = ctx.registry.list_modules();
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "modules": modules.iter().map(|m| serde_json::json!({
            "name": m.name,
            "version": m.version,
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
