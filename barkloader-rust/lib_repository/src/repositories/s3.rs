use std::path::{Path, PathBuf};
use std::sync::Arc;
use anyhow::Result;
use async_trait::async_trait;
use aws_config::BehaviorVersion;
use aws_sdk_s3::Client;
use tokio::fs;
use crate::repository::{CreateFileRequest, Repository};

#[derive(Debug, Clone)]
pub struct S3RepositoryConfig {
    
}

#[derive(Debug, Clone)]
pub struct S3Repository {
     #[allow(dead_code)]
    config: S3RepositoryConfig,
     #[allow(dead_code)]
    client: Arc<Client>,
}

impl S3Repository {
    pub async fn new(config: S3RepositoryConfig) -> Self {
        let shared_config = aws_config::load_defaults(BehaviorVersion::v2025_01_17()).await;
        let client = Arc::new(Client::new(&shared_config));
        Self { config, client }
    }

     #[allow(dead_code)]
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
        Ok(())
    }

    async fn list<P: AsRef<Path> + Send>(&self, _path: P) -> Result<()> {
        // let file_path = path.as_ref();
        // 
        // // Parse the S3 path (format: bucket/key)
        // let parts: Vec<&str> = path.split('/').collect();
        // if parts.len() < 2 {
        //     return Err(anyhow::anyhow!("Invalid S3 path format. Expected: bucket/key"));
        // }
        // 
        // let bucket = parts[0];
        // let key = &parts[1..].join("/");
        // let destination_path = self.config.destination.join(parts.last().unwrap_or(&""));
        // 
        // info!(
        //     "Downloading from S3 bucket: {} key: {} to {}",
        //     bucket,
        //     key,
        //     destination_path.display()
        // );
        // 
        // self.download_object(bucket, key, &destination_path).await
        Ok(())
    }

    async fn create<I: IntoIterator<Item = CreateFileRequest> + Send>(&self, req: I, _failed: &mut Vec<String>) -> Result<()> {
        for create_request in req {
            
        }
        
        Ok(())
    }
}
