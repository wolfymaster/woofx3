use crate::repository::{CreateFileRequest, Repository};
use anyhow::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::info;

fn collect_files_recursive(dir: &Path, base: &Path, results: &mut Vec<String>) -> Result<()> {
    for entry in std::fs::read_dir(dir)
        .map_err(|e| anyhow::anyhow!("failed to read directory {}: {}", dir.display(), e))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(&path, base, results)?;
        } else {
            let relative = path
                .strip_prefix(base)
                .map_err(|e| anyhow::anyhow!("failed to compute relative path: {}", e))?;
            results.push(relative.to_string_lossy().into_owned());
        }
    }
    Ok(())
}

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

    fn read_file(&self, key: &str) -> Result<Vec<u8>> {
        let path = self.config.destination.join(key);
        std::fs::read(&path)
            .map_err(|e| anyhow::anyhow!("failed to read file {}: {}", path.display(), e))
    }

    fn delete_prefix(&self, prefix: &str) -> Result<()> {
        let dir = self.config.destination.join(prefix);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| anyhow::anyhow!("failed to delete {}: {}", dir.display(), e))?;
        }
        Ok(())
    }

    fn list_prefix(&self, prefix: &str) -> Result<Vec<String>> {
        let dir = self.config.destination.join(prefix);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut results = Vec::new();
        collect_files_recursive(&dir, &self.config.destination, &mut results)?;
        Ok(results)
    }

    async fn list<P: AsRef<Path> + Send>(&self, path: P) -> Result<()> {
        Ok(())
    }

    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(&self, req: I, failed: &mut Vec<String>) -> Result<()> {
        let requests: Vec<CreateFileRequest> = req.into_iter().collect();

        for create_request in requests {
            info!("Writing file {}", create_request.file_name);

            let destination_path = self.config.destination.join(&create_request.file_name);

            // ensure parent directories exist for nested paths
            if let Some(parent) = destination_path.parent() {
                if !parent.exists() {
                    if let Err(_err) = fs::create_dir_all(parent).await {
                        failed.push(create_request.file_name);
                        continue;
                    }
                }
            }

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
