//! Service readiness heartbeat.
//!
//! Every Go and TypeScript service publishes `{application, ready}` on the
//! `HEARTBEAT` subject so dependents can wait for readiness rather than infer
//! it from a process being up. This is the Rust half of that protocol.
//!
//! The event shape lives here and the publishing does not: this crate is
//! deliberately transport-free (config and telemetry only), so a caller hands
//! the encoded event to whichever NATS client it already holds. Keeping the
//! shape in one place is what stops the Rust encoding drifting from the Go
//! `NewHeartbeatEvent` that consumers parse.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// CloudEvent `type` for a heartbeat. Must match
/// `cloudevents.HeartbeatType` in the Go client, which is what subscribers
/// match on.
pub const HEARTBEAT_TYPE: &str = "com.woofx3.heartbeat";

/// NATS subject heartbeats are published on. Matches
/// `cloudevents.HeartbeatSubject`.
pub const HEARTBEAT_SUBJECT: &str = "HEARTBEAT";

/// Whether this service is ready to be depended on.
///
/// Separate from "the process is running": a service can be accepting
/// connections while still doing work a dependent needs finished. Barkloader
/// is exactly that case — it serves HTTP immediately but its bundled modules
/// are not installed until the boot reconciler completes, and until then
/// `woofx3:action:alert` does not resolve for anyone.
///
/// Cheap to clone; every clone observes the same flag.
#[derive(Clone, Debug)]
pub struct Readiness {
    ready: Arc<AtomicBool>,
}

impl Readiness {
    /// Starts not-ready. A service that never calls `mark_ready` reports
    /// not-ready forever, which is the safe direction: dependents wait rather
    /// than proceeding against a service that never finished starting.
    pub fn not_ready() -> Self {
        Self { ready: Arc::new(AtomicBool::new(false)) }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }

    pub fn mark_ready(&self) {
        self.ready.store(true, Ordering::SeqCst);
    }
}

impl Default for Readiness {
    fn default() -> Self {
        Self::not_ready()
    }
}

/// Build the heartbeat CloudEvent for `app_name`.
///
/// `time` is passed in rather than read from a clock so this crate stays
/// dependency-free and the encoding is testable without one.
pub fn heartbeat_event(app_name: &str, ready: bool, time: &str) -> serde_json::Value {
    serde_json::json!({
        "specversion": "1.0",
        "type": HEARTBEAT_TYPE,
        "source": app_name,
        "subject": HEARTBEAT_SUBJECT,
        "time": time,
        "data": { "application": app_name, "ready": ready },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_starts_not_ready() {
        assert!(!Readiness::not_ready().is_ready());
    }

    #[test]
    fn marking_ready_is_visible_through_every_clone() {
        let a = Readiness::not_ready();
        let b = a.clone();
        assert!(!b.is_ready());
        a.mark_ready();
        assert!(b.is_ready(), "clones must observe the same flag");
    }

    /// Subscribers key on `data.application` and `data.ready`, and match the
    /// event by `type`. A drift in any of the three is a heartbeat nobody
    /// counts, which looks exactly like a service that never started.
    #[test]
    fn event_matches_the_shape_consumers_parse() {
        let e = heartbeat_event("barkloader", false, "2026-01-01T00:00:00Z");
        assert_eq!(e["specversion"], "1.0");
        assert_eq!(e["type"], "com.woofx3.heartbeat");
        assert_eq!(e["source"], "barkloader");
        assert_eq!(e["subject"], "HEARTBEAT");
        assert_eq!(e["time"], "2026-01-01T00:00:00Z");
        assert_eq!(e["data"]["application"], "barkloader");
        assert_eq!(e["data"]["ready"], false);
    }

    #[test]
    fn ready_is_carried_through() {
        let e = heartbeat_event("barkloader", true, "2026-01-01T00:00:00Z");
        assert_eq!(e["data"]["ready"], true);
    }
}
