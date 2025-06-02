use actix_multipart::Multipart;
use actix_web::web::Data;
use actix_web::{Error, HttpResponse, Responder, patch, post, web::ServiceConfig};
use log::{error, info, warn};
use serde::Serialize;
use std::fs;
use tokio::task;

use crate::services::file_service::FileService;
use crate::services::module_service::{ModuleFileKind, ModuleService, ModuleValidProgramKind};
use crate::types::AppContext;

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
    let file_service = FileService::new("./uploads");

    // upload the file to temporary location for processing
    let metadata = file_service.process_upload(multipart).await?;

    let response = UploadResponse {
        success: true,
        original_filename: metadata.file_name.clone(),
        extension: metadata.file_extension.clone(),
        message: "File uploaded successfully".to_string(),
    };

    // spawn thread for background processing task
    task::spawn(async move {
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
        
        let mut module = ModuleService::new();

        // loop the file meta and add files to module
        for data in file_metadata {
            // if there is no extension, skip
            let Some(extension) = &data.file_extension else {
                warn!("missing file extension on file: {}", &data.file_name);
                continue;
            };

            // if we can't handle the extension, skip
            let Ok(kind) = extension.parse::<ModuleFileKind>() else {
                warn!("unknown file extension: {}", &extension);
                continue;
            };

            // get file contents
            let Ok(contents) = fs::read_to_string(&data.file_name) else {
                error!("Failed to read file contents: {}", &data.file_name);
                continue;
            };

            module.add_file(
                kind,
                &data.file_name,
                Vec::from(contents),
            );
        }

        // run workflow to create module and upload files to repository
        module.create_plan();

        // archive the original files

        // clean up files
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
