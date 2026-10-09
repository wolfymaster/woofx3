//! How much the media proxy relays of one upstream file in a window of time,
//! and how many relays run at once.
//!
//! A media proxy token (see `services::media_proxy`) is a bearer credential:
//! anyone holding one can have the engine fetch that file, up to
//! `MAX_MEDIA_BYTES` a request, until it expires. Without a limit, one leaked
//! token is a way to make the engine pull gigabytes from the upstream host on
//! a loop. The budget is per upstream URL rather than per token, so the fresh
//! tokens overlays receive for the same file share it.
//!
//! It is counted in bytes relayed, not requests, so the many small `Range`
//! requests a video element makes while it seeks and loops cost what they
//! carry. Each request is also charged `REQUEST_COST_BYTES`, so requests that
//! relay nothing (an upstream answering with something other than media)
//! cannot be repeated without bound either.
//!
//! A relay goes through three steps, each of which can refuse it:
//!
//! - `admit`, before the upstream is asked: the URL must have budget left,
//!   and fewer than `MAX_STREAMS_PER_URL` relays of it and `MAX_STREAMS` in
//!   all may be running. Concurrent requests are what would otherwise all be
//!   admitted before any of them had relayed a byte.
//! - `RelayStream::reserve`, once the upstream's headers have arrived: the
//!   response's declared length, or `UNKNOWN_LENGTH_RESERVATION`, is charged
//!   up front, so a relay that is about to start counts against the relays
//!   admitted alongside it.
//! - `RelayStream::relayed`, for every chunk: bytes past the reservation are
//!   charged as they arrive, and the relay is ended once they exhaust the
//!   window's budget. When the relay ends, what it reserved and did not
//!   relay is given back.
//!
//! So a URL overruns its budget by at most the reservations of the relays
//! running when it runs out. Admission and lookup take the table's lock; the
//! per-chunk accounting touches only the URL's own atomic counters.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The window a budget is counted over; it starts at a URL's first request.
pub const BUDGET_WINDOW: Duration = Duration::from_secs(15 * 60);

/// Bytes one upstream URL may relay in a window: four times the largest file
/// relayed, about 18 Mbit/s sustained. Enough for several overlays to load a
/// large file, and for a looping video the browser does not keep cached.
pub const BUDGET_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Charged for every request admitted, whatever it relays.
pub const REQUEST_COST_BYTES: u64 = 256 * 1024;

/// Reserved for a response that declares no length; what it relays past this
/// is charged as it streams.
pub const UNKNOWN_LENGTH_RESERVATION: u64 = 8 * 1024 * 1024;

/// Relays of one upstream URL running at once. A media element keeps one or
/// two range requests open, so this covers a few overlays showing the file.
pub const MAX_STREAMS_PER_URL: usize = 4;

/// Relays running at once across every URL.
pub const MAX_STREAMS: usize = 64;

/// Upstream URLs tracked at once. Tokens name only URLs the engine signed,
/// so a scene's media stays far below this. Past it, a URL whose window has
/// ended and that has no relay running is let go to make room; when none can
/// be, an unseen URL is refused rather than another URL's count dropped.
pub const MAX_TRACKED_URLS: usize = 4096;

/// How long a refusal for too many running relays asks the client to wait.
const BUSY_RETRY_AFTER: Duration = Duration::from_secs(1);

/// The limits a `MediaBudget` enforces.
#[derive(Debug, Clone, Copy)]
pub struct BudgetLimits {
    pub window: Duration,
    pub bytes_per_window: u64,
    pub max_urls: usize,
    pub max_streams_per_url: usize,
    pub max_streams: usize,
    pub unknown_length_reservation: u64,
}

impl Default for BudgetLimits {
    fn default() -> Self {
        Self {
            window: BUDGET_WINDOW,
            bytes_per_window: BUDGET_BYTES,
            max_urls: MAX_TRACKED_URLS,
            max_streams_per_url: MAX_STREAMS_PER_URL,
            max_streams: MAX_STREAMS,
            unknown_length_reservation: UNKNOWN_LENGTH_RESERVATION,
        }
    }
}

/// Why a relay was refused; every refusal is answered 429 with a `Retry-After`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The URL has used its budget for this window.
    Exhausted { retry_after: Duration },
    /// Too many relays of this URL, or in all, are running.
    Busy { retry_after: Duration },
    /// Every tracked URL is in its window or has a relay running.
    Full { retry_after: Duration },
}

impl Refusal {
    pub fn retry_after(&self) -> Duration {
        match *self {
            Refusal::Exhausted { retry_after }
            | Refusal::Busy { retry_after }
            | Refusal::Full { retry_after } => retry_after,
        }
    }
}

