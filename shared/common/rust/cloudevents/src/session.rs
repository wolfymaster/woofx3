//! The stream session this process stamps its events with.
//!
//! Held in a process-wide static because [`crate::BaseEvent::new`] takes no
//! context argument, and stamping has to happen there: it is the one place
//! every publisher routes through, and stamping per call site is how
//! `platform` ended up present on some events and absent from the rest.
//!
//! Each publishing process keeps this current by subscribing to
//! `session.started` / `session.ended`. A process that never does emits events
//! with no session, which is why reading an unset session warns instead of
//! passing silently.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

static CURRENT_SESSION_ID: RwLock<Option<String>> = RwLock::new(None);
static WARNED_ABOUT_MISSING_SESSION: AtomicBool = AtomicBool::new(false);

/// Serialises tests that touch the statics above. Rust runs tests in parallel
/// within a binary, so without this two cases race on one process-wide value.
#[cfg(test)]
pub(crate) static TEST_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Called by a process's `session.started` subscription.
pub fn set_current_session_id(session_id: impl Into<String>) {
    let mut current = CURRENT_SESSION_ID
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *current = Some(session_id.into());
    WARNED_ABOUT_MISSING_SESSION.store(false, Ordering::SeqCst);
}

/// Forget the current session. Also re-arms the missing-session warning, which
/// makes this the reset a test wants between cases.
pub fn clear_current_session_id() {
    let mut current = CURRENT_SESSION_ID
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *current = None;
    WARNED_ABOUT_MISSING_SESSION.store(false, Ordering::SeqCst);
}

/// The session to stamp, or `None` when this process does not know one.
///
/// Warns rather than panicking. Every publish in every service reaches this,
/// and events are legitimately published before the first `session.started`
/// arrives, so treating that startup window as fatal would trade a missing
/// attribute for a dead service. The warning targets the case worth finding: a
/// process nobody ever wired up.
pub fn current_session_id() -> Option<String> {
    let current = CURRENT_SESSION_ID
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if current.is_none() && claim_missing_session_warning() {
        tracing::warn!(
            "emitting events with no stream session; is this process subscribed to session.started?"
        );
    }
    current.clone()
}

/// True exactly once per gap: the first caller to find the session unset claims
/// the warning, and later callers stay quiet until a session is set or cleared.
fn claim_missing_session_warning() -> bool {
    !WARNED_ABOUT_MISSING_SESSION.swap(true, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_session_it_was_given() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        clear_current_session_id();

        set_current_session_id("session-1");

        assert_eq!(current_session_id().as_deref(), Some("session-1"));
    }

    #[test]
    fn reports_none_before_a_session_is_known() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        clear_current_session_id();

        assert_eq!(current_session_id(), None);
    }

    #[test]
    fn clearing_forgets_the_session() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        set_current_session_id("session-1");

        clear_current_session_id();

        assert_eq!(current_session_id(), None);
    }

    #[test]
    fn a_later_session_replaces_an_earlier_one() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        set_current_session_id("session-1");

        set_current_session_id("session-2");

        assert_eq!(current_session_id().as_deref(), Some("session-2"));
    }

    #[test]
    fn the_warning_is_claimed_once_per_gap() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        clear_current_session_id();

        assert!(claim_missing_session_warning(), "first caller warns");
        assert!(!claim_missing_session_warning(), "later callers stay quiet");
    }

    #[test]
    fn a_new_session_re_arms_the_warning_so_a_second_gap_is_not_masked() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        clear_current_session_id();
        assert!(claim_missing_session_warning());

        set_current_session_id("session-1");

        assert!(claim_missing_session_warning(), "the next gap warns again");
    }
}
