//! Publishes barkloader's readiness heartbeat.
//!
//! Barkloader accepts HTTP as soon as it binds, but the bundled modules it
//! installs are not available until the boot reconciler finishes. Anything
//! resolving a system canonical id before that gets a transient failure that
//! looks like a missing module rather than a service that has not finished
//! starting. The heartbeat is how a dependent tells those apart.

use std::sync::Arc;
use std::time::Duration;

use async_nats::Client;
use tracing::{debug, warn};
use uuid::Uuid;
use woofx3_cloudevents::messages_gen::{
    EventSpecVersion, HeartbeatData, HeartbeatEvent, HeartbeatEventSubject, HeartbeatEventType,
};
use woofx3_runtime::heartbeat::Readiness;

/// How often to publish. Matches the runtime's default heartbeat interval on
/// the Go and TypeScript sides, so a dependent's staleness window is the same
/// whichever language the service it waits on is written in.
const INTERVAL: Duration = Duration::from_secs(5);

/// Start publishing heartbeats until the process exits.
///
/// Publishing begins immediately and before readiness is set, so a dependent
/// that connects during reconciliation sees an explicit `ready: false` rather
/// than silence it would have to time out on.
pub fn spawn(
    client: Client,
    app_name: &'static str,
    readiness: Readiness,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(INTERVAL);
        loop {
            ticker.tick().await;
            publish_once(&client, app_name, &readiness).await;
        }
    })
}

/// The heartbeat message for `app_name`, built from the generated contract
/// types so a value outside the contract cannot be constructed.
fn heartbeat_event(app_name: &str, ready: bool, time: &str) -> Result<HeartbeatEvent, String> {
    let application = app_name.parse().map_err(|e| format!("application: {e}"))?;
    Ok(HeartbeatEvent {
        specversion: EventSpecVersion::X100,
        id: Uuid::new_v4()
            .to_string()
            .parse()
            .map_err(|e| format!("id: {e}"))?,
        type_: HeartbeatEventType::ComWoofx3Heartbeat,
        source: app_name.parse().map_err(|e| format!("source: {e}"))?,
        subject: HeartbeatEventSubject::Heartbeat,
        time: time.parse().map_err(|e| format!("time: {e}"))?,
        traceparent: None,
        tracestate: None,
        data: HeartbeatData { application, ready },
    })
}

async fn publish_once(client: &Client, app_name: &str, readiness: &Readiness) {
    let ready = readiness.is_ready();
    let event = match heartbeat_event(app_name, ready, &chrono::Utc::now().to_rfc3339()) {
        Ok(event) => event,
        Err(e) => {
            warn!("heartbeat does not fit its contract: {e}");
            return;
        }
    };
    let payload = match serde_json::to_vec(&event) {
        Ok(bytes) => bytes,
        Err(e) => {
            warn!("failed to encode heartbeat: {e}");
            return;
        }
    };
    // A failed heartbeat is not fatal: NATS may be briefly unavailable, and
    // the next tick republishes. Dependents treat missing heartbeats as
    // not-ready, which is the same conclusion a `ready: false` would give.
    match client
        .publish(HeartbeatEventSubject::Heartbeat.to_string(), payload.into())
        .await
    {
        Ok(()) => debug!(ready, "published heartbeat"),
        Err(e) => warn!("heartbeat publish failed: {e}"),
    }
}

/// Held by `main` so the readiness flag has one owner and the heartbeat task
/// and the reconciler are looking at the same value.
pub struct HeartbeatHandle {
    pub readiness: Readiness,
    _task: Arc<tokio::task::JoinHandle<()>>,
}

impl HeartbeatHandle {
    pub fn new(client: Client, app_name: &'static str) -> Self {
        let readiness = Readiness::not_ready();
        let task = spawn(client, app_name, readiness.clone());
        Self {
            readiness,
            _task: Arc::new(task),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heartbeat_event_matches_the_contract() {
        let event = heartbeat_event("barkloader", false, "2026-01-01T00:00:00Z").unwrap();
        let value = serde_json::to_value(&event).unwrap();
        assert_eq!(value["type"], "com.woofx3.heartbeat");
        assert_eq!(value["subject"], "HEARTBEAT");
        assert_eq!(value["source"], "barkloader");
        assert_eq!(value["data"]["application"], "barkloader");
        assert_eq!(value["data"]["ready"], false);
    }

    #[test]
    fn test_heartbeat_event_refuses_an_empty_application() {
        assert!(heartbeat_event("", true, "2026-01-01T00:00:00Z").is_err());
    }

    #[test]
    fn test_heartbeat_event_refuses_a_time_that_is_not_rfc3339() {
        assert!(heartbeat_event("barkloader", true, "yesterday").is_err());
    }
}
