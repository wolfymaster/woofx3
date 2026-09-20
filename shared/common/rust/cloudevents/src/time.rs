//! CloudEvents `time` formatting.
//!
//! Implemented here rather than delegated to chrono because `lib_sandbox`
//! depends on this crate and deliberately carries no date/time library.

use std::time::{SystemTime, UNIX_EPOCH};

/// The current time as a CloudEvents `time` value.
pub fn now_iso8601() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format_iso8601(now.as_secs() as i64, now.subsec_nanos())
}

/// Format an epoch instant as RFC 3339 with millisecond precision.
///
/// Takes the instant rather than reading a clock so the encoding is testable
/// without one.
pub fn format_iso8601(secs: i64, nanos: u32) -> String {
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

    #[test]
    fn iso8601_leap_day() {
        // 2024-02-29T00:00:00Z = 1709164800
        assert_eq!(format_iso8601(1_709_164_800, 0), "2024-02-29T00:00:00.000Z");
    }

    #[test]
    fn now_is_formatted_like_a_cloudevents_time() {
        let now = now_iso8601();
        assert_eq!(now.len(), 24, "{now}");
        assert!(now.ends_with('Z'), "{now}");
    }
}
