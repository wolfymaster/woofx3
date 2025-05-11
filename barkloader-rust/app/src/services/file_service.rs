use actix_multipart::Multipart;
use actix_web::Error;
use futures::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadResult {
    file_id: String,
    filename: String,
    size: usize,
}

pub struct FileService {
    upload_dir: String,
}

impl FileService {
    pub fn new(upload_dir: &str) -> Self {
        // Create directory if it doesn't exist
        std::fs::create_dir_all(upload_dir).expect("Failed to create upload directory");

        Self {
            upload_dir: upload_dir.to_string(),
        }
    }

    pub async fn process_upload(&self, mut payload: Multipart) -> Result<UploadResult, Error> {
        // Create uploads directory if it doesn't exist
        fs::create_dir_all("./uploads").map_err(|e| {
            eprintln!("Failed to create uploads directory: {}", e);
            actix_web::error::ErrorInternalServerError("Storage error")
        })?;

        let mut metadata = FileMetadata {
            original_filename: None,
            override_filename: None,
            file_id: Uuid::new_v4().to_string(),
            size_bytes: 0,
        };

        // Process multipart fields
        while let Ok(Some(mut field)) = payload.try_next().await {
            let content_disposition = field.content_disposition();
            let field_name = content_disposition.get_name().unwrap_or("");

            match field_name {
                // File field
                "file" => {
                    // Get filename from content-disposition if available
                    if let Some(filename) = content_disposition.get_filename() {
                        metadata.override_filename = Some(sanitize_filename::sanitize(filename));
                    }

                    // Generate a unique filename for storage
                    let storage_filename = format!(
                        "{}{}",
                        metadata.file_id,
                        if let Some(ref fname) = metadata.override_filename {
                            if let Some(ext) = Path::new(fname).extension() {
                                format!(".{}", ext.to_string_lossy())
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        }
                    );

                    let filepath = format!("./uploads/{}", storage_filename);

                    // Create file
                    let mut file = fs::File::create(filepath).map_err(|e| {
                        eprintln!("Failed to create file: {}", e);
                        actix_web::error::ErrorInternalServerError("Failed to store file")
                    })?;

                    // Stream data to file
                    let mut total_bytes = 0;
                    while let Some(chunk) = field.next().await {
                        let data = chunk.map_err(|e| {
                            eprintln!("Error reading chunk: {}", e);
                            actix_web::error::ErrorInternalServerError("Upload error")
                        })?;
                        total_bytes += data.len();
                        file.write_all(&data).map_err(|e| {
                            eprintln!("Error writing to file: {}", e);
                            actix_web::error::ErrorInternalServerError("Failed to store file")
                        })?;
                    }

                    metadata.size_bytes = total_bytes;
                }

                // Custom filename field
                "filename" => {
                    // Read the field data
                    let mut filename_data = Vec::new();
                    while let Some(chunk) = field.next().await {
                        let data = chunk.map_err(|e| {
                            eprintln!("Error reading filename field: {}", e);
                            actix_web::error::ErrorInternalServerError("Upload error")
                        })?;
                        filename_data.extend_from_slice(&data);
                    }

                    // Convert to string
                    let filename = String::from_utf8(filename_data).map_err(|e| {
                        eprintln!("Invalid filename encoding: {}", e);
                        actix_web::error::ErrorBadRequest("Invalid filename encoding")
                    })?;

                    metadata.original_filename = Some(sanitize_filename::sanitize(&filename));
                }

                // Other fields (can be expanded for additional metadata)
                _ => {
                    // Consume the field data but don't use it
                    while let Some(chunk) = field.next().await {
                        let _ = chunk?;
                    }
                }
            }
        }

        Ok(UploadResult {
            file_id: "example-id".to_string(),
            filename: "example.txt".to_string(),
            size: 1024,
        })
    }

    pub async fn get_file(&self, file_id: &str) -> Result<UploadResult, Error> {
        // Get file metadata
        // ...

        Ok(UploadResult {
            file_id: file_id.to_string(),
            filename: "example.txt".to_string(),
            size: 1024,
        })
    }

    pub async fn delete_file(&self, file_id: &str) -> Result<(), Error> {
        // Delete file
        // ...

        Ok(())
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
}
