//! Auto-emitted notification fired when a module function calls
//! `ctx.storage.set()`. Both the QuickJS and Lua runtimes invoke
//! `publish_storage_changed` from inside the storage namespace's `set`
//! binding so module authors get reactive widgets for free.
//!
//! The CloudEvent type is documented in
//! `shared/common/golang/cloudevents/subjects.go` and consumed by
//! `api/src/storage-change-emitter.ts`.

use crate::host::NatsPublisher;
use serde_json::Value;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Best-effort fire of `module.storage.<module_id>.changed`. Failures
/// are logged and swallowed: the storage write is the source of truth
/// and a missed notification must never roll back a persisted value or
/// fail the module function.
pub fn publish_storage_changed(
    nats: &Arc<dyn NatsPublisher>,
    module_id: &str,
    key: &str,
    value: &Value,
) {
    if module_id.is_empty() {
        return;
    }
    let subject = format!("module.storage.{}.changed", module_id);
    let now = current_iso8601();
    let envelope = serde_json::json!({
        "specversion": "1.0",
        "type": "module.storage.changed",
        "source": "barkloader",
        "id": uuid::Uuid::new_v4().to_string(),
        "time": now,
        "data": {
            "moduleId": module_id,
            "key": key,
            "value": value,
            "occurredAt": now,
        },
    });
    if let Err(err) = nats.publish(&subject, envelope) {
        log::warn!(
            "module.storage.changed publish failed (continuing): module={} key={} err={}",
            module_id,
            key,
            err
        );
    }
}

fn current_iso8601() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs() as i64;
    let nanos = now.subsec_nanos();
    format_iso8601(secs, nanos)
}

fn format_iso8601(secs: i64, nanos: u32) -> String {
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400) as u32;
    let (year, month, day) = days_to_ymd(days);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    let millis = nanos / 1_000_000;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hour, minute, second, millis
    )
}

// Howard Hinnant's civil_from_days. Public domain.
// https://howardhinnant.github.io/date_algorithms.html
fn days_to_ymd(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso8601_epoch_zero() {
        assert_eq!(format_iso8601(0, 0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn iso8601_known_timestamp() {
        // 2024-03-15T12:34:56.789Z = 1710506096
        assert_eq!(
            format_iso8601(1_710_506_096, 789_000_000),
            "2024-03-15T12:34:56.789Z"
        );
    }
}
