use anyhow::Result;
use async_nats::{Client, RequestErrorKind};
use lib_sandbox::host::{NatsPublisher, NatsRequester, RequestError};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Handle;
use tracing::{debug, warn};

pub struct NatsService {
    client: Client,
    handle: Handle,
}

impl NatsService {
    pub async fn connect(url: &str) -> Result<Arc<Self>> {
        let client = async_nats::connect(url).await?;
        Ok(Arc::new(Self {
            client,
            handle: Handle::current(),
        }))
    }
}

impl NatsService {
    pub fn raw_client(&self) -> &Client {
        &self.client
    }
}

impl NatsPublisher for NatsService {
    fn publish(&self, subject: &str, data: Value) -> Result<(), String> {
        let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
        let client = self.client.clone();
        let subject_owned = subject.to_string();
        self.handle.spawn(async move {
            match client.publish(subject_owned.clone(), bytes.into()).await {
                Ok(()) => debug!("NATS published on {}", subject_owned),
                Err(e) => warn!("NATS publish failed for {}: {}", subject_owned, e),
            }
        });
        Ok(())
    }
}

impl NatsRequester for NatsService {
    /// Blocks the calling thread on the reply, so it must be called from the
    /// sandbox's blocking thread (see `SandboxFactory::invoke_blocking`),
    /// never from an async task.
    fn request(
        &self,
        subject: &str,
        data: Value,
        timeout: Duration,
    ) -> Result<Value, RequestError> {
        let bytes = serde_json::to_vec(&data).map_err(|e| RequestError::Failed(e.to_string()))?;
        let request = async_nats::Request::new()
            .payload(bytes.into())
            .timeout(Some(timeout));
        let client = self.client.clone();
        let subject_owned = subject.to_string();
        let reply = self
            .handle
            .block_on(async move { client.send_request(subject_owned, request).await })
            .map_err(|e| match e.kind() {
                RequestErrorKind::TimedOut => RequestError::TimedOut,
                RequestErrorKind::NoResponders => RequestError::NoResponders,
                RequestErrorKind::Other => RequestError::Failed(e.to_string()),
            })?;
        serde_json::from_slice(&reply.payload)
            .map_err(|e| RequestError::Failed(format!("the reply on {subject} is not JSON: {e}")))
    }
}
