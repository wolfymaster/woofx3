use crate::repository::{CreateFileRequest, Repository};
use anyhow::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::info;

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
            info!(
                "Creating destination directory: {}",
                self.config.destination.display()
            );
            std::fs::create_dir_all(&self.config.destination).map_err(|e| anyhow::Error::new(e))?;
        }
        Ok(())
    }

    async fn list<P: AsRef<Path> + Send>(&self, path: P) -> Result<()> {
        Ok(())
    }

    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(&self, req: I, failed: &mut Vec<String>) -> Result<()> {
        let requests: Vec<CreateFileRequest> = req.into_iter().collect();

        for create_request in requests {
            info!("Writing file {}", create_request.file_name);

            let destination_path = self.config.destination.join(&create_request.file_name);

            // write the file
            if let Some(contents) = create_request.content {
                if let Err(_err) = fs::write(&destination_path, contents).await {
                    failed.push(create_request.file_name);
                }
            }
        }

        Ok(())
    }
}
