use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use uuid::Uuid;

use barkloader_runtime::storage::{StorageClient, StorageKey};
use barkloader_runtime::services::module_service::module_manifest::{ModuleStorage, StorageKeyConfig};

#[tokio::test]
async fn test_module_storage_process() -> Result<()> {
    // Create a mock storage client
    let mut storage_client = MockStorageClient::new();
    
    // Create a test application ID
    let app_id = Uuid::new_v4();
    
    // Create a test storage configuration
    let storage_config = ModuleStorage {
        keys: vec![(
            "test_key".to_string(),
            StorageKeyConfig {
                default_value: Some("default_value".to_string()),
                ttl_seconds: Some(3600), // 1 hour
                namespace: "test_namespace".to_string(),
                clear_on_stream_end: false,
                clear_on_session_end: false,
            },
        )]
        .into_iter()
        .collect(),
    };
    
    // Process the storage configuration
    storage_config.process(&mut storage_client, app_id).await?;
    
    // Verify the key was set with the correct values
    let stored = storage_client.get("test_key", app_id).await?.unwrap();
    assert_eq!(stored.value, "default_value");
    assert_eq!(stored.namespace, "test_namespace");
    assert!(stored.expires_at.is_some());
    
    // Test key expiration
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    assert!(stored.expires_at.unwrap() > now);
    
    Ok(())
}

// Mock implementation for testing
struct MockStorageClient {
    storage: std::collections::HashMap<String, StorageKey>,
}

impl MockStorageClient {
    fn new() -> Self {
        Self {
            storage: std::collections::HashMap::new(),
        }
    }
}

#[async_trait::async_trait]
impl StorageClient for MockStorageClient {
    async fn get(&mut self, key: &str, _application_id: Uuid) -> Result<Option<StorageKey>> {
        Ok(self.storage.get(key).cloned())
    }
    
    async fn set(&mut self, key: StorageKey) -> Result<()> {
        self.storage.insert(key.key.clone(), key);
        Ok(())
    }
    
    async fn delete(&mut self, key: &str, _application_id: Uuid) -> Result<()> {
        self.storage.remove(key);
        Ok(())
    }
    
    async fn clear_namespace(&mut self, _namespace: &str, _application_id: Uuid) -> Result<()> {
        // Simplified implementation for testing
        Ok(())
    }
    
    async fn clear_expired(&mut self, _application_id: Uuid) -> Result<()> {
        // Simplified implementation for testing
        Ok(())
    }
    
    async fn clear_all_for_application(&mut self, _application_id: Uuid) -> Result<()> {
        // Simplified implementation for testing
        Ok(())
    }
}
