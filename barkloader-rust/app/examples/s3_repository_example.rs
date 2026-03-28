use anyhow::Result;
use std::time::Duration;
use uuid::Uuid;

use barkloader::{
    config::Config,
    storage::{init_storage, s3, ModuleStorage}
};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Load configuration from environment variables
    let config = Config::from_env()?;
    
    // Initialize storage with the configuration
    init_storage(&config).await?;
    
    // Get the S3 repository
    let s3_repo = s3().await?;
    let mut s3_repo = s3_repo.lock().await;
    
    // Generate a test module ID
    let module_id = Uuid::new_v4().to_string();
    let file_name = "test-script.js";
    let file_content = b"console.log('Hello from S3!')";
    
    // Example: Upload a module asset
    let s3_path = s3_repo.upload_module_asset(
        &module_id,
        file_name,
        file_content.to_vec(),
        Some("application/javascript"),
    ).await?;
    
    println!("Module asset uploaded to: {}", s3_path);
    
    // Example: Get a pre-signed URL for the asset
    let asset_url = s3_repo.get_module_asset_url(
        &module_id,
        file_name,
        Some(Duration::from_secs(3600)), // 1 hour
    ).await?;
    
    println!("Asset URL (valid for 1h): {}", asset_url);
    
    // Example: List all assets for the module
    let assets = s3_repo.list_module_assets(&module_id).await?;
    println!("Module assets: {:?}", assets);
    
    // Example: Delete a module asset
    s3_repo.delete_module_asset(&module_id, file_name).await?;
    println!("Deleted asset: {}/{}", module_id, file_name);
    
    // Clean up: Delete all test assets
    let assets = s3_repo.list_module_assets(&module_id).await?;
    for asset in assets {
        if let Some(file_name) = asset.split('/').last() {
            s3_repo.delete_module_asset(&module_id, file_name).await?;
            println!("Cleaned up asset: {}", asset);
        }
    }
    
    println!("Example completed successfully!");
    
    Ok(())
}
