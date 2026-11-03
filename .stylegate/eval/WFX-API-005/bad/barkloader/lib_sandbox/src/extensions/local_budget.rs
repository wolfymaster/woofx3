//! How long a `ctx.local` request may be served for.

use std::time::Duration;

/// The longest a request may be served for: the companion gateway
/// contract's upper bound on `budgetMs`.
pub const MAX_BUDGET: Duration = Duration::from_millis(4_500);

/// The shortest budget a request may carry: the contract's lower bound.
pub const MIN_BUDGET: Duration = Duration::from_millis(100);

/// The budget a call asks for: what it set, clamped to the contract's
/// range, and never more than the invocation has left.
pub fn request_budget(requested: Option<Duration>, remaining: Duration) -> Option<Duration> {
    let budget = requested.unwrap_or(MAX_BUDGET).clamp(MIN_BUDGET, MAX_BUDGET).min(remaining);
    if budget < MIN_BUDGET {
        return None;
    }
    Some(budget)
}
