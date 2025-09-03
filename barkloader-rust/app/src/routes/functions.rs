use actix_multipart::Multipart;
use actix_web::web::Data;
use actix_web::{Error, HttpResponse, Responder, patch, post, web::ServiceConfig};
use log::{error, info, warn};
use serde::Serialize;
use std::fs;
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
        module.execute_plan(&module_plan).await;
    });

    Ok(HttpResponse::Ok().json(response))
}

#[patch("/functions")]
async fn reload_handler() -> impl Responder {
    HttpResponse::Ok().json("Reloaded modules")
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(upload_handler).service(reload_handler);
}
