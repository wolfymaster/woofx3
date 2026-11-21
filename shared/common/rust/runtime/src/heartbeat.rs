//! Service readiness flag.
//!
//! Every service publishes a heartbeat saying whether it is ready, so
//! dependents can wait for readiness rather than infer it from a process being
//! up. The message is the generated `heartbeat_gen` contract of
//! `woofx3-cloudevents`; this crate is deliberately transport-free (config and
//! telemetry only), so it holds only the flag a publisher reads.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

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
        Self {
            ready: Arc::new(AtomicBool::new(false)),
        }
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
}
