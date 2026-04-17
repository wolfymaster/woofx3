use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use aws_config::{
    meta::region::RegionProviderChain,
    BehaviorVersion,
};
use aws_sdk_s3::{
    Client,
    primitives::ByteStream,
    operation::put_object::PutObjectError,
};
use log::{info, error};
use mime_guess::mime;
use tokio::fs;
use uuid::Uuid;

use crate::repository::{CreateFileRequest, Repository};

/// Configuration for the S3 repository
#[derive(Debug, Clone)]
pub struct S3RepositoryConfig {
    /// The S3 bucket name
    pub bucket: String,
    /// Optional prefix for all keys
    pub prefix: Option<String>,
    /// The AWS region
    pub region: Option<String>,
}

#[derive(Debug, Clone)]
pub struct S3Repository {
     #[allow(dead_code)]
    config: S3RepositoryConfig,
     #[allow(dead_code)]
    client: Arc<Client>,
}

/// Module-specific S3 operations
#[async_trait::async_trait]
pub trait ModuleStorage {
    /// Upload a module asset (scripts, media, etc.)
    async fn upload_module_asset(
        &self,
        module_id: &str,
        file_name: &str,
        content: Vec<u8>,
        content_type: Option<&str>,
    ) -> Result<String>;

    /// Get a module asset URL
    async fn get_module_asset_url(
        &self,
        module_id: &str,
        file_name: &str,
        expires_in: Option<Duration>,
    ) -> Result<String>;

    /// Delete a module asset
    async fn delete_module_asset(&self, module_id: &str, file_name: &str) -> Result<()>;

    /// List all assets for a module
    async fn list_module_assets(&self, module_id: &str) -> Result<Vec<String>>;
}

#[async_trait::async_trait]
impl ModuleStorage for S3Repository {
    /// Create a new S3 repository with the given configuration
    pub async fn new(config: S3RepositoryConfig) -> Result<Self> {
        let region_provider = RegionProviderChain::first_try(config.region.as_ref().map(|r| r.as_str()))
            .or_default_provider()
            .or_else("us-east-1");
            
        let shared_config = aws_config::defaults(BehaviorVersion::v2025_01_17())
            .region(region_provider)
            .load()
            .await;
            
        let client = Arc::new(Client::new(&shared_config));
        
        // Verify the bucket exists and is accessible
        client.head_bucket()
            .bucket(&config.bucket)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to access S3 bucket {}: {}", config.bucket, e))?;
            
        Ok(Self { config, client })
    }
    
    /// Generate a unique key for a file
    fn generate_key(&self, file_name: &str, extension: &str) -> String {
        let uuid = Uuid::new_v4();
        let file_name = sanitize_filename::sanitize(file_name);
        let key = format!("{}-{}.{}", file_name, uuid, extension.trim_start_matches('.'));
        
        if let Some(prefix) = &self.config.prefix {
            format!("{}/{}", prefix.trim_end_matches('/'), key)
        } else {
            key
        }
    }

     /// Upload a file to S3
    async fn upload_object(&self, key: &str, content: Vec<u8>, content_type: Option<&str>) -> Result<String> {
        let body = ByteStream::from(content);
        let mut request = self.client
            .put_object()
            .bucket(&self.config.bucket)
            .key(key)
            .body(body);
            
        if let Some(content_type) = content_type {
            request = request.content_type(content_type);
        }
        
        request.send().await
            .map_err(|e| anyhow!("Failed to upload file to S3: {}", e))?;
            
        Ok(format!("s3://{}/{}", self.config.bucket, key))
    }
    
