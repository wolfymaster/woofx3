//! Bounds on a module upload: how large the archive may be, and how much it
//! may inflate to. Every limit is checked against bytes actually read, never
//! against sizes the archive declares about itself.

use anyhow::{Result, bail};

const MIB: u64 = 1024 * 1024;

/// Matches sceneManager's `MAX_UPLOAD_BYTES`, the larger of the two upload
/// ceilings in the engine (the api has none), so an archive the scene
/// manager accepts is not refused here.
pub const DEFAULT_MAX_ARCHIVE_BYTES: u64 = 512 * MIB;
pub const DEFAULT_MAX_ENTRIES: u64 = 10_000;
/// Aligned with the 500 MiB module-storage entitlement: an archive that
/// inflates past what a module may occupy could never be stored.
pub const DEFAULT_MAX_UNCOMPRESSED_BYTES: u64 = 500 * MIB;
pub const DEFAULT_MAX_ENTRY_BYTES: u64 = 100 * MIB;
pub const DEFAULT_MAX_RATIO: u64 = 100;

const ENV_MAX_ARCHIVE_BYTES: &str = "WOOFX3_UPLOAD_MAX_ARCHIVE_BYTES";
const ENV_MAX_ENTRIES: &str = "WOOFX3_UPLOAD_MAX_ENTRIES";
const ENV_MAX_UNCOMPRESSED_BYTES: &str = "WOOFX3_UPLOAD_MAX_UNCOMPRESSED_BYTES";
const ENV_MAX_ENTRY_BYTES: &str = "WOOFX3_UPLOAD_MAX_ENTRY_BYTES";
const ENV_MAX_RATIO: &str = "WOOFX3_UPLOAD_MAX_RATIO";

/// Archives that inflate to less than this are never refused for their
/// compression ratio: a tiny archive of repetitive text is legitimate and
/// harmless, and the absolute limits still apply.
pub const RATIO_FLOOR_BYTES: u64 = MIB;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadLimits {
    pub max_archive_bytes: u64,
    pub max_entries: u64,
    pub max_uncompressed_bytes: u64,
    pub max_entry_bytes: u64,
    /// Inflated bytes allowed per archive byte, above `RATIO_FLOOR_BYTES`.
    pub max_ratio: u64,
}

impl Default for UploadLimits {
    fn default() -> Self {
        Self {
            max_archive_bytes: DEFAULT_MAX_ARCHIVE_BYTES,
            max_entries: DEFAULT_MAX_ENTRIES,
            max_uncompressed_bytes: DEFAULT_MAX_UNCOMPRESSED_BYTES,
            max_entry_bytes: DEFAULT_MAX_ENTRY_BYTES,
            max_ratio: DEFAULT_MAX_RATIO,
        }
    }
}

impl UploadLimits {
    /// Reads the `WOOFX3_UPLOAD_MAX_*` variables. Unset or blank keeps the
    /// default; anything that is not a positive integer is a startup error.
    pub fn from_env() -> Result<Self> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self> {
        let defaults = Self::default();
        let limits = Self {
            max_archive_bytes: read(&lookup, ENV_MAX_ARCHIVE_BYTES, defaults.max_archive_bytes)?,
            max_entries: read(&lookup, ENV_MAX_ENTRIES, defaults.max_entries)?,
            max_uncompressed_bytes: read(
                &lookup,
                ENV_MAX_UNCOMPRESSED_BYTES,
                defaults.max_uncompressed_bytes,
            )?,
            max_entry_bytes: read(&lookup, ENV_MAX_ENTRY_BYTES, defaults.max_entry_bytes)?,
            max_ratio: read(&lookup, ENV_MAX_RATIO, defaults.max_ratio)?,
        };
        if limits.max_entry_bytes > limits.max_uncompressed_bytes {
            bail!(
                "{ENV_MAX_ENTRY_BYTES} ({}) may not exceed {ENV_MAX_UNCOMPRESSED_BYTES} ({})",
                limits.max_entry_bytes,
                limits.max_uncompressed_bytes
            );
        }
        Ok(limits)
    }
}

fn read(lookup: &impl Fn(&str) -> Option<String>, name: &str, default: u64) -> Result<u64> {
    let Some(raw) = lookup(name).filter(|v| !v.trim().is_empty()) else {
        return Ok(default);
    };
    match raw.trim().parse::<u64>() {
        Ok(value) if value > 0 => Ok(value),
        _ => bail!("{name} must be a positive integer, not {raw:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn limits_from(pairs: &[(&str, &str)]) -> Result<UploadLimits> {
        let env: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        UploadLimits::from_lookup(|name| env.get(name).cloned())
    }

    #[test]
    fn unset_or_blank_keeps_the_defaults() {
        assert_eq!(limits_from(&[]).unwrap(), UploadLimits::default());
        assert_eq!(
            limits_from(&[(ENV_MAX_ENTRIES, "  ")]).unwrap(),
            UploadLimits::default()
        );
    }

    #[test]
    fn a_set_variable_overrides_its_default() {
        let limits = limits_from(&[(ENV_MAX_ENTRIES, "12"), (ENV_MAX_RATIO, " 7 ")]).unwrap();
        assert_eq!(limits.max_entries, 12);
        assert_eq!(limits.max_ratio, 7);
        assert_eq!(limits.max_archive_bytes, DEFAULT_MAX_ARCHIVE_BYTES);
    }

    #[test]
    fn garbage_zero_and_negative_values_are_refused() {
        for bad in ["lots", "0", "-1", "1.5", "10MB"] {
            assert!(limits_from(&[(ENV_MAX_ENTRIES, bad)]).is_err(), "{bad}");
        }
    }

    #[test]
    fn an_entry_ceiling_above_the_total_ceiling_is_refused() {
        assert!(
            limits_from(&[
                (ENV_MAX_ENTRY_BYTES, "600000000"),
                (ENV_MAX_UNCOMPRESSED_BYTES, "500000000")
            ])
            .is_err()
        );
    }
}
