use super::*;
use serde_json::Value;
use std::sync::Arc;
use tokio::runtime::Handle;
use tokio::sync::Mutex;
use uuid::Uuid;
use woofx3::storage::storage::storage_service_client::StorageServiceClient;
use woofx3::storage::storage::{GetRequest, SetRequest, StorageItem};

pub struct GrpcStorageClient {
    client: Arc<Mutex<StorageServiceClient<tonic::transport::Channel>>>,
    application_id: Uuid,
}

impl GrpcStorageClient {
    pub async fn new(addr: String, application_id: Uuid) -> Result<Self, String> {
        let client: StorageServiceClient<tonic::transport::Channel> = StorageServiceClient::connect(addr)
            .await
            .map_err(|e| format!("Failed to connect to storage service: {}", e))?;
        Ok(Self {
            client: Arc::new(Mutex::new(client)),
            application_id,
        })
    }
}

impl StorageClient for GrpcStorageClient {
    fn get(&self, key: &str) -> Result<Option<Value>, String> {
        let client = self.client.clone();
        let application_id = self.application_id;
        let key_owned = key.to_string();

        Handle::current().block_on(async move {
            let mut client = client.lock().await;
            let request = tonic::Request::new(GetRequest {
                key: key_owned,
                application_id: application_id.to_string(),
            });

            match client.get(request).await {
                Ok(response) => {
                    let response = response.into_inner();
                    if let Some(item) = response.item {
                        let value: Value = serde_json::from_str(&item.value)
                            .map_err(|e| format!("Failed to parse storage value: {}", e))?;
                        Ok(Some(value))
                    } else {
                        Ok(None)
                    }
                }
                Err(e) => Err(format!("Storage get failed: {}", e)),
            }
        })
    }

    fn set(&self, key: &str, value: Value) -> Result<(), String> {
        let client = self.client.clone();
        let application_id = self.application_id;
        let key_owned = key.to_string();
        let value_str = serde_json::to_string(&value)
            .map_err(|e| format!("Failed to serialize value: {}", e))?;

        Handle::current().block_on(async move {
            let mut client = client.lock().await;
            let request = tonic::Request::new(SetRequest {
                item: Some(StorageItem {
                    key: key_owned,
                    value: value_str,
                    created_at: 0,
                    expires_at: 0,
                    namespace: String::new(),
                    application_id: application_id.to_string(),
                    clear_on_stream_end: false,
                }),
            });

            match client.set(request).await {
                Ok(_) => Ok(()),
                Err(e) => Err(format!("Storage set failed: {}", e)),
            }
        })
    }
}