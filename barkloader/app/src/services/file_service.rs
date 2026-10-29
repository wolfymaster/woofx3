use crate::services::upload_limits::{RATIO_FLOOR_BYTES, UploadLimits};
use actix_multipart::{Field, Multipart};
use actix_web::Error;
use anyhow::{Context, Result};
use futures::{StreamExt, TryStreamExt};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Longest value accepted for a plain form field (`callback_url`,
/// `module_key`, ...). They carry URLs and short keys, never content.
const MAX_TEXT_FIELD_BYTES: usize = 8 * 1024;
/// Everything in a request that is not the archive (text fields and
/// unrecognised fields) shares this budget, so the number of such fields
/// cannot be used to stream unbounded data.
const MAX_FORM_EXTRAS_BYTES: u64 = 64 * 1024;
/// Subdirectory of the upload's temp dir that the archive is unpacked into,
/// so an entry can never overwrite the archive while it is being read.
const EXTRACT_DIR: &str = "extracted";

#[derive(Debug, Clone)]
pub struct FileMetadata {
    pub file_extension: Option<String>,
    pub file_name: String,
    pub temp_dir_path: PathBuf,
    pub upload_dir_path: PathBuf,
    /// Lowercase hex SHA-256 of the uploaded archive, computed while it was
    /// streamed to disk. Entries extracted from the archive carry its hash.
    pub sha256: String,
    pub callback_url: Option<String>,
    pub client_id: Option<String>,
    pub module_key: Option<String>,
    /// The marketplace listing and edition the archive came from, as the
    /// uploader sent them. Read, not validated: see `marketplace_origin`.
    pub marketplace_listing_id: Option<String>,
    pub marketplace_edition: Option<String>,
    /// The stored resource the archive was read from, as the uploader sent
    /// it. Read, not validated: see `install_origin`.
    pub upload_resource_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum UnpackError {
    #[error("read archive: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("archive has {count} entries, more than the {max} allowed")]
    TooManyEntries { count: u64, max: u64 },
    #[error("archive entry {0} is a symlink")]
    Symlink(String),
    #[error("archive entry {0} has an unsafe path")]
    UnsafePath(String),
    #[error("archive entry {name} is larger than the {max} bytes allowed per entry")]
    EntryTooLarge { name: String, max: u64 },
    #[error("archive inflates to more than the {max} bytes allowed")]
    TooLarge { max: u64 },
    #[error("archive inflates to more than {max_ratio} times its size")]
    RatioExceeded { max_ratio: u64 },
    #[error("unpack archive entry: {0}")]
    Sink(#[from] anyhow::Error),
}

/// Counts what the sink actually reads, whatever the archive claims.
struct Counted<R> {
    inner: R,
    count: u64,
}

impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count += n as u64;
        Ok(n)
    }
}

/// Walks a zip, handing each file entry's relative path and a reader to
/// `sink`. Shared by disk extraction at install and the in-memory read at
/// rollback so both enforce the same limits.
///
/// Symlinks, unsafe paths, the entry count and declared sizes are refused
/// before anything is inflated. Declared sizes are only a header, so each
/// entry is then read through a bound and the bytes it really yields are
/// counted against the per-entry, total and compression-ratio limits.
pub fn unpack_zip<R: Read + Seek>(
    reader: R,
    archive_len: u64,
    limits: &UploadLimits,
    mut sink: impl FnMut(&Path, &mut dyn Read) -> Result<()>,
) -> Result<(), UnpackError> {
    let mut archive = zip::ZipArchive::new(reader)?;

    let count = archive.len() as u64;
    if count > limits.max_entries {
        return Err(UnpackError::TooManyEntries {
            count,
            max: limits.max_entries,
        });
    }

    // Past the floor, an archive may inflate to at most `max_ratio` times its size.
    let ratio_limit = archive_len
        .saturating_mul(limits.max_ratio)
        .max(RATIO_FLOOR_BYTES);
    let total_limit = limits.max_uncompressed_bytes.min(ratio_limit);
    let over_total = || {
        if ratio_limit < limits.max_uncompressed_bytes {
            UnpackError::RatioExceeded {
                max_ratio: limits.max_ratio,
            }
        } else {
            UnpackError::TooLarge {
                max: limits.max_uncompressed_bytes,
            }
        }
    };

    let mut declared_total = 0u64;
    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i)?;
        // A symlink entry could point outside the extraction root, and the
        // files collected afterwards are read through it.
        if entry.is_symlink() {
            return Err(UnpackError::Symlink(entry.name().to_string()));
        }
        if entry.enclosed_name().is_none() {
            return Err(UnpackError::UnsafePath(entry.name().to_string()));
        }
        if entry.size() > limits.max_entry_bytes {
            return Err(UnpackError::EntryTooLarge {
                name: entry.name().to_string(),
                max: limits.max_entry_bytes,
            });
        }
        declared_total = declared_total.saturating_add(entry.size());
        if declared_total > total_limit {
            return Err(over_total());
        }
    }

    let mut actual_total = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let Some(relative) = entry.enclosed_name() else {
            return Err(UnpackError::UnsafePath(name));
        };

        let allowance = limits.max_entry_bytes.min(total_limit - actual_total);
        // One byte past the allowance, so overrunning it is observable.
        let mut bounded = Counted {
            inner: (&mut entry).take(allowance.saturating_add(1)),
            count: 0,
        };
        sink(&relative, &mut bounded)?;
        let read = bounded.count;

        if read > limits.max_entry_bytes {
            return Err(UnpackError::EntryTooLarge {
                name,
                max: limits.max_entry_bytes,
            });
        }
        if read > allowance {
            return Err(over_total());
        }
        actual_total += read;
    }
    Ok(())
}

