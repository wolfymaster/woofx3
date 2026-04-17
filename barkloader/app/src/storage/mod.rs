use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;

pub mod service;
pub mod s3;
pub mod init;

pub use service::{StorageClient, StorageKey};
pub use init::{init_storage, get_storage, s3};

/// Storage configuration
#[derive(Debug, Clone)]
pub struct StorageConfig {
    /// S3 configuration
    pub s3: crate::config::S3Config,
}

/// Storage manager that holds different storage backends
#[derive(Clone)]
pub struct StorageManager {
    /// S3 repository for module assets
    pub s3: Arc<Mutex<lib_repository::repositories::s3::S3Repository>>,
}

impl StorageManager {
    /// Create a new storage manager with the given configuration
    pub async fn new(config: &crate::config::Config) -> Result<Self> {
        let s3_repo = lib_repository::repositories::s3::S3Repository::new(config.s3.to_repository_config())
            .await?;

        Ok(Self {
            s3: Arc::new(Mutex::new(s3_repo)),
        })
    }

    /// Get a reference to the S3 repository
    pub fn s3(&self) -> std::sync::Arc<Mutex<lib_repository::repositories::s3::S3Repository>> {
        self.s3.clone()
    }
}