    /// Download a file from S3
    async fn download_object(&self, key: &str, destination: &Path) -> Result<()> {
        let response = self.client
            .get_object()
            .bucket(&self.config.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to download file from S3: {}", e))?;

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
    
    /// Delete a file from S3
    async fn delete_object(&self, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(&self.config.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to delete file from S3: {}", e))?;
            
        Ok(())
    }
    
    /// Generate a pre-signed URL for a file
    pub async fn generate_presigned_url(
        &self,
        key: &str,
        expires_in: Duration,
    ) -> Result<String> {
        use aws_sdk_s3::presigning::config::PresigningConfig;
        
        let expires_in = expires_in.as_secs().clamp(1, 7 * 24 * 3600); // Max 7 days
        
        let presigned_request = self.client
            .get_object()
            .bucket(&self.config.bucket)
            .key(key)
            .presigned(PresigningConfig::expires_in(Duration::from_secs(expires_in))?)
            .await
            .map_err(|e| anyhow!("Failed to generate presigned URL: {}", e))?;
            
        Ok(presigned_request.uri().to_string())
    }
    
    // Module-specific implementations
    async fn upload_module_asset(
        &self,
        module_id: &str,
        file_name: &str,
        content: Vec<u8>,
        content_type: Option<&str>,
    ) -> Result<String> {
        let key = format!("modules/{}/{}", module_id, file_name);
        self.upload_object(&key, content, content_type).await
    }
    
    async fn get_module_asset_url(
        &self,
        module_id: &str,
        file_name: &str,
        expires_in: Option<Duration>,
    ) -> Result<String> {
        let key = format!("modules/{}/{}", module_id, file_name);
        let expires_in = expires_in.unwrap_or_else(|| Duration::from_secs(3600)); // Default 1 hour
        self.generate_presigned_url(&key, expires_in).await
    }
    
    async fn delete_module_asset(&self, module_id: &str, file_name: &str) -> Result<()> {
        let key = format!("modules/{}/{}", module_id, file_name);
        self.delete_object(&key).await
    }
    
    async fn list_module_assets(&self, module_id: &str) -> Result<Vec<String>> {
        let prefix = format!("modules/{}/", module_id);
        let mut objects = Vec::new();
        
        let mut paginator = self.client
            .list_objects_v2()
            .bucket(&self.config.bucket)
            .prefix(&prefix)
            .into_paginator()
            .send();
            
        while let Some(result) = paginator.next().await {
            let output = result?;
            
            if let Some(contents) = output.contents {
                for obj in contents {
                    if let Some(key) = obj.key {
                        objects.push(key);
                    }
                }
            }
        }
        
        Ok(objects)
    }
}

#[async_trait]
impl Repository for S3Repository {
    fn setup(&self) -> Result<()> {
        info!("Initialized S3 repository with bucket: {}", self.config.bucket);
        Ok(())
    }

    async fn list<P: AsRef<Path> + Send>(&self, prefix: P) -> Result<()> {
        let prefix = prefix.as_ref().to_string_lossy();
        info!("Listing objects in S3 bucket: {} with prefix: {}", self.config.bucket, prefix);
        
        // TODO: Implement actual listing of objects with the given prefix
        // This would use list_objects_v2 and return a list of objects
        
        Ok(())
    }

    async fn create<I>(&self, req: I, failed: &mut Vec<String>) -> Result<()>
    where
        I: IntoIterator<Item = CreateFileRequest> + Send,
        I::IntoIter: Send,
    {
        let mut tasks = Vec::new();
        
        for create_req in req {
            let client = self.client.clone();
            let bucket = self.config.bucket.clone();
            let key = self.generate_key(&create_req.file_name, &create_req.extension.unwrap_or_default());
            let content = create_req.content.unwrap_or_default();
            let content_type = create_req.content_type;
            
            tasks.push(tokio::spawn(async move {
                let body = ByteStream::from(content);
                let mut request = client
                    .put_object()
                    .bucket(&bucket)
                    .key(&key)
                    .body(body);
                    
                if let Some(ct) = content_type {
                    request = request.content_type(ct);
                }
                
                match request.send().await {
                    Ok(_) => {
                        info!("Successfully uploaded file: {}", key);
                        Ok(key)
                    }
                    Err(e) => {
                        error!("Failed to upload file {}: {}", key, e);
                        Err(key)
                    }
                }
            }));
        }
        
        // Wait for all uploads to complete
        for task in tasks {
            match task.await? {
                Ok(_) => {}
                Err(key) => failed.push(key),
            }
        }
        
        if !failed.is_empty() {
            return Err(anyhow!("Failed to upload {} files", failed.len()));
        }
        
        Ok(())
    }
}
