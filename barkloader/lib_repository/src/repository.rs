use crate::repositories::file::{FileRepository, FileRepositoryConfig};
use crate::repositories::s3::{S3Repository, S3RepositoryConfig};
use anyhow::Result;
use async_trait::async_trait;
use enum_dispatch::enum_dispatch;
use std::path::Path;
use std::time::Duration;

/// Storage backend configuration. Selected at startup from engine
/// settings (with environment-variable fallback). Adding a new
/// backend means: declare a variant here, implement `Repository`
/// on it, add the matching arm to `RepositoryFactory::new`, and add
/// it to `RepositoryImpl`.
#[derive(Debug, Clone)]
pub enum RepositoryConfig {
    File(FileRepositoryConfig),
    /// S3-compatible — used for AWS S3, Cloudflare R2, and MinIO.
    /// The `endpoint` field is what differentiates them: empty =
    /// default AWS endpoint; otherwise a custom URL like
    /// `https://<account-id>.r2.cloudflarestorage.com`.
    S3(S3RepositoryConfig),
}

#[allow(dead_code)]
pub struct CreateFileRequest {
    pub content: Option<Vec<u8>>,
    pub file_name: String,
    pub extension: Option<String>,
}

/// How a backend lets a client send bytes straight at storage, without
/// proxying them through barkloader.
///
/// The two variants are an implementation detail of the backend, never
/// of the caller-facing contract: `routes::assets` turns both into the
/// same `{uploadUrl, method, headers, expiresAt}` response, so the UI
/// performs one identical `PUT` regardless of which provider is active.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadEndpoint {
    /// The backend signed a URL itself. The client PUTs the bytes to
    /// `url`, sending exactly `headers` -- anything more or less
    /// invalidates the signature.
    Presigned {
        url: String,
        headers: Vec<(String, String)>,
    },
    /// The backend has no signing concept (local disk). The caller must
    /// accept the upload itself and write it through `create`.
    Unsupported,
}

/// One request for permission to upload a single object.
#[derive(Debug, Clone)]
pub struct UploadRequest<'a> {
    /// Repository key the bytes will land at, e.g.
    /// `user/{application_id}/{resource_id}/{filename}`.
    pub key: &'a str,
    /// Content-Type the client will send. Bound into the signature when
    /// the backend supports it, so a grant for an image cannot be
    /// replayed to store something else.
    pub content_type: Option<&'a str>,
    /// How long the grant stays valid. Kept short -- this is a
    /// capability to write into the store.
    pub ttl: Duration,
}

#[allow(dead_code)]
struct Module {
    module_name: String,
    function_name: String,
    function_entrypoint: String,
}

/// Repository surface — fully async so backends with native async
/// SDKs (S3, R2, MinIO) don't have to bridge tokio from sync
/// methods. FileRepository wraps `std::fs` calls in `tokio::fs`
/// equivalents.
#[async_trait]
#[enum_dispatch(RepositoryImpl)]
pub trait Repository {
    fn setup(&self) -> Result<()>;
    async fn read_file(&self, key: &str) -> Result<Vec<u8>>;
    async fn delete_prefix(&self, prefix: &str) -> Result<()>;
    async fn list_prefix(&self, prefix: &str) -> Result<Vec<String>>;
    async fn exists(&self, key: &str) -> Result<bool>;
    async fn list<P: AsRef<Path> + Send>(&self, path: P) -> Result<()>;
    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(
        &self,
        req: I,
        failed: &mut Vec<String>,
    ) -> Result<()>;

    /// Ask the backend for a direct-upload grant for one key. Returning
    /// `UploadEndpoint::Unsupported` is a normal answer, not a failure:
    /// it means "I cannot sign, you accept the bytes". Errors are
    /// reserved for a backend that should have been able to sign and
    /// could not.
    async fn presign_upload(&self, req: UploadRequest<'_>) -> Result<UploadEndpoint>;
}

#[enum_dispatch]
#[derive(Clone)]
pub enum RepositoryImpl {
    File(FileRepository),
    S3(S3Repository),
}

pub struct RepositoryFactory {}
impl RepositoryFactory {
    pub async fn new(config: &RepositoryConfig) -> Result<RepositoryImpl> {
        match config {
            RepositoryConfig::File(file_config) => Ok(RepositoryImpl::File(FileRepository::new(
                FileRepositoryConfig {
                    destination: file_config.destination.clone(),
                },
            ))),
            RepositoryConfig::S3(s3_config) => {
                let repo = S3Repository::new(s3_config.clone()).await?;
                Ok(RepositoryImpl::S3(repo))
            }
        }
    }
}
