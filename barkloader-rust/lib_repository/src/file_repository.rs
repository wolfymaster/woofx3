use std::path::PathBuf;
use anyhow::Result;
use tokio::fs;
use tracing::info;
use crate::{Repository, RepositoryConfig};
use async_trait::async_trait;

pub struct FileRepository {
    config: RepositoryConfig,
}

impl FileRepository {
    pub fn new(config: RepositoryConfig) -> Self {
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

    async fn fetch(&self, path: &str) -> Result<()> {
        let source_path = PathBuf::from(path);
        let destination_path = self.config.destination.join(source_path.file_name().unwrap_or_default());

        info!(
            "Copying file from {} to {}",
            source_path.display(),
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
        fs::copy(&source_path, &destination_path).await.map_err(|e| {
            anyhow::Error::new(e)
        })?;
        Ok(())
    }
}
