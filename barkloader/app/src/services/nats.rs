use anyhow::Result;
use async_nats::Client;
use lib_sandbox::host::NatsPublisher;
use log::{debug, warn};
use serde_json::Value;
use std::sync::Arc;
use tokio::runtime::Handle;

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
