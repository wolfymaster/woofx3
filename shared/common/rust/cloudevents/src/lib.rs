//! CloudEvents envelopes for Rust publishers.
//!
//! The Rust half of `shared/common/typescript/cloudevents`. Both build the
//! same envelope for the same bus, so the two must agree on attribute names,
//! casing and `specversion`.
//!
//! Everything that publishes routes through [`BaseEvent::new`] rather than
//! hand-building a `serde_json::json!` literal. That is the whole point of the
//! crate: an attribute added here reaches every event at once, instead of
//! reaching only the call sites someone remembered to edit.

mod base_event;
mod time;

pub mod session;

pub use base_event::{BaseEvent, SPEC_VERSION};
pub use time::{format_iso8601, now_iso8601};
