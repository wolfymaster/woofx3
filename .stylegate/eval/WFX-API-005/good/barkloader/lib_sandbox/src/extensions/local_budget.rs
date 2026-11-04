//! How long a `ctx.local` request may be served for.

use crate::contracts::companion_gateway::{MAX_BUDGET_MS, MIN_BUDGET_MS};
use std::time::Duration;

/// The longest a request may be served for.
pub const MAX_BUDGET: Duration = Duration::from_millis(MAX_BUDGET_MS as u64);

/// The shortest budget a request may carry.
pub const MIN_BUDGET: Duration = Duration::from_millis(MIN_BUDGET_MS as u64);

// The budgets above read the contract's bounds as unsigned milliseconds.
const _: () = assert!(0 < MIN_BUDGET_MS && MIN_BUDGET_MS <= MAX_BUDGET_MS);

/// How long barkloader itself waits for the gateway's answer: one second
/// past the longest budget, so the gateway always answers first.
pub const REQUEST_TIMEOUT: Duration = Duration::from_millis(MAX_BUDGET_MS as u64 + 1_000);

pub fn request_budget(requested: Option<Duration>, remaining: Duration) -> Option<Duration> {
    let budget = requested.unwrap_or(MAX_BUDGET).clamp(MIN_BUDGET, MAX_BUDGET).min(remaining);
    if budget < MIN_BUDGET {
        return None;
    }
    Some(budget)
}
