use std::path::PathBuf;
use std::sync::Arc;
use anyhow::Result;
use async_trait::async_trait;

pub mod file_repository;
pub mod s3_repository;

#[derive(Debug, Clone)]
pub struct RepositoryConfig {
    pub destination: PathBuf,
}

#[async_trait]
pub trait Repository: Send + Sync {
    fn setup(&self) -> Result<()>;
    async fn fetch(&self, path: &str) -> Result<()>;
}

#[derive(Debug, Clone)]
pub enum RepositoryType {
    File,
    S3,
}

pub async fn create_repository(repo_type: RepositoryType, config: &RepositoryConfig) -> Arc<dyn Repository> {
    match repo_type {
        RepositoryType::File => Arc::new(file_repository::FileRepository::new(config.clone())),
        RepositoryType::S3 => Arc::new(s3_repository::S3Repository::new(config.clone()).await),
    }
}