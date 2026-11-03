//! Runs a module's inbound webhook handler and answers the request with
//! what the handler returned.

use crate::host::{HandlerResult, NatsPublisher};
use anyhow::{Context, Result};

pub struct WebhookDispatch {
    nats: NatsPublisher,
}

impl WebhookDispatch {
    pub fn new(nats: NatsPublisher) -> Self {
        Self { nats }
    }

    /// Publishes the events the handler returned, then hands back the
    /// response the caller should send.
    pub async fn finish(&self, result: HandlerResult) -> Result<HandlerResponse> {
        for event in &result.events {
            let payload = serde_json::to_vec(&event.data).context("encode webhook event")?;
            self.nats
                .publish(event.event_type.clone(), payload)
                .await
                .with_context(|| format!("publish {}", event.event_type))?;
        }
        Ok(HandlerResponse {
            status: result.status,
            body: result.body,
        })
    }
}

pub struct HandlerResponse {
    pub status: u16,
    pub body: Option<String>,
}
