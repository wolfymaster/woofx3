use actix_multipart::{Field, Multipart};
use actix_web::Error;
use anyhow::Result;
use futures::{StreamExt, TryStreamExt};
use lib_repository::{CreateFileRequest, Repository, RepositoryImpl};
use log::{error, info};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug)]
pub struct FileMetadata {
    pub file_extension: Option<String>,
    pub file_name: String,
    pub temp_dir_path: PathBuf,
    pub upload_dir_path: PathBuf,
}

pub struct FileService {
    upload_dir: String,
}

impl FileService {
    pub fn new(upload_dir: &str) -> Self {
        // Create directory if it doesn't exist
        fs::create_dir_all(upload_dir).expect("Failed to create upload directory");

        Self {
            upload_dir: upload_dir.to_string(),
        }
    }

    pub async fn process_upload(&self, mut payload: Multipart) -> Result<FileMetadata, Error> {
        // Todo: Move this into some setup so it's only invoked once
        fs::create_dir_all(&self.upload_dir).map_err(|e| {
            eprintln!("Failed to create uploads directory: {}", e);
            actix_web::error::ErrorInternalServerError("Storage error")
        })?;

        let mut metadata: Option<FileMetadata> = None;
        while let Ok(Some(mut field)) = payload.try_next().await {
            let Some(content_disposition) = field.content_disposition() else {
                return Err(actix_web::error::ErrorBadRequest(
                    "Missing content disposition",
                ));
            };

            let field_name = content_disposition.get_name().unwrap_or("");
            match field_name {
                "file" => {
                    let file_name = content_disposition
                        .get_filename()
                        .map(|s| s.to_string())
                        .ok_or_else(|| actix_web::error::ErrorBadRequest("File missing file name"))?;
                    metadata = Some(self.handle_file_field(&mut field, file_name).await?)
                }
                _ => {
                    // Consume the field data but don't use it
                    while let Some(chunk) = field.next().await {
                        let _ = chunk?;
                    }
                }
            }
        }

        metadata.ok_or_else(|| actix_web::error::ErrorBadRequest("No file field found"))
    }

    pub async fn process_uploaded_file(&self, metadata: FileMetadata) -> Result<Vec<FileMetadata>> {
        let mut metadatas = Vec::<FileMetadata>::new();

        match metadata.file_extension.as_deref() {
            Some("zip") => {
                // extract zip to folder
                let dir_path = metadata
                    .temp_dir_path
                    .to_str()
                    .expect("Temporary file path should always be set");
                let archive_file = format!("{}/{}", &dir_path, &metadata.file_name);
                Self::decompress_file(&archive_file, "zip")?;
                // create metadata for every extracted file
                let entries = fs::read_dir(dir_path)?;
                for entry in entries {
                    let entry = entry?;
                    let original_file_name = entry.file_name().to_string_lossy().to_string();
                    let temp_file_path = entry.path();
                    let file_extension = temp_file_path
                        .extension()
                        .and_then(|ext| Some(String::from(ext.to_str().unwrap())));
                    metadatas.push(FileMetadata {
                        temp_dir_path: metadata.temp_dir_path.clone(),
                        file_extension,
                        file_name:original_file_name.clone(),
                        upload_dir_path: metadata.upload_dir_path.clone(),
                    });
                }
            }
            _ => {
                metadatas.push(metadata);
            }
        };

        Ok(metadatas)
    }

    fn decompress_file(file_path: &str, compression_type: &str) -> Result<String, std::io::Error> {
        use std::process::Command;

        let output_path =
            file_path.trim_end_matches(&['.', 'g', 'z', 'i', 'p', 't', 'a', 'r', 'b', '2']);

        match compression_type {
            "gzip" => {
                Command::new("gunzip").args(["-k", file_path]).output()?;
            }
            "zip" => {
                let output_dir = Path::new(file_path).parent().unwrap_or(Path::new("./"));
                Command::new("unzip")
                    .args(["-o", file_path, "-d", output_dir.to_str().unwrap()])
                    .output()?;
            }
            _ => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("Unsupported compression type: {}", compression_type),
                ));
            }
        }

        Ok(output_path.to_string())
    }

    async fn handle_file_field(
        &self,
        field: &mut Field,
        file_name: String,
    ) -> Result<FileMetadata, Error> {
        let temp_dir_name = Uuid::new_v4().to_string();
                
        // Get filename
        let mut file_extension = None;
        let sanitized = sanitize_filename::sanitize(file_name);        
        let upload_dir_path = PathBuf::from(&self.upload_dir);
        let temp_dir_path = upload_dir_path.join(&temp_dir_name);
        
        if let Some(ext) = Path::new(&sanitized).extension() {
            file_extension = Some(ext.to_str().unwrap_or("").to_string());
        }

        // ensure temp directory exists
        fs::create_dir_all(&temp_dir_path).map_err(|e| {
            eprintln!("Failed to create uploads directory: {}", e);
            actix_web::error::ErrorInternalServerError("Storage error")
        })?;
        
        // Create file
        let mut file = fs::File::create(temp_dir_path.join(&sanitized)).map_err(|e| {
            error!("Failed to create file: {}", e);
            actix_web::error::ErrorInternalServerError("Failed to store file")
        })?;

        // Stream data to file
        while let Some(chunk) = field.next().await {
            let data = chunk.map_err(|e| {
                error!("Error reading chunk: {}", e);
                actix_web::error::ErrorInternalServerError("Upload error")
            })?;
            file.write_all(&data).map_err(|e| {
                error!("Error writing to file: {}", e);
                actix_web::error::ErrorInternalServerError("Failed to store file")
            })?;
        }

        Ok(FileMetadata {
            file_name: sanitized,
            file_extension,
            upload_dir_path,
            temp_dir_path,
        })
    }
}
