use actix_multipart::{Field, Multipart};
use actix_web::Error;
use anyhow::Result;
use futures::{StreamExt, TryStreamExt};
use log::{error, info};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct FileMetadata {
    pub file_extension: Option<String>,
    pub file_name: String,
    pub temp_dir_path: PathBuf,
    pub upload_dir_path: PathBuf,
    pub callback_url: Option<String>,
    pub client_id: Option<String>,
    pub module_key: Option<String>,
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
        let mut callback_url: Option<String> = None;
        let mut client_id: Option<String> = None;
        let mut module_key: Option<String> = None;

        while let Ok(Some(mut field)) = payload.try_next().await {
            let Some(content_disposition) = field.content_disposition() else {
                return Err(actix_web::error::ErrorBadRequest(
                    "Missing content disposition",
                ));
            };

            let field_name = content_disposition.get_name().unwrap_or("").to_string();
            let file_name = content_disposition.get_filename().map(|s| s.to_string());
            info!("Multipart field: name={:?} filename={:?}", field_name, file_name);

            match field_name.as_str() {
                "file" => {
                    let name = file_name
                        .ok_or_else(|| actix_web::error::ErrorBadRequest("File missing file name"))?;
                    metadata = Some(self.handle_file_field(&mut field, name, callback_url.clone()).await?)
                }
                "callback_url" | "client_id" | "module_key" => {
                    let mut value = String::new();
                    while let Some(chunk) = field.next().await {
                        let data = chunk.map_err(|e| {
                            error!("Error reading {} chunk: {}", field_name, e);
                            actix_web::error::ErrorInternalServerError("Upload error")
                        })?;
                        value.push_str(&String::from_utf8_lossy(&data));
                    }
                    match field_name.as_str() {
                        "callback_url" => callback_url = Some(value),
                        "client_id" => client_id = Some(value),
                        "module_key" => module_key = Some(value),
                        _ => {}
                    }
                }
                _ => {
                    while let Some(chunk) = field.next().await {
                        let _ = chunk?;
                    }
                }
            }
        }

        let mut meta = metadata
            .ok_or_else(|| actix_web::error::ErrorBadRequest("No file field found"))?;
        meta.client_id = client_id;
        meta.module_key = module_key;
        Ok(meta)
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
                // DEBUG: walk entire extracted tree
                info!("=== RAW DIRECTORY LISTING after unzip: {} ===", dir_path);
                fn walk_dir(path: &Path, prefix: &str) {
                    if let Ok(entries) = fs::read_dir(path) {
                        for entry in entries.flatten() {
                            let p = entry.path();
                            let name = format!("{}{}", prefix, entry.file_name().to_string_lossy());
                            if p.is_dir() {
                                log::info!("  [dir]  {}/", name);
                                walk_dir(&p, &format!("{}/", name));
                            } else {
                                log::info!("  [file] {} ({} bytes)", name, p.metadata().map(|m| m.len()).unwrap_or(0));
                            }
                        }
                    }
                }
                walk_dir(Path::new(dir_path), "");
                info!("=== END RAW DIRECTORY LISTING ===");
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
                        callback_url: metadata.callback_url.clone(),
                        client_id: metadata.client_id.clone(),
                        module_key: metadata.module_key.clone(),
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
        callback_url: Option<String>,
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
            callback_url,
            client_id: None,
            module_key: None,
        })
    }
}
