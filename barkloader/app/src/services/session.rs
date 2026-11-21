//! Keeps this process's CloudEvent stamping current from the bus.
//!
//! barkloader publishes `module.storage.changed` through
//! `BaseEvent::new`, which stamps whatever session this holder knows. Without
//! this subscription those events go out with no session, and the only sign is
//! a one-time warning.

use async_nats::Client;
use futures::stream::StreamExt;
use jsonschema::Validator;
use serde_json::{Value, json};
use tracing::{error, info, warn};
use woofx3_cloudevents::session::set_current_session_id;
use woofx3_cloudevents::session_gen::{DOCUMENT, SessionStartedEvent, SessionStartedEventType};

const SCHEMA: &str = "SessionStartedEvent";

/// The subject the contract fixes as the message's `type`.
fn subject() -> String {
    SessionStartedEventType::SessionStarted.to_string()
}

/// A validator for the `session.started` schema of the embedded contract document.
fn session_started_validator() -> Result<Validator, String> {
    let document: Value = serde_json::from_str(DOCUMENT).map_err(|e| e.to_string())?;
    let root = json!({
        "$ref": format!("#/components/schemas/{SCHEMA}"),
        "components": document["components"],
    });
    jsonschema::validator_for(&root).map_err(|e| e.to_string())
}

/// Check a received payload against the contract, then read it as the generated type.
fn parse_session_started(
    validator: &Validator,
    payload: &[u8],
) -> Result<SessionStartedEvent, String> {
    let value: Value = serde_json::from_slice(payload).map_err(|e| e.to_string())?;
    validator.validate(&value).map_err(|e| e.to_string())?;
    serde_json::from_value(value).map_err(|e| e.to_string())
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
    let subject = subject();
    let validator = match session_started_validator() {
        Ok(v) => v,
        Err(e) => {
            error!("session: cannot build the {} validator: {}", subject, e);
            return;
        }
    };
    let mut subscriber = match client.subscribe(subject.clone()).await {
        Ok(s) => s,
        Err(e) => {
            error!("session: failed to subscribe to {}: {}", subject, e);
            return;
        }
    };

    info!("session: subscribed to {}", subject);

    while let Some(msg) = subscriber.next().await {
        match parse_session_started(&validator, &msg.payload) {
            Ok(event) => {
                let session_id = event.data.session_id.to_string();
                info!("session: stamping events with session {}", session_id);
                set_current_session_id(session_id);
            }
            Err(e) => {
                warn!(
                    "session: refused a {} message, keeping the previous session: {}",
                    subject, e
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(data: Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "specversion": "1.0.0",
            "id": "7c3f0f55-0c4b-4a37-a2a5-2d1f1c8b9e10",
            "type": "session.started",
            "source": "api",
            "time": "2026-11-19T10:15:30.123Z",
            "data": data,
        }))
        .unwrap()
    }

    #[test]
    fn test_parse_session_started_reads_the_session_id() {
        let validator = session_started_validator().unwrap();
        let payload =
            message(json!({ "sessionId": "ses_01", "startedAt": "2026-11-19T10:15:30Z" }));
        let event = parse_session_started(&validator, &payload).unwrap();
        assert_eq!(event.data.session_id.to_string(), "ses_01");
    }

    #[test]
    fn test_parse_session_started_refuses_what_does_not_fit() {
        let validator = session_started_validator().unwrap();
        let cases = [
            message(json!({ "startedAt": "2026-11-19T10:15:30Z" })),
            message(json!({ "sessionId": "", "startedAt": "2026-11-19T10:15:30Z" })),
            message(json!({ "sessionId": "ses_01" })),
            b"not json".to_vec(),
        ];
        for payload in cases {
            assert!(parse_session_started(&validator, &payload).is_err());
        }
    }
}
