use std::path::{Path, PathBuf};
use anyhow::Result;
use async_trait::async_trait;
use tokio::fs;
use tracing::info;
use crate::repository::{CreateFileRequest, Repository};

#[derive(Clone, Debug)]
pub struct FileRepositoryConfig {
    pub destination: PathBuf,
}

#[derive(Clone)]
pub struct FileRepository {
    config: FileRepositoryConfig,
}

impl FileRepository {
    pub fn new(config: FileRepositoryConfig) -> Self {
        Self { config }
    }
}

#[async_trait]
impl Repository for FileRepository {
    fn setup(&self) -> Result<()> {
        // Create destination directory if it doesn't exist
        if !self.config.destination.exists() {
            info!("Creating destination directory: {}", self.config.destination.display());
            std::fs::create_dir_all(&self.config.destination).map_err(|e| {
                anyhow::Error::new(e)
            })?;
        }
        Ok(())
    }

    async fn list<P: AsRef<Path> + Send>(&self, path: P) -> Result<()> {
        let file_path = path.as_ref();
        let destination_path = self.config.destination.join(file_path.file_name().unwrap_or_default());

        info!(
            "Copying file from {} to {}",
            file_path.display(),
            destination_path.display()
        );

        // Create parent directories if they don't exist
        if let Some(parent) = destination_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await.map_err(|e| {
                    anyhow::Error::new(e)
                })?;
            }
        }

        // Copy the file
        fs::copy(&file_path, &destination_path).await.map_err(|e| {
            anyhow::Error::new(e)
        })?;
        Ok(())
    }

    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(&self, req: I) -> Result<()> {
        Ok(())
    }
}