pub struct FileService {
    upload_dir: PathBuf,
    limits: UploadLimits,
}

impl FileService {
    pub fn new(upload_dir: &Path, limits: UploadLimits) -> Result<Self> {
        fs::create_dir_all(upload_dir)
            .with_context(|| format!("create upload directory {}", upload_dir.display()))?;

        Ok(Self {
            upload_dir: upload_dir.to_path_buf(),
            limits,
        })
    }

    pub fn limits(&self) -> UploadLimits {
        self.limits
    }

    pub async fn process_upload(&self, mut payload: Multipart) -> Result<FileMetadata, Error> {
        let mut metadata: Option<FileMetadata> = None;
        let result = self.read_fields(&mut payload, &mut metadata).await;
        match result {
            Ok(fields) => {
                let mut meta = metadata
                    .ok_or_else(|| actix_web::error::ErrorBadRequest("No file field found"))?;
                meta.client_id = fields.client_id;
                meta.module_key = fields.module_key;
                meta.marketplace_listing_id = fields.marketplace_listing_id;
                meta.marketplace_edition = fields.marketplace_edition;
                meta.upload_resource_id = fields.upload_resource_id;
                Ok(meta)
            }
            Err(err) => {
                // The install task that would clean the temp dir never starts.
                if let Some(stored) = metadata {
                    remove_temp_dir(&stored.temp_dir_path);
                }
                Err(err)
            }
        }
    }

    async fn read_fields(
        &self,
        payload: &mut Multipart,
        metadata: &mut Option<FileMetadata>,
    ) -> Result<TextFields, Error> {
        let mut fields = TextFields::default();
        let mut callback_url: Option<String> = None;
        let mut extras_left = MAX_FORM_EXTRAS_BYTES;

        while let Some(mut field) = payload
            .try_next()
            .await
            .map_err(actix_web::error::ErrorBadRequest)?
        {
            let Some(content_disposition) = field.content_disposition() else {
                return Err(actix_web::error::ErrorBadRequest(
                    "Missing content disposition",
                ));
            };

            let field_name = content_disposition.get_name().unwrap_or("").to_string();
            let file_name = content_disposition.get_filename().map(|s| s.to_string());
            debug!(
                "Multipart field: name={:?} filename={:?}",
                field_name, file_name
            );

            match field_name.as_str() {
                "file" => {
                    if metadata.is_some() {
                        return Err(actix_web::error::ErrorBadRequest(
                            "Only one file field is allowed",
                        ));
                    }
                    let name = file_name.ok_or_else(|| {
                        actix_web::error::ErrorBadRequest("File missing file name")
                    })?;
                    *metadata = Some(
                        self.handle_file_field(&mut field, name, callback_url.clone())
                            .await?,
                    );
                }
                "callback_url"
                | "client_id"
                | "module_key"
                | "marketplace_listing_id"
                | "marketplace_edition"
                | "upload_resource_id" => {
                    let value = read_text_field(&mut field, &field_name, &mut extras_left).await?;
                    match field_name.as_str() {
                        "callback_url" => callback_url = Some(value),
                        "client_id" => fields.client_id = Some(value),
                        "module_key" => fields.module_key = Some(value),
                        "marketplace_listing_id" => fields.marketplace_listing_id = Some(value),
                        "marketplace_edition" => fields.marketplace_edition = Some(value),
                        "upload_resource_id" => fields.upload_resource_id = Some(value),
                        _ => {}
                    }
                }
                _ => {
                    while let Some(chunk) = field.next().await {
                        let data = chunk.map_err(actix_web::error::ErrorBadRequest)?;
                        spend_extras(&mut extras_left, data.len())?;
                    }
                }
            }
        }

        Ok(fields)
    }

