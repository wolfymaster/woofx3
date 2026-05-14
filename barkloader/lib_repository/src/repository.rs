use crate::repositories::file::{FileRepository, FileRepositoryConfig};
use crate::repositories::s3::{S3Repository, S3RepositoryConfig};
use anyhow::Result;
use async_trait::async_trait;
use enum_dispatch::enum_dispatch;
use std::path::Path;

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
