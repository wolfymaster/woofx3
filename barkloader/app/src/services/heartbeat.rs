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
use woofx3_runtime::heartbeat::{heartbeat_event, Readiness, HEARTBEAT_SUBJECT};

/// How often to publish. Matches the runtime's default heartbeat interval on
/// the Go and TypeScript sides, so a dependent's staleness window is the same
/// whichever language the service it waits on is written in.
const INTERVAL: Duration = Duration::from_secs(5);

/// Start publishing heartbeats until the process exits.
///
/// Publishing begins immediately and before readiness is set, so a dependent
/// that connects during reconciliation sees an explicit `ready: false` rather
/// than silence it would have to time out on.
pub fn spawn(client: Client, app_name: &'static str, readiness: Readiness) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(INTERVAL);
        loop {
            ticker.tick().await;
            publish_once(&client, app_name, &readiness).await;
        }
    })
}

async fn publish_once(client: &Client, app_name: &str, readiness: &Readiness) {
    let ready = readiness.is_ready();
    let event = heartbeat_event(app_name, ready, &chrono::Utc::now().to_rfc3339());
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
    match client.publish(HEARTBEAT_SUBJECT, payload.into()).await {
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
        Self { readiness, _task: Arc::new(task) }
    }
}
