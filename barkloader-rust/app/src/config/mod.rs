use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::env;

/// Main application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// S3 storage configuration
    pub s3: S3Config,
}

impl Config {
    /// Load configuration from environment variables
    pub fn from_env() -> Result<Self> {
        let s3 = S3Config::from_env()?;
        
        Ok(Self { s3 })
    }
}

/// S3 storage configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Config {
    /// S3 bucket name
    pub bucket: String,
    /// Optional prefix for all keys
    pub prefix: Option<String>,
    /// AWS region
    pub region: Option<String>,
    /// AWS access key ID (for local development)
    pub access_key_id: Option<String>,
    /// AWS secret access key (for local development)
    pub secret_access_key: Option<String>,
    /// Custom S3 endpoint (for local development with minio/localstack)
    pub endpoint_url: Option<String>,
    /// Enable path style access (required for some S3-compatible storage)
    pub force_path_style: bool,
}

impl S3Config {
    /// Load S3 configuration from environment variables
    pub fn from_env() -> Result<Self> {
        // Default values
        let mut config = S3Config {
            bucket: env::var("S3_BUCKET").unwrap_or_else(|_| "barkloader-assets".to_string()),
            prefix: env::var("S3_PREFIX").ok(),
            region: env::var("AWS_REGION")
                .or_else(|_| env::var("AWS_DEFAULT_REGION"))
                .ok(),
            access_key_id: env::var("AWS_ACCESS_KEY_ID")
                .or_else(|_| env::var("AWS_ACCESS_KEY"))
                .ok(),
            secret_access_key: env::var("AWS_SECRET_ACCESS_KEY")
                .or_else(|_| env::var("AWS_SECRET_KEY"))
                .ok(),
            endpoint_url: env::var("S3_ENDPOINT").ok(),
            force_path_style: env::var("S3_FORCE_PATH_STYLE")
                .map(|v| v.to_lowercase() == "true" || v == "1")
                .unwrap_or(false),
        };

        // For local development, allow overriding with .env file
        if dotenv::from_filename(".env").is_ok() {
            if env::var("S3_BUCKET").is_ok() {
                config.bucket = env::var("S3_BUCKET")?;
            }
            if let Ok(prefix) = env::var("S3_PREFIX") {
                config.prefix = Some(prefix);
            }
            if let Ok(region) = env::var("AWS_REGION").or_else(|_| env::var("AWS_DEFAULT_REGION")) {
                config.region = Some(region);
            }
        }

        Ok(config)
    }

    /// Convert to lib_repository's S3RepositoryConfig
    pub fn to_repository_config(&self) -> lib_repository::repositories::s3::S3RepositoryConfig {
        lib_repository::repositories::s3::S3RepositoryConfig {
            bucket: self.bucket.clone(),
            prefix: self.prefix.clone(),
            region: self.region.clone(),
        }
    }
}
