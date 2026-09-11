//! Cron expression normalisation shared by manifest validation and the
//! background scheduler.
//!
//! The `cron` crate requires six or seven fields — seconds first, optional
//! year last. Nearly every cron reference, and therefore nearly every module
//! author, writes the five-field POSIX form. Accepting only six fields means
//! `*/30 * * * *` is rejected as invalid when it is the single most obvious
//! thing to write.

/// Expand a five-field POSIX cron expression to the six-field form the `cron`
/// crate parses, by prepending a seconds field of `0`.
///
/// Six- and seven-field expressions pass through untouched, so an author who
/// wants sub-minute precision keeps it. Anything else is returned unchanged
/// and left for the parser to reject with its own message.
pub fn normalize_cron(expression: &str) -> String {
    let trimmed = expression.trim();
    if trimmed.split_whitespace().count() == 5 {
        return format!("0 {trimmed}");
    }
    trimmed.to_string()
}

/// Whether `expression` is a cron schedule the engine can run.
///
/// Checked when a manifest is validated rather than only when the scheduler
/// loads it: the expression is known at parse time, and a bad one that only
/// surfaces as a log line during registry load gives the author a successful
/// install and a task that never fires.
pub fn is_valid_cron(expression: &str) -> bool {
    use std::str::FromStr;
    cron::Schedule::from_str(&normalize_cron(expression)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn five_field_expressions_gain_a_seconds_field() {
        assert_eq!(normalize_cron("*/30 * * * *"), "0 */30 * * * *");
        assert_eq!(normalize_cron("0 3 * * *"), "0 0 3 * * *");
    }

    #[test]
    fn six_and_seven_field_expressions_are_untouched() {
        assert_eq!(normalize_cron("0 */30 * * * *"), "0 */30 * * * *");
        assert_eq!(normalize_cron("0 0 3 * * * 2030"), "0 0 3 * * * 2030");
    }

    #[test]
    fn surrounding_whitespace_does_not_change_the_field_count() {
        assert_eq!(normalize_cron("  */30 * * * *  "), "0 */30 * * * *");
    }

    /// The expression from the issue: the most obvious thing an author writes.
    #[test]
    fn the_standard_five_field_form_is_accepted() {
        assert!(
            is_valid_cron("*/30 * * * *"),
            "every 30 minutes must be valid"
        );
        assert!(is_valid_cron("0 3 * * *"), "daily at 03:00 must be valid");
        assert!(is_valid_cron("*/5 * * * *"));
    }

    #[test]
    fn six_field_expressions_still_work() {
        assert!(is_valid_cron("0 */30 * * * *"));
    }

    #[test]
    fn nonsense_is_still_rejected() {
        assert!(!is_valid_cron("not a cron"));
        assert!(!is_valid_cron(""));
        assert!(!is_valid_cron("* * *"));
        assert!(!is_valid_cron("99 * * * *"), "minute 99 does not exist");
    }
}
