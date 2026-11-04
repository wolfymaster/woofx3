//! Runs a module's inbound webhook handler and answers the request with
//! what the handler returned.

use crate::host::{HandlerResult, NatsPublisher};
use anyhow::{Context, Result, bail};
use lib_module::reserved_subjects::declared_event_reservation;
use std::collections::HashSet;

pub struct WebhookDispatch {
    nats: NatsPublisher,
}

impl WebhookDispatch {
    pub fn new(nats: NatsPublisher) -> Self {
        Self { nats }
    }

    /// Checks every returned event against the module's declared eventbus
    /// triggers and the reserved subjects before publishing any of them, so
    /// one refused event publishes nothing.
    pub async fn finish(
        &self,
        module_id: &str,
        declared: &HashSet<String>,
        result: HandlerResult,
    ) -> Result<HandlerResponse> {
        for event in &result.events {
            if !declared.contains(&event.event_type) {
                bail!("{} is not one of the module's eventbus triggers", event.event_type);
            }
            if let Some(entry) = declared_event_reservation(&event.event_type, module_id) {
                bail!("{} is reserved for the engine ({entry})", event.event_type);
            }
        }
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
