use anyhow::Result;
use once_cell::sync::OnceCell;
use std::sync::Arc;

use crate::config::Config;
use super::StorageManager;

static STORAGE_MANAGER: OnceCell<Arc<StorageManager>> = OnceCell::new();

/// Initialize the storage system with the given configuration
pub async fn init_storage(config: &Config) -> Result<()> {
    let storage_manager = StorageManager::new(config).await?;
    
    // Store the storage manager in the global static
    STORAGE_MANAGER
        .set(Arc::new(storage_manager))
        .map_err(|_| anyhow::anyhow!("Storage manager already initialized"))?;
    
    Ok(())
}

/// Get a reference to the global storage manager
pub fn get_storage() -> Result<Arc<StorageManager>> {
    STORAGE_MANAGER
        .get()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Storage manager not initialized"))
}

/// Get a reference to the S3 repository
pub async fn s3() -> Result<std::sync::Arc<tokio::sync::Mutex<lib_repository::repositories::s3::S3Repository>>> {
    let storage = get_storage()?;
    Ok(storage.s3())
}