    pub async fn process_uploaded_file(&self, metadata: FileMetadata) -> Result<Vec<FileMetadata>> {
        let mut metadatas = Vec::<FileMetadata>::new();

        match metadata.file_extension.as_deref() {
            Some("zip") => {
                let archive_path = metadata.temp_dir_path.join(&metadata.file_name);
                let extract_root = metadata.temp_dir_path.join(EXTRACT_DIR);
                self.extract_zip(&archive_path, &extract_root)?;

                // Recursively collect every extracted file. `file_name` is the
                // path **relative to the extraction root** (e.g.
                // "functions/sendChatMessage.js"), which is what manifest
                // entries reference via their `path` field.
                fn collect_files(
                    root: &Path,
                    current: &Path,
                    out: &mut Vec<(String, Option<String>)>,
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
                        out.push((rel, ext));
                    }
                    Ok(())
                }

                let mut collected: Vec<(String, Option<String>)> = Vec::new();
                collect_files(&extract_root, &extract_root, &mut collected)?;
                debug!(
                    "Extracted {} files into {}",
                    collected.len(),
                    extract_root.display()
                );

                for (rel_name, file_extension) in collected {
                    metadatas.push(FileMetadata {
                        temp_dir_path: extract_root.clone(),
                        file_extension,
                        file_name: rel_name,
                        upload_dir_path: metadata.upload_dir_path.clone(),
                        sha256: metadata.sha256.clone(),
                        callback_url: metadata.callback_url.clone(),
                        client_id: metadata.client_id.clone(),
                        module_key: metadata.module_key.clone(),
                        marketplace_listing_id: metadata.marketplace_listing_id.clone(),
                        marketplace_edition: metadata.marketplace_edition.clone(),
                        upload_resource_id: metadata.upload_resource_id.clone(),
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
    fn extract_zip(&self, archive_path: &Path, dest_dir: &Path) -> Result<()> {
        let file = fs::File::open(archive_path)
            .with_context(|| format!("open archive {}", archive_path.display()))?;
        let archive_len = file
            .metadata()
            .with_context(|| format!("stat archive {}", archive_path.display()))?
            .len();

        fs::create_dir_all(dest_dir).with_context(|| format!("create {}", dest_dir.display()))?;

        unpack_zip(file, archive_len, &self.limits, |relative, reader| {
            let destination = dest_dir.join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("create {}", parent.display()))?;
            }
            let mut out = fs::File::create(&destination)
                .with_context(|| format!("create {}", destination.display()))?;
            std::io::copy(reader, &mut out)
                .with_context(|| format!("write {}", destination.display()))?;
            Ok(())
        })
        .with_context(|| format!("extract archive {}", archive_path.display()))
    }

    async fn handle_file_field(
        &self,
        field: &mut Field,
        file_name: String,
        callback_url: Option<String>,
    ) -> Result<FileMetadata, Error> {
        let temp_dir_name = Uuid::new_v4().to_string();

        let mut file_extension = None;
        let sanitized = sanitize_filename::sanitize(file_name);
        let upload_dir_path = self.upload_dir.clone();
        let temp_dir_path = upload_dir_path.join(&temp_dir_name);

        if let Some(ext) = Path::new(&sanitized).extension() {
            file_extension = Some(ext.to_str().unwrap_or("").to_string());
        }

        fs::create_dir_all(&temp_dir_path).map_err(|e| {
            error!("Failed to create temp directory: {}", e);
            actix_web::error::ErrorInternalServerError("Storage error")
        })?;

        let sha256 = match self
            .stream_to_file(field, &temp_dir_path.join(&sanitized))
            .await
        {
            Ok(sha256) => sha256,
            Err(err) => {
                remove_temp_dir(&temp_dir_path);
                return Err(err);
            }
        };

        Ok(FileMetadata {
            file_name: sanitized,
            file_extension,
            upload_dir_path,
            temp_dir_path,
            sha256,
            callback_url,
            client_id: None,
            module_key: None,
            marketplace_listing_id: None,
            marketplace_edition: None,
            upload_resource_id: None,
        })
    }

    /// Streams the field to `path`, refusing past `max_archive_bytes`, and
    /// returns the hex SHA-256 of what was written.
    async fn stream_to_file(&self, field: &mut Field, path: &Path) -> Result<String, Error> {
        let mut file = fs::File::create(path).map_err(|e| {
            error!("Failed to create file: {}", e);
            actix_web::error::ErrorInternalServerError("Failed to store file")
        })?;

        let mut hasher = Sha256::new();
        let mut received = 0u64;
        while let Some(chunk) = field.next().await {
            let data = chunk.map_err(|e| {
                warn!("Error reading upload chunk: {}", e);
                actix_web::error::ErrorBadRequest("Upload interrupted")
            })?;
            received += data.len() as u64;
            if received > self.limits.max_archive_bytes {
                info!(
                    "Refusing upload past {} bytes",
                    self.limits.max_archive_bytes
                );
                return Err(actix_web::error::ErrorPayloadTooLarge("Upload too large"));
            }
            hasher.update(&data);
            file.write_all(&data).map_err(|e| {
                error!("Error writing to file: {}", e);
                actix_web::error::ErrorInternalServerError("Failed to store file")
            })?;
        }
        file.flush().map_err(|e| {
            error!("Error flushing file: {}", e);
            actix_web::error::ErrorInternalServerError("Failed to store file")
        })?;

        Ok(format!("{:x}", hasher.finalize()))
    }
}

#[derive(Default)]
struct TextFields {
    client_id: Option<String>,
    module_key: Option<String>,
    marketplace_listing_id: Option<String>,
    marketplace_edition: Option<String>,
    upload_resource_id: Option<String>,
}

fn spend_extras(left: &mut u64, bytes: usize) -> Result<(), Error> {
    *left = left
        .checked_sub(bytes as u64)
        .ok_or_else(|| actix_web::error::ErrorPayloadTooLarge("Form fields too large"))?;
    Ok(())
}

async fn read_text_field(
    field: &mut Field,
    field_name: &str,
    extras_left: &mut u64,
) -> Result<String, Error> {
    let mut value = Vec::new();
    while let Some(chunk) = field.next().await {
        let data = chunk.map_err(|e| {
            warn!("Error reading {} chunk: {}", field_name, e);
            actix_web::error::ErrorBadRequest("Upload interrupted")
        })?;
        spend_extras(extras_left, data.len())?;
        if value.len() + data.len() > MAX_TEXT_FIELD_BYTES {
            return Err(actix_web::error::ErrorPayloadTooLarge(format!(
                "Field {} is too long",
                field_name
            )));
        }
        value.extend_from_slice(&data);
    }
    Ok(String::from_utf8_lossy(&value).into_owned())
}

fn remove_temp_dir(path: &Path) {
    if let Err(e) = fs::remove_dir_all(path) {
        warn!("Failed to remove temp upload {}: {}", path.display(), e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::header::{CONTENT_TYPE, HeaderMap, HeaderValue};
    use actix_web::web::Bytes;
    use zip::write::SimpleFileOptions;

    const BOUNDARY: &str = "testboundary";

    fn service(dir: &Path, limits: UploadLimits) -> FileService {
        FileService::new(&dir.join("uploads"), limits).unwrap()
    }

    fn write_zip(path: &Path, build: impl FnOnce(&mut zip::ZipWriter<fs::File>)) {
        let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
        build(&mut writer);
        writer.finish().unwrap();
    }

    fn deflated() -> SimpleFileOptions {
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
    }

    fn extract(
        limits: UploadLimits,
        dir: &Path,
        build: impl FnOnce(&mut zip::ZipWriter<fs::File>),
    ) -> Result<()> {
        let archive_path = dir.join("module.zip");
        write_zip(&archive_path, build);
        let dest = dir.join("dest");
        fs::create_dir_all(&dest).unwrap();
        service(dir, limits).extract_zip(&archive_path, &dest)
    }

    fn unpack_error(result: Result<()>) -> UnpackError {
        result
            .unwrap_err()
            .downcast::<UnpackError>()
            .expect("an UnpackError")
    }

    fn multipart(body: Vec<u8>, split_at: Option<usize>) -> Multipart {
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_str(&format!("multipart/form-data; boundary={BOUNDARY}")).unwrap(),
        );
        let chunks: Vec<Result<Bytes, actix_web::error::PayloadError>> = match split_at {
            Some(at) => vec![
                Ok(Bytes::copy_from_slice(&body[..at])),
                Ok(Bytes::copy_from_slice(&body[at..])),
            ],
            None => vec![Ok(Bytes::from(body))],
        };
        Multipart::new(&headers, futures::stream::iter(chunks))
    }

    fn form_body(file: &[u8], terminate: bool) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"client_id\"\r\n\r\nabc\r\n\
                 --{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"m.zip\"\r\n\
                 Content-Type: application/zip\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(file);
        if terminate {
            body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
        }
        body
    }

    fn status(err: &Error) -> u16 {
        err.as_response_error().status_code().as_u16()
    }

    #[test]
    fn extract_zip_writes_nested_entries() {
        let dir = tempfile::tempdir().unwrap();
        extract(UploadLimits::default(), dir.path(), |writer| {
            writer
                .start_file("manifest.json", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"{}").unwrap();
            writer
                .start_file("functions/hello.js", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"export default 1;").unwrap();
        })
        .unwrap();

        let dest = dir.path().join("dest");
        assert_eq!(
            fs::read_to_string(dest.join("manifest.json")).unwrap(),
            "{}"
        );
        assert_eq!(
            fs::read_to_string(dest.join("functions/hello.js")).unwrap(),
            "export default 1;"
        );
    }

    #[test]
    fn extract_zip_rejects_entry_escaping_destination() {
        let dir = tempfile::tempdir().unwrap();
        let result = extract(UploadLimits::default(), dir.path(), |writer| {
            writer
                .start_file("../escaped.txt", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"x").unwrap();
        });

        assert!(matches!(unpack_error(result), UnpackError::UnsafePath(_)));
        assert!(!dir.path().join("escaped.txt").exists());
    }

    #[test]
    fn extract_zip_rejects_symlink_entry() {
        let dir = tempfile::tempdir().unwrap();
        let result = extract(UploadLimits::default(), dir.path(), |writer| {
            writer
                .add_symlink("link", "/etc/passwd", SimpleFileOptions::default())
                .unwrap();
        });

        assert!(matches!(unpack_error(result), UnpackError::Symlink(_)));
        assert!(!dir.path().join("dest/link").exists());
    }

    #[test]
    fn extract_zip_rejects_file_that_is_not_an_archive() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = dir.path().join("module.zip");
        fs::write(&archive_path, b"not a zip").unwrap();

        assert!(
            service(dir.path(), UploadLimits::default())
                .extract_zip(&archive_path, dir.path())
                .is_err()
        );
    }

    #[test]
    fn extract_zip_refuses_too_many_entries() {
        let dir = tempfile::tempdir().unwrap();
        let limits = UploadLimits {
            max_entries: 3,
            ..UploadLimits::default()
        };
        let result = extract(limits, dir.path(), |writer| {
            for i in 0..4 {
                writer
                    .start_file(format!("f{i}.txt"), SimpleFileOptions::default())
                    .unwrap();
            }
        });

        assert!(matches!(
            unpack_error(result),
            UnpackError::TooManyEntries { count: 4, max: 3 }
        ));
        assert!(!dir.path().join("dest/f0.txt").exists());
    }

    #[test]
    fn extract_zip_refuses_a_zip_bomb_by_ratio() {
        let dir = tempfile::tempdir().unwrap();
        let limits = UploadLimits::default();
        let result = extract(limits, dir.path(), |writer| {
            writer.start_file("zeros.bin", deflated()).unwrap();
            let zeros = vec![0u8; 1024 * 1024];
            for _ in 0..8 {
                writer.write_all(&zeros).unwrap();
            }
        });

        assert!(matches!(
            unpack_error(result),
            UnpackError::RatioExceeded { .. }
        ));
    }

    #[test]
    fn extract_zip_enforces_actual_bytes_not_declared_sizes() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = dir.path().join("module.zip");
        write_zip(&archive_path, |writer| {
            writer
                .start_file("big.bin", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(&vec![7u8; 4096]).unwrap();
        });
        // Rewrite the declared (uncompressed) size in the central directory
        // header to 1 byte; the stored data is still 4096 bytes.
        let mut bytes = fs::read(&archive_path).unwrap();
        let central = bytes
            .windows(4)
            .position(|w| w == [0x50, 0x4b, 0x01, 0x02])
            .unwrap();
        bytes[central + 24..central + 28].copy_from_slice(&1u32.to_le_bytes());
        let local = 0;
        bytes[local + 22..local + 26].copy_from_slice(&1u32.to_le_bytes());
        fs::write(&archive_path, &bytes).unwrap();

        let limits = UploadLimits {
            max_entry_bytes: 1024,
            max_uncompressed_bytes: 2048,
            ..UploadLimits::default()
        };
        let dest = dir.path().join("dest");
        fs::create_dir_all(&dest).unwrap();
        let result = service(dir.path(), limits).extract_zip(&archive_path, &dest);

        assert!(matches!(
            unpack_error(result),
            UnpackError::EntryTooLarge { max: 1024, .. }
        ));
    }

    #[test]
    fn unpack_zip_refuses_an_entry_over_the_entry_limit() {
        let dir = tempfile::tempdir().unwrap();
        let limits = UploadLimits {
            max_entry_bytes: 100,
            ..UploadLimits::default()
        };
        let result = extract(limits, dir.path(), |writer| {
            writer
                .start_file("big.txt", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(&[b'a'; 200]).unwrap();
        });

        assert!(matches!(
            unpack_error(result),
            UnpackError::EntryTooLarge { max: 100, .. }
        ));
    }

    #[test]
    fn unpack_zip_reads_in_memory_archives_under_the_same_limits() {
        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            writer
                .start_file("a.txt", SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"hello").unwrap();
            writer.finish().unwrap();
        }
        let bytes = buffer.into_inner();

        let mut seen = Vec::new();
        unpack_zip(
            std::io::Cursor::new(&bytes),
            bytes.len() as u64,
            &UploadLimits::default(),
            |name, reader| {
                let mut contents = String::new();
                reader.read_to_string(&mut contents)?;
                seen.push((name.to_path_buf(), contents));
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(seen, vec![(PathBuf::from("a.txt"), "hello".to_string())]);

        let limits = UploadLimits {
            max_entries: 0,
            ..UploadLimits::default()
        };
        let refused = unpack_zip(
            std::io::Cursor::new(&bytes),
            bytes.len() as u64,
            &limits,
            |_, _| Ok(()),
        );
        assert!(matches!(refused, Err(UnpackError::TooManyEntries { .. })));
    }

    #[actix_web::test]
    async fn process_upload_hashes_the_archive_while_streaming() {
        let dir = tempfile::tempdir().unwrap();
        let file = b"PK fake archive bytes";
        let service = service(dir.path(), UploadLimits::default());

        let meta = service
            .process_upload(multipart(form_body(file, true), Some(90)))
            .await
            .unwrap();

        let expected = format!("{:x}", Sha256::digest(file));
        assert_eq!(meta.sha256, expected);
        assert_eq!(meta.client_id.as_deref(), Some("abc"));
        assert_eq!(
            fs::read(meta.temp_dir_path.join(&meta.file_name)).unwrap(),
            file
        );
    }

    #[actix_web::test]
    async fn process_upload_answers_413_past_the_archive_limit() {
        let dir = tempfile::tempdir().unwrap();
        let limits = UploadLimits {
            max_archive_bytes: 10,
            ..UploadLimits::default()
        };
        let service = service(dir.path(), limits);

        let err = service
            .process_upload(multipart(form_body(&[b'x'; 64], true), None))
            .await
            .unwrap_err();

        assert_eq!(status(&err), 413);
        let leftovers = fs::read_dir(dir.path().join("uploads")).unwrap().count();
        assert_eq!(leftovers, 0, "the partial upload is removed");
    }

    #[actix_web::test]
    async fn process_upload_fails_on_a_truncated_body() {
        let dir = tempfile::tempdir().unwrap();
        let service = service(dir.path(), UploadLimits::default());

        let err = service
            .process_upload(multipart(form_body(b"partial", false), None))
            .await
            .unwrap_err();

        assert_eq!(status(&err), 400);
        let leftovers = fs::read_dir(dir.path().join("uploads")).unwrap().count();
        assert_eq!(leftovers, 0, "the partial upload is removed");
    }

    #[actix_web::test]
    async fn process_upload_refuses_an_oversized_text_field() {
        let dir = tempfile::tempdir().unwrap();
        let service = service(dir.path(), UploadLimits::default());
        let body = format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"callback_url\"\r\n\r\n{}\r\n--{BOUNDARY}--\r\n",
            "u".repeat(MAX_TEXT_FIELD_BYTES + 1)
        );

        let err = service
            .process_upload(multipart(body.into_bytes(), None))
            .await
            .unwrap_err();

        assert_eq!(status(&err), 413);
    }

    #[actix_web::test]
    async fn process_upload_refuses_a_second_file_field() {
        let dir = tempfile::tempdir().unwrap();
        let service = service(dir.path(), UploadLimits::default());
        let mut body = form_body(b"first", false);
        body.extend_from_slice(
            format!(
                "\r\n--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"n.zip\"\r\n\r\nsecond\r\n--{BOUNDARY}--\r\n"
            )
            .as_bytes(),
        );

        let err = service
            .process_upload(multipart(body, None))
            .await
            .unwrap_err();

        assert_eq!(status(&err), 400);
        let leftovers = fs::read_dir(dir.path().join("uploads")).unwrap().count();
        assert_eq!(leftovers, 0, "the first file's temp dir is removed");
    }

    #[actix_web::test]
    async fn process_upload_budgets_unknown_fields_across_the_request() {
        let dir = tempfile::tempdir().unwrap();
        let service = service(dir.path(), UploadLimits::default());
        let chunk = "z".repeat(MAX_FORM_EXTRAS_BYTES as usize / 2 + 1);
        let mut body = String::new();
        for _ in 0..2 {
            body.push_str(&format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"junk\"\r\n\r\n{chunk}\r\n"
            ));
        }
        body.push_str(&format!("--{BOUNDARY}--\r\n"));

        let err = service
            .process_upload(multipart(body.into_bytes(), None))
            .await
            .unwrap_err();

        assert_eq!(status(&err), 413);
    }

    #[actix_web::test]
    async fn process_uploaded_file_survives_an_entry_named_like_the_archive() {
        let dir = tempfile::tempdir().unwrap();
        let service = service(dir.path(), UploadLimits::default());
        let temp = dir.path().join("uploads").join("u1");
        fs::create_dir_all(&temp).unwrap();
        write_zip(&temp.join("m.zip"), |writer| {
            writer.start_file("m.zip", deflated()).unwrap();
            writer.write_all(b"inner").unwrap();
            writer.start_file("a.js", deflated()).unwrap();
            writer.write_all(b"code").unwrap();
        });
        let meta = FileMetadata {
            file_name: "m.zip".into(),
            file_extension: Some("zip".into()),
            upload_dir_path: dir.path().join("uploads"),
            temp_dir_path: temp.clone(),
            sha256: String::new(),
            callback_url: None,
            client_id: None,
            module_key: None,
            marketplace_listing_id: None,
            marketplace_edition: None,
            upload_resource_id: None,
        };

        let files = service.process_uploaded_file(meta).await.unwrap();

        let mut names: Vec<_> = files.iter().map(|f| f.file_name.clone()).collect();
        names.sort();
        assert_eq!(names, ["a.js", "m.zip"]);
        assert!(
            files
                .iter()
                .all(|f| f.temp_dir_path == temp.join(EXTRACT_DIR))
        );
    }
}