/// One URL's counters, shared by the table and every relay of it running.
#[derive(Debug, Default)]
struct UrlCounters {
    /// Bytes charged in the current window.
    bytes: AtomicU64,
    /// Relays of the URL admitted and not yet ended.
    active: AtomicUsize,
    /// Bumped when a window starts, so a relay begun in an earlier window
    /// does not give its unused reservation back to the new one.
    window: AtomicU64,
}

#[derive(Debug)]
struct Tracked {
    since: Instant,
    counters: Arc<UrlCounters>,
}

pub struct MediaBudget {
    limits: BudgetLimits,
    urls: Mutex<HashMap<String, Tracked>>,
    active: Arc<AtomicUsize>,
}

impl Default for MediaBudget {
    fn default() -> Self {
        Self::new(BudgetLimits::default())
    }
}

impl MediaBudget {
    pub fn new(limits: BudgetLimits) -> Self {
        assert!(
            !limits.window.is_zero(),
            "a media budget window must not be empty"
        );
        assert!(
            limits.bytes_per_window > REQUEST_COST_BYTES,
            "a media budget must cover at least one request"
        );
        assert!(
            limits.max_urls > 0,
            "a media budget must track at least one URL"
        );
        assert!(
            limits.max_streams_per_url > 0 && limits.max_streams > 0,
            "a media budget must let at least one relay run"
        );
        Self {
            limits,
            urls: Mutex::new(HashMap::new()),
            active: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Admit a relay of `url` at `now`, charging it `REQUEST_COST_BYTES`. The
    /// relay counts as running until the returned `RelayStream` is dropped.
    pub fn admit(&self, url: &str, now: Instant) -> Result<RelayStream, Refusal> {
        let mut urls = self.urls.lock().expect("media budget lock poisoned");
        if self.active.load(Ordering::Acquire) >= self.limits.max_streams {
            return Err(Refusal::Busy {
                retry_after: BUSY_RETRY_AFTER,
            });
        }
        if !urls.contains_key(url) && urls.len() >= self.limits.max_urls {
            let window = self.limits.window;
            urls.retain(|_, tracked| {
                now.duration_since(tracked.since) < window
                    || tracked.counters.active.load(Ordering::Acquire) > 0
            });
            if urls.len() >= self.limits.max_urls {
                let retry_after = urls
                    .values()
                    .map(|tracked| window.saturating_sub(now.duration_since(tracked.since)))
                    .min()
                    .unwrap_or(window)
                    .max(BUSY_RETRY_AFTER);
                return Err(Refusal::Full { retry_after });
            }
        }
        let tracked = urls.entry(url.to_string()).or_insert_with(|| Tracked {
            since: now,
            counters: Arc::new(UrlCounters::default()),
        });
        if now.duration_since(tracked.since) >= self.limits.window {
            tracked.since = now;
            tracked.counters.bytes.store(0, Ordering::Release);
            tracked.counters.window.fetch_add(1, Ordering::AcqRel);
        }
        let counters = &tracked.counters;
        if counters.bytes.load(Ordering::Acquire) >= self.limits.bytes_per_window {
            return Err(Refusal::Exhausted {
                retry_after: self
                    .limits
                    .window
                    .saturating_sub(now.duration_since(tracked.since)),
            });
        }
        if counters.active.load(Ordering::Acquire) >= self.limits.max_streams_per_url {
            return Err(Refusal::Busy {
                retry_after: BUSY_RETRY_AFTER,
            });
        }
        counters.active.fetch_add(1, Ordering::AcqRel);
        self.active.fetch_add(1, Ordering::AcqRel);
        counters
            .bytes
            .fetch_add(REQUEST_COST_BYTES, Ordering::AcqRel);
        Ok(RelayStream {
            counters: counters.clone(),
            total_active: self.active.clone(),
            bytes_per_window: self.limits.bytes_per_window,
            unknown_length_reservation: self.limits.unknown_length_reservation,
            window: counters.window.load(Ordering::Acquire),
            reserved: 0,
            relayed: 0,
        })
    }

    /// How long until `url` has budget again, for a `Retry-After`.
    pub fn retry_after(&self, url: &str, now: Instant) -> Duration {
        let urls = self.urls.lock().expect("media budget lock poisoned");
        urls.get(url)
            .map(|tracked| {
                self.limits
                    .window
                    .saturating_sub(now.duration_since(tracked.since))
            })
            .unwrap_or(self.limits.window)
    }

    /// Relays running across every URL.
    #[cfg(test)]
    pub fn active_streams(&self) -> usize {
        self.active.load(Ordering::Acquire)
    }
}

/// One admitted relay. Dropping it ends the relay: it stops counting as
/// running, and what it reserved and did not relay is given back.
#[derive(Debug)]
pub struct RelayStream {
    counters: Arc<UrlCounters>,
    total_active: Arc<AtomicUsize>,
    bytes_per_window: u64,
    unknown_length_reservation: u64,
    window: u64,
    reserved: u64,
    relayed: u64,
}

impl RelayStream {
    /// Charge the bytes the response is expected to carry, `None` when it
    /// declares no length. Refused when the URL's budget is already used up
    /// by relays admitted alongside this one.
    pub fn reserve(&mut self, expected: Option<u64>) -> bool {
        assert_eq!(self.reserved, 0, "a relay reserves once");
        if self.counters.bytes.load(Ordering::Acquire) >= self.bytes_per_window {
            return false;
        }
        let bytes = expected.unwrap_or(self.unknown_length_reservation);
        self.counters.bytes.fetch_add(bytes, Ordering::AcqRel);
        self.reserved = bytes;
        true
    }

    /// Count a chunk of `bytes` relayed. Whether the relay may go on: bytes
    /// past the reservation are charged, and once they exhaust the budget the
    /// relay is to be ended.
    pub fn relayed(&mut self, bytes: u64) -> bool {
        let before = self.relayed;
        self.relayed = self.relayed.saturating_add(bytes);
        let unreserved = self.relayed.saturating_sub(self.reserved.max(before));
        if unreserved == 0 {
            return true;
        }
        let spent = self
            .counters
            .bytes
            .fetch_add(unreserved, Ordering::AcqRel)
            .saturating_add(unreserved);
        spent < self.bytes_per_window
    }
}

impl Drop for RelayStream {
    fn drop(&mut self) {
        let unused = self.reserved.saturating_sub(self.relayed);
        if unused > 0 && self.counters.window.load(Ordering::Acquire) == self.window {
            let _ =
                self.counters
                    .bytes
                    .fetch_update(Ordering::AcqRel, Ordering::Acquire, |bytes| {
                        Some(bytes.saturating_sub(unused))
                    });
        }
        self.counters.active.fetch_sub(1, Ordering::AcqRel);
        self.total_active.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIB: u64 = 1024 * 1024;

    fn limits(bytes_per_window: u64, max_urls: usize) -> BudgetLimits {
        BudgetLimits {
            window: Duration::from_secs(60),
            bytes_per_window,
            max_urls,
            ..BudgetLimits::default()
        }
    }

    /// Admit, reserve and relay `bytes` in one go, as a whole relay does.
    fn relay(budget: &MediaBudget, url: &str, bytes: u64, now: Instant) -> bool {
        let Ok(mut stream) = budget.admit(url, now) else {
            return false;
        };
        stream.reserve(Some(bytes)) && stream.relayed(bytes)
    }

    #[test]
    fn admits_until_the_bytes_relayed_reach_the_budget() {
        let budget = MediaBudget::new(limits(10 * MIB, 8));
        let start = Instant::now();
        assert!(relay(&budget, "https://a.example/v.mp4", 6 * MIB, start));
        assert!(relay(&budget, "https://a.example/v.mp4", 4 * MIB, start));
        assert!(matches!(
            budget.admit("https://a.example/v.mp4", start),
            Err(Refusal::Exhausted { .. })
        ));
        // Another file has its own budget.
        assert!(budget.admit("https://a.example/w.mp4", start).is_ok());
    }

    #[test]
    fn many_small_ranges_cost_what_they_carry() {
        let budget = MediaBudget::new(limits(64 * MIB, 8));
        let now = Instant::now();
        for _ in 0..100 {
            assert!(relay(
                &budget,
                "https://a.example/loop.webm",
                64 * 1024,
                now
            ));
        }
    }

    #[test]
    fn requests_that_relay_nothing_still_run_out() {
        let budget = MediaBudget::new(limits(4 * REQUEST_COST_BYTES, 8));
        let now = Instant::now();
        let admitted = (0..10)
            .filter(|_| budget.admit("https://a.example/page", now).is_ok())
            .count();
        assert_eq!(admitted, 4);
    }

    #[test]
    fn a_new_window_restores_the_budget() {
        let window = Duration::from_secs(60);
        let budget = MediaBudget::new(limits(10 * MIB, 8));
        let start = Instant::now();
        assert!(relay(&budget, "https://a.example/v.mp4", 20 * MIB, start));
        let later = start + Duration::from_secs(59);
        assert_eq!(
            budget.admit("https://a.example/v.mp4", later).unwrap_err(),
            Refusal::Exhausted {
                retry_after: Duration::from_secs(1)
            }
        );
        assert_eq!(
            budget.retry_after("https://a.example/v.mp4", later),
            Duration::from_secs(1)
        );
        assert!(
            budget
                .admit("https://a.example/v.mp4", start + window)
                .is_ok()
        );
    }

    #[test]
    fn tracks_a_bounded_number_of_urls() {
        let window = Duration::from_secs(60);
        let budget = MediaBudget::new(limits(10 * MIB, 2));
        let start = Instant::now();
        drop(budget.admit("https://a.example/1", start).unwrap());
        drop(budget.admit("https://a.example/2", start).unwrap());
        assert!(matches!(
            budget.admit("https://a.example/3", start),
            Err(Refusal::Full { .. })
        ));
        // A URL already tracked keeps going.
        assert!(budget.admit("https://a.example/1", start).is_ok());
        // Once a window ends its URL is let go, making room.
        assert!(budget.admit("https://a.example/3", start + window).is_ok());
    }

    #[test]
    fn caps_relays_running_at_once_per_url_and_in_all() {
        let budget = MediaBudget::new(BudgetLimits {
            max_streams_per_url: 2,
            max_streams: 3,
            ..limits(100 * MIB, 8)
        });
        let now = Instant::now();
        let a1 = budget.admit("https://a.example/a", now).unwrap();
        let _a2 = budget.admit("https://a.example/a", now).unwrap();
        assert!(matches!(
            budget.admit("https://a.example/a", now),
            Err(Refusal::Busy { .. })
        ));
        let _b1 = budget.admit("https://a.example/b", now).unwrap();
        assert!(matches!(
            budget.admit("https://a.example/c", now),
            Err(Refusal::Busy { .. })
        ));
        assert_eq!(budget.active_streams(), 3);
        drop(a1);
        assert_eq!(budget.active_streams(), 2);
        assert!(budget.admit("https://a.example/a", now).is_ok());
    }

    #[test]
    fn concurrent_relays_count_against_each_other_before_any_bytes_arrive() {
        let budget = MediaBudget::new(limits(10 * MIB, 8));
        let now = Instant::now();
        let mut first = budget.admit("https://a.example/v.mp4", now).unwrap();
        let mut second = budget.admit("https://a.example/v.mp4", now).unwrap();
        assert!(first.reserve(Some(10 * MIB)));
        // The first relay's reservation used the budget up.
        assert!(!second.reserve(Some(10 * MIB)));
    }

    #[test]
    fn a_relay_past_its_reservation_is_ended_once_the_budget_runs_out() {
        let budget = MediaBudget::new(limits(10 * MIB, 8));
        let now = Instant::now();
        let mut stream = budget.admit("https://a.example/live", now).unwrap();
        assert!(stream.reserve(None));
        let mut chunks = 0;
        while stream.relayed(MIB) {
            chunks += 1;
            assert!(chunks < 100, "an unbounded relay must be ended");
        }
        assert!(chunks >= 8);
    }

    #[test]
    fn an_ended_relay_gives_back_what_it_did_not_relay() {
        let budget = MediaBudget::new(limits(10 * MIB, 8));
        let now = Instant::now();
        let mut stream = budget.admit("https://a.example/v.mp4", now).unwrap();
        assert!(stream.reserve(Some(10 * MIB)));
        assert!(budget.admit("https://a.example/v.mp4", now).is_err());
        assert!(stream.relayed(MIB));
        // The viewer went away after a mebibyte.
        drop(stream);
        assert!(relay(&budget, "https://a.example/v.mp4", 8 * MIB, now));
    }

    #[test]
    fn never_lets_go_of_a_url_with_a_relay_running() {
        let window = Duration::from_secs(60);
        let budget = MediaBudget::new(limits(10 * MIB, 1));
        let start = Instant::now();
        let mut running = budget.admit("https://a.example/long", start).unwrap();
        assert!(running.reserve(None));
        // Its window has ended, but its relay still runs: it is kept, and an
        // unseen URL is refused.
        assert!(matches!(
            budget.admit("https://a.example/other", start + window),
            Err(Refusal::Full { .. })
        ));
        // Its bytes still count against it, past the reservation.
        assert!(running.relayed(9 * MIB));
        assert!(!running.relayed(2 * MIB));
        drop(running);
        assert!(
            budget
                .admit("https://a.example/other", start + window)
                .is_ok()
        );
    }
}
