use anyhow::Result;
use tonic::transport::Channel;
use uuid::Uuid;

use crate::proto::storage::{
    storage_service_client::StorageServiceClient, ClearAllForApplicationRequest, ClearExpiredRequest,
    ClearNamespaceRequest, DeleteRequest, GetRequest, SetRequest, StorageItem,
};

/// Client for interacting with the storage service
pub struct StorageClient {
    client: StorageServiceClient<Channel>,
}

impl StorageClient {
    /// Create a new storage client connected to the specified address
    pub async fn connect(addr: &str) -> Result<Self> {
        let client = StorageServiceClient::connect(addr.to_string()).await?;
        Ok(Self { client })
    }

    /// Get a value by key
    pub async fn get(&mut self, key: &str, application_id: Uuid) -> Result<Option<StorageKey>> {
        let request = tonic::Request::new(GetRequest {
            key: key.to_string(),
            application_id: application_id.to_string(),
        });

        let response = self.client.get(request).await?;
        let response = response.into_inner();

        if let Some(item) = response.item {
            let expires_at = if item.expires_at > 0 {
                Some(item.expires_at as u64)
            } else {
                None
            };

            Ok(Some(StorageKey {
                key: item.key,
                value: item.value,
                created_at: item.created_at as u64,
                expires_at,
                namespace: item.namespace,
                application_id: Uuid::parse_str(&item.application_id)?,
                clear_on_stream_end: item.clear_on_stream_end,
                clear_on_session_end: item.clear_on_session_end,
            }))
        } else {
            Ok(None)
        }
    }

    /// Set a key-value pair
    pub async fn set(&mut self, key: StorageKey) -> Result<()> {
        let request = tonic::Request::new(SetRequest {
            item: Some(StorageItem {
                key: key.key,
                value: key.value,
                created_at: key.created_at as i64,
                expires_at: key.expires_at.unwrap_or(0) as i64,
                namespace: key.namespace,
                application_id: key.application_id.to_string(),
                clear_on_stream_end: key.clear_on_stream_end,
                clear_on_session_end: key.clear_on_session_end,
            }),
        });

        self.client.set(request).await?;
        Ok(())
    }

    /// Delete a key from storage
    pub async fn delete(&mut self, key: &str, application_id: Uuid) -> Result<()> {
        let request = tonic::Request::new(DeleteRequest {
            key: key.to_string(),
            application_id: application_id.to_string(),
        });

        self.client.delete(request).await?;
        Ok(())
    }

    /// Clear all keys in a namespace
    pub async fn clear_namespace(&mut self, namespace: &str, application_id: Uuid) -> Result<()> {
        let request = tonic::Request::new(ClearNamespaceRequest {
            namespace: namespace.to_string(),
            application_id: application_id.to_string(),
        });

        self.client.clear_namespace(request).await?;
        Ok(())
    }

    /// Clear all expired keys
    pub async fn clear_expired(&mut self, application_id: Uuid) -> Result<()> {
        let request = tonic::Request::new(ClearExpiredRequest {
            application_id: application_id.to_string(),
        });

        self.client.clear_expired(request).await?;
        Ok(())
    }

    /// Clear all keys for an application
    pub async fn clear_all_for_application(&mut self, application_id: Uuid) -> Result<()> {
        let request = tonic::Request::new(ClearAllForApplicationRequest {
            application_id: application_id.to_string(),
        });

        self.client.clear_all_for_application(request).await?;
        Ok(())
    }
}

/// Storage key with metadata
#[derive(Debug, Clone)]
pub struct StorageKey {
    pub key: String,
    pub value: String,
    pub created_at: u64,
    pub expires_at: Option<u64>,
    pub namespace: String,
    pub application_id: Uuid,
    pub clear_on_stream_end: bool,
    pub clear_on_session_end: bool,
}
