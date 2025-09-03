use anyhow::Result;
use std::path::{Path};
use async_trait::async_trait;
use enum_dispatch::enum_dispatch;
use crate::repositories::file::{FileRepository, FileRepositoryConfig};
use crate::repositories::s3::{S3Repository, S3RepositoryConfig};

#[derive(Debug, Clone)]
pub enum RepositoryConfig {
    File(FileRepositoryConfig),
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

#[async_trait]
#[enum_dispatch(RepositoryImpl)]
pub trait Repository {
    fn setup(&self) -> Result<()>;
    async fn list<P: AsRef<Path> + Send>(&self, path: P) -> Result<()>;
    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(&self, req: I, failed: &mut Vec<String>) -> Result<()>;
}

#[enum_dispatch]
#[derive(Clone)]
pub enum RepositoryImpl {
    File(FileRepository),
    S3(S3Repository),
}

pub struct RepositoryFactory {}
impl RepositoryFactory {
    pub async fn new(config: &RepositoryConfig) -> RepositoryImpl {
        match config {
            RepositoryConfig::File(file_config) => RepositoryImpl::File(FileRepository::new(FileRepositoryConfig {
                destination: file_config.destination.clone(),
            })),
            RepositoryConfig::S3(_s3_config) => RepositoryImpl::S3(S3Repository::new(S3RepositoryConfig {}).await),
        }
    }
}
