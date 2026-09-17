//! Keeps this process's CloudEvent stamping current from the bus.
//!
//! barkloader publishes `module.storage.changed` and `message.send` through
//! `BaseEvent::new`, which stamps whatever session this holder knows. Without
//! this subscription those events go out with no session, and the only sign is
//! a one-time warning.

use async_nats::Client;
use futures::stream::StreamExt;
use serde::Deserialize;
use tracing::{error, info, warn};
use woofx3_cloudevents::session::set_current_session_id;

const SUBJECT: &str = "session.started";

#[derive(Deserialize)]
struct SessionStartedEnvelope {
    data: SessionStartedData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionStartedData {
    session_id: String,
}

/// Subscribe to `session.started` and stamp subsequent events with it.
///
/// Only `session.started`. `session.ended` means a finished session's state
/// should be dropped, not that this process should forget what to stamp: the
/// resolver emits `ended` immediately followed by `started` for the successor,
/// so clearing here would publish unstamped events in between. A session is
/// always present, so the holder should never empty once filled.
///
/// The resolver re-announces the current session on startup, so a barkloader
/// that came up later still learns it without waiting for the next broadcast.
pub async fn run_session_subscriber(client: Client) {
    let mut subscriber = match client.subscribe(SUBJECT).await {
        Ok(s) => s,
        Err(e) => {
            error!("session: failed to subscribe to {}: {}", SUBJECT, e);
            return;
        }
    };

    info!("session: subscribed to {}", SUBJECT);

    while let Some(msg) = subscriber.next().await {
        match serde_json::from_slice::<SessionStartedEnvelope>(&msg.payload) {
            Ok(envelope) if !envelope.data.session_id.is_empty() => {
                info!(
                    "session: stamping events with session {}",
                    envelope.data.session_id
                );
                set_current_session_id(envelope.data.session_id);
            }
            Ok(_) => {
                warn!(
                    "session: {} carried no sessionId; keeping the previous session",
                    SUBJECT
                );
            }
            Err(e) => {
                warn!("session: failed to parse {} payload: {}", SUBJECT, e);
            }
        }
    }
}
