//! The in-flight limit shared by extensions whose calls wait on a reply.
//!
//! A waiting call holds one of the sandbox runtime's blocking threads, so an
//! extension bounds how many of its requests may wait at once. Each extension
//! owns one `InFlight`, and the engine builds one of each extension per
//! process (barkloader/app/src/main.rs), so the limit bounds the whole process.

use std::sync::{Condvar, Mutex};
use std::time::Duration;

/// A counting semaphore for blocking threads.
pub(crate) struct InFlight {
    count: Mutex<usize>,
    released: Condvar,
    max: usize,
}

/// One taken slot, returned when dropped.
pub(crate) struct InFlightSlot<'a>(&'a InFlight);

impl InFlight {
    pub(crate) fn new(max: usize) -> Self {
        assert!(
            max > 0,
            "the in-flight limit must allow at least one request"
        );
        Self {
            count: Mutex::new(0),
            released: Condvar::new(),
            max,
        }
    }

    /// Waits up to `wait` for a free slot, or returns `None`.
    pub(crate) fn acquire(&self, wait: Duration) -> Option<InFlightSlot<'_>> {
        let count = self.count.lock().expect("in-flight mutex poisoned");
        let (mut count, _) = self
            .released
            .wait_timeout_while(count, wait, |count| *count >= self.max)
            .expect("in-flight mutex poisoned");
        if *count >= self.max {
            return None;
        }
        *count += 1;
        Some(InFlightSlot(self))
    }
}

impl Drop for InFlightSlot<'_> {
    fn drop(&mut self) {
        let mut count = self.0.count.lock().expect("in-flight mutex poisoned");
        assert!(
            *count > 0,
            "released an in-flight slot that was never taken"
        );
        *count -= 1;
        self.0.released.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slot_is_refused_while_all_are_taken_and_returned_on_drop() {
        let in_flight = InFlight::new(1);
        let held = in_flight.acquire(Duration::ZERO).expect("a free slot");
        assert!(in_flight.acquire(Duration::from_millis(10)).is_none());
        drop(held);
        assert!(in_flight.acquire(Duration::ZERO).is_some());
    }
}
