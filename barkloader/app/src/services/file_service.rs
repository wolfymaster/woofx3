use actix_multipart::{Field, Multipart};
use actix_web::Error;
use anyhow::{Context, Result, bail};
use futures::{StreamExt, TryStreamExt};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tracing::{error, info};
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
            info!(
                "Multipart field: name={:?} filename={:?}",
                field_name, file_name
            );

            match field_name.as_str() {
                "file" => {
                    let name = file_name.ok_or_else(|| {
                        actix_web::error::ErrorBadRequest("File missing file name")
                    })?;
                    metadata = Some(
                        self.handle_file_field(&mut field, name, callback_url.clone())
                            .await?,
                    )
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

        let mut meta =
            metadata.ok_or_else(|| actix_web::error::ErrorBadRequest("No file field found"))?;
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
                Self::extract_zip(
                    &metadata.temp_dir_path.join(&metadata.file_name),
                    &metadata.temp_dir_path,
                )?;
                // DEBUG: walk entire extracted tree
                info!("=== RAW DIRECTORY LISTING after unzip: {} ===", dir_path);
                fn walk_dir(path: &Path, prefix: &str) {
                    if let Ok(entries) = fs::read_dir(path) {
                        for entry in entries.flatten() {
                            let p = entry.path();
                            let name = format!("{}{}", prefix, entry.file_name().to_string_lossy());
                            if p.is_dir() {
                                tracing::info!("  [dir]  {}/", name);
                                walk_dir(&p, &format!("{}/", name));
                            } else {
                                tracing::info!(
                                    "  [file] {} ({} bytes)",
                                    name,
                                    p.metadata().map(|m| m.len()).unwrap_or(0)
                                );
                            }
                        }
                    }
                }
                walk_dir(Path::new(dir_path), "");
                info!("=== END RAW DIRECTORY LISTING ===");
                // Recursively collect every extracted file. `file_name` is the
                // path **relative to the extraction root** (e.g.
                // "functions/sendChatMessage.js"), which is what manifest
                // entries reference via their `path` field.
                fn collect_files(
                    root: &Path,
                    current: &Path,
                    out: &mut Vec<(String, PathBuf, Option<String>)>,
                ) -> std::io::Result<()> {
                    for entry in fs::read_dir(current)? {
                        let entry = entry?;
                        let path = entry.path();
                        if path.is_dir() {
                            collect_files(root, &path, out)?;
                            continue;
                        }
                        let rel = path
                            .strip_prefix(root)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .replace('\\', "/");
                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|s| s.to_string());
                        out.push((rel, path, ext));
                    }
                    Ok(())
                }

                let extract_root = Path::new(dir_path);
                let mut collected: Vec<(String, PathBuf, Option<String>)> = Vec::new();
                collect_files(extract_root, extract_root, &mut collected)?;

                for (rel_name, _abs_path, file_extension) in collected {
                    metadatas.push(FileMetadata {
                        temp_dir_path: metadata.temp_dir_path.clone(),
                        file_extension,
                        file_name: rel_name,
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

    /// Extracts in-process so installs do not depend on an `unzip` binary
    /// being present on the host.
    fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<()> {
        let file = fs::File::open(archive_path)
            .with_context(|| format!("open archive {}", archive_path.display()))?;
        let mut archive = zip::ZipArchive::new(file)
            .with_context(|| format!("read archive {}", archive_path.display()))?;

        // A symlink entry could point outside the extraction root, and the
        // files collected afterwards are read through it.
        for i in 0..archive.len() {
            let entry = archive
                .by_index(i)
                .with_context(|| format!("read archive entry {}", i))?;
            if entry.is_symlink() {
                bail!("archive entry {} is a symlink", entry.name());
            }
        }

        archive
            .extract(dest_dir)
            .with_context(|| format!("extract archive {}", archive_path.display()))?;
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn write_zip(path: &Path, build: impl FnOnce(&mut zip::ZipWriter<fs::File>)) {
        let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
        build(&mut writer);
        writer.finish().unwrap();
    }

    #[test]
    fn extract_zip_writes_nested_entries() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = dir.path().join("module.zip");
        write_zip(&archive_path, |writer| {
            writer
                .start_file("manifest.json", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"{}").unwrap();
            writer
                .start_file("functions/hello.js", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"export default 1;").unwrap();
        });

        FileService::extract_zip(&archive_path, dir.path()).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("manifest.json")).unwrap(),
            "{}"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("functions/hello.js")).unwrap(),
            "export default 1;"
        );
    }

    #[test]
    fn extract_zip_rejects_entry_escaping_destination() {
        let dir = tempfile::tempdir().unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();
        let archive_path = dir.path().join("module.zip");
        write_zip(&archive_path, |writer| {
            writer
                .start_file("../escaped.txt", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"x").unwrap();
        });

        assert!(FileService::extract_zip(&archive_path, &dest_dir).is_err());
        assert!(!dir.path().join("escaped.txt").exists());
    }

    #[test]
    fn extract_zip_rejects_symlink_entry() {
        let dir = tempfile::tempdir().unwrap();
        let dest_dir = dir.path().join("dest");
        fs::create_dir(&dest_dir).unwrap();
        let archive_path = dir.path().join("module.zip");
        write_zip(&archive_path, |writer| {
            writer
                .add_symlink("link", "/etc/passwd", SimpleFileOptions::default())
                .unwrap();
        });

        assert!(FileService::extract_zip(&archive_path, &dest_dir).is_err());
        assert!(!dest_dir.join("link").exists());
    }

    #[test]
    fn extract_zip_rejects_file_that_is_not_an_archive() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = dir.path().join("module.zip");
        fs::write(&archive_path, b"not a zip").unwrap();

        assert!(FileService::extract_zip(&archive_path, dir.path()).is_err());
    }
}
