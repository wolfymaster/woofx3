use std::path::PathBuf;
use std::sync::Arc;
use anyhow::Result;
use aws_config::BehaviorVersion;
use aws_sdk_s3::Client;
use tokio::fs;
use tracing::info;
use crate::{Repository, RepositoryConfig};
use async_trait::async_trait;

#[derive(Debug, Clone)]
pub struct S3Repository {
    config: RepositoryConfig,
    client: Arc<Client>,
}

impl S3Repository {
    pub async fn new(config: RepositoryConfig) -> Self {
        let shared_config = aws_config::load_defaults(BehaviorVersion::v2025_01_17()).await;
        let client = Arc::new(Client::new(&shared_config));
        Self { config, client }
    }

    async fn download_object(&self, bucket: &str, key: &str, destination: &PathBuf) -> Result<()> {
        let response = self.client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await?;

        let body = response.body.collect().await?;
        let bytes = body.into_bytes();

        // Create parent directories if they don't exist
        if let Some(parent) = destination.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await?;
            }
        }

        // Write the file
        fs::write(destination, bytes).await?;
        Ok(())
    }
}

#[async_trait]
impl Repository for S3Repository {
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
        // Parse the S3 path (format: bucket/key)
        let parts: Vec<&str> = path.split('/').collect();
        if parts.len() < 2 {
            return Err(anyhow::anyhow!("Invalid S3 path format. Expected: bucket/key"));
        }

        let bucket = parts[0];
        let key = &parts[1..].join("/");
        let destination_path = self.config.destination.join(parts.last().unwrap_or(&""));

        info!(
            "Downloading from S3 bucket: {} key: {} to {}",
            bucket,
            key,
            destination_path.display()
        );

        self.download_object(bucket, key, &destination_path).await
    }
}
