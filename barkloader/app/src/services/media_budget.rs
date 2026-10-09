//! How much the media proxy relays of one upstream file in a window of time.
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
//! cannot be repeated without bound either. The check is made before a fetch
//! starts, so a request admitted with budget left may overrun it by up to one
//! file.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The window a budget is counted over; it starts at a URL's first request.
pub const BUDGET_WINDOW: Duration = Duration::from_secs(15 * 60);

/// Bytes one upstream URL may relay in a window: four times the largest file
/// relayed, about 18 Mbit/s sustained. Enough for several overlays to load a
/// large file, and for a looping video the browser does not keep cached.
pub const BUDGET_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Charged for every request admitted, whatever it relays.
pub const REQUEST_COST_BYTES: u64 = 256 * 1024;

/// Upstream URLs tracked at once. Tokens name only URLs the engine signed,
/// so a scene's media stays far below this; past it, an unseen URL is
/// refused until a window ends, rather than evicting another URL's count.
pub const MAX_TRACKED_URLS: usize = 4096;

#[derive(Debug, Clone, Copy)]
struct Spent {
    since: Instant,
    bytes: u64,
}

pub struct MediaBudget {
    window: Duration,
    bytes_per_window: u64,
    max_urls: usize,
    spent: Mutex<HashMap<String, Spent>>,
}

impl Default for MediaBudget {
    fn default() -> Self {
        Self::new(BUDGET_WINDOW, BUDGET_BYTES, MAX_TRACKED_URLS)
    }
}

impl MediaBudget {
    pub fn new(window: Duration, bytes_per_window: u64, max_urls: usize) -> Self {
        assert!(!window.is_zero(), "a media budget window must not be empty");
        assert!(
            bytes_per_window > REQUEST_COST_BYTES,
            "a media budget must cover at least one request"
        );
        assert!(max_urls > 0, "a media budget must track at least one URL");
        Self {
            window,
            bytes_per_window,
            max_urls,
            spent: Mutex::new(HashMap::new()),
        }
    }

    /// Whether a request for `url` may be fetched at `now`; when it may, it is
    /// charged `REQUEST_COST_BYTES`.
    pub fn admit(&self, url: &str, now: Instant) -> bool {
        let mut spent = self.spent.lock().expect("media budget lock poisoned");
        if !spent.contains_key(url) && spent.len() >= self.max_urls {
            spent.retain(|_, entry| now.duration_since(entry.since) < self.window);
            if spent.len() >= self.max_urls {
                return false;
            }
        }
        let entry = spent.entry(url.to_string()).or_insert(Spent {
            since: now,
            bytes: 0,
        });
        if now.duration_since(entry.since) >= self.window {
            *entry = Spent {
                since: now,
                bytes: 0,
            };
        }
        if entry.bytes >= self.bytes_per_window {
            return false;
        }
        entry.bytes = entry.bytes.saturating_add(REQUEST_COST_BYTES);
        true
    }

    /// Count `bytes` relayed for `url` at `now` against its window.
    pub fn charge(&self, url: &str, bytes: u64, now: Instant) {
        let mut spent = self.spent.lock().expect("media budget lock poisoned");
        if let Some(entry) = spent.get_mut(url) {
            if now.duration_since(entry.since) >= self.window {
                *entry = Spent {
                    since: now,
                    bytes: 0,
                };
            }
            entry.bytes = entry.bytes.saturating_add(bytes);
        }
    }

    /// How long until `url` has budget again, for a `Retry-After`.
    pub fn retry_after(&self, url: &str, now: Instant) -> Duration {
        let spent = self.spent.lock().expect("media budget lock poisoned");
        spent
            .get(url)
            .map(|entry| self.window.saturating_sub(now.duration_since(entry.since)))
            .unwrap_or(self.window)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIB: u64 = 1024 * 1024;

    #[test]
    fn admits_until_the_bytes_relayed_reach_the_budget() {
        let budget = MediaBudget::new(Duration::from_secs(60), 10 * MIB, 8);
        let start = Instant::now();
        assert!(budget.admit("https://a.example/v.mp4", start));
        budget.charge("https://a.example/v.mp4", 6 * MIB, start);
        assert!(budget.admit("https://a.example/v.mp4", start));
        budget.charge("https://a.example/v.mp4", 4 * MIB, start);
        assert!(!budget.admit("https://a.example/v.mp4", start));
        // Another file has its own budget.
        assert!(budget.admit("https://a.example/w.mp4", start));
    }

    #[test]
    fn many_small_ranges_cost_what_they_carry() {
        let budget = MediaBudget::new(Duration::from_secs(60), 64 * MIB, 8);
        let now = Instant::now();
        for _ in 0..100 {
            assert!(budget.admit("https://a.example/loop.webm", now));
            budget.charge("https://a.example/loop.webm", 64 * 1024, now);
        }
    }

    #[test]
    fn requests_that_relay_nothing_still_run_out() {
        let budget = MediaBudget::new(Duration::from_secs(60), 4 * REQUEST_COST_BYTES, 8);
        let now = Instant::now();
        let admitted = (0..10)
            .filter(|_| budget.admit("https://a.example/page", now))
            .count();
        assert_eq!(admitted, 4);
    }

    #[test]
    fn a_new_window_restores_the_budget() {
        let window = Duration::from_secs(60);
        let budget = MediaBudget::new(window, 10 * MIB, 8);
        let start = Instant::now();
        assert!(budget.admit("https://a.example/v.mp4", start));
        budget.charge("https://a.example/v.mp4", 20 * MIB, start);
        assert!(!budget.admit("https://a.example/v.mp4", start + Duration::from_secs(59)));
        assert_eq!(
            budget.retry_after("https://a.example/v.mp4", start + Duration::from_secs(59)),
            Duration::from_secs(1)
        );
        assert!(budget.admit("https://a.example/v.mp4", start + window));
    }

    #[test]
    fn tracks_a_bounded_number_of_urls() {
        let window = Duration::from_secs(60);
        let budget = MediaBudget::new(window, 10 * MIB, 2);
        let start = Instant::now();
        assert!(budget.admit("https://a.example/1", start));
        assert!(budget.admit("https://a.example/2", start));
        assert!(!budget.admit("https://a.example/3", start));
        // A URL already tracked keeps going.
        assert!(budget.admit("https://a.example/1", start));
        // Once a window ends its URL is let go, making room.
        assert!(budget.admit("https://a.example/3", start + window));
    }
}
