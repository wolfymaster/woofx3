use actix_multipart::Multipart;
use actix_web::{
    Error, HttpResponse, Responder,
    web::{Data, ServiceConfig, patch, post, scope},
};

use crate::services::file_service::FileService;

async fn upload_handler(multipart: Multipart) -> Result<HttpResponse, Error> {
    // idk if i need to do this, should be a tmp dir and then removed when done
    let file_service = FileService::new("./uploads");

    // this should handle the multipart upload of a file or compressed archive
    let metadata = file_service.process_upload(multipart).await?;


    
    // Determine final filename (preference: form field, then content-disposition, then default)
    let original_filename = metadata
        .original_filename
        .or(metadata.override_filename)
        .unwrap_or_else(|| "unnamed_file.bin".to_string());

    // Create response
    let response = UploadResponse {
        success: true,
        file_id: metadata.file_id,
        original_filename,
        stored_filename: format!("./uploads/{}", metadata.file_id),
        size_bytes: metadata.size_bytes,
        message: "File uploaded successfully".to_string(),
    };

    Ok(HttpResponse::Ok().json(response))
}

async fn reload_handler() -> impl Responder {
    "Reloaded modules"
}

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(
        scope("/functions")
            .route("/", post().to(upload_handler))
            .route("/", patch().to(reload_handler)),
    );
}
