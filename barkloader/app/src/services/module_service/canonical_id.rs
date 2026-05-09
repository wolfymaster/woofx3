//! Canonical id primitives for module resources.
//!
//! A canonical id has the shape `{moduleId}:{kind}:{resourceId}` where:
//!   - `moduleId` is the manifest's top-level `id` (required, namespace-claimed)
//!   - `kind` identifies the resource type (see two flavors below)
//!   - `resourceId` is the manifest-local id (for surfaces) or the
//!     instance-local id (for runtime instances) — required either way
//!
//! Two flavors of canonical id share this format:
//!   - **Surface canonical ids** — `kind` is one of the engine-reserved
//!     [`ResourceKind`] variants (trigger / action / function / command /
//!     workflow / widget / overlay / asset). The engine knows the shape
//!     and behavior of each. Used for module-installation registrations
//!     and for cross-module references in workflow definitions.
//!   - **Instance canonical ids** — `kind` is a free-form module-declared
//!     string (e.g. `counter` declared via `manifest.resources[]`). The
//!     engine learns identity but not semantics; the owning module is
//!     the controller. Used for `resource_ref` ConfigField values and
//!     for the `module_resource_instances` ledger.
//!
//! See `docs/barkloader/modules.md` for the full contract. This module is
//! the single source of truth for the format and validation rules — any
//! code that produces or parses canonical ids should go through these
//! types.
//!
//! The documented author-facing contract is "every resource declares an
//! explicit `id`." The slug-of-name path that lives in `slug` and
//! `resolve_resource_segment` is defense-in-depth only: the install-time
//! validator rejects any resource missing or empty `id` before this code
//! path ever runs. The primitives are kept around as a safety net and as
//! a convenience for future tooling (migrations, dev affordances).

use anyhow::{anyhow, Result};
use std::fmt;

/// The reserved separator between segments of a canonical id.
pub const CANONICAL_ID_SEPARATOR: char = ':';

/// Reserved kind keywords for the second segment of a canonical id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResourceKind {
    Trigger,
    Action,
    Function,
    Command,
    Workflow,
    Widget,
    Overlay,
    Asset,
}

impl ResourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ResourceKind::Trigger => "trigger",
            ResourceKind::Action => "action",
            ResourceKind::Function => "function",
            ResourceKind::Command => "command",
            ResourceKind::Workflow => "workflow",
            ResourceKind::Widget => "widget",
            ResourceKind::Overlay => "overlay",
            ResourceKind::Asset => "asset",
        }
    }
}

impl fmt::Display for ResourceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A fully-formed canonical id. Construct via `CanonicalId::new` (which
/// validates segment shape) or via the higher-level `resolve_resource_segment`
/// + module id during manifest validation. Display renders the `:`-joined form.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CanonicalId {
    module_id: String,
    kind: ResourceKind,
    resource_id: String,
}

impl CanonicalId {
    /// Build a canonical id from validated parts. Returns an error if the
    /// `module_id` or `resource_id` segments contain disallowed characters
    /// (the separator `:`, whitespace, etc.).
    pub fn new(module_id: &str, kind: ResourceKind, resource_id: &str) -> Result<Self> {
        validate_segment(module_id, "moduleId")?;
        validate_segment(resource_id, "resourceId")?;
        Ok(Self {
            module_id: module_id.to_string(),
            kind,
            resource_id: resource_id.to_string(),
        })
    }

    pub fn module_id(&self) -> &str {
        &self.module_id
    }

    pub fn kind(&self) -> ResourceKind {
        self.kind
    }

    pub fn resource_id(&self) -> &str {
        &self.resource_id
    }
}

impl fmt::Display for CanonicalId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}{sep}{}{sep}{}",
            self.module_id,
            self.kind,
            self.resource_id,
            sep = CANONICAL_ID_SEPARATOR,
        )
    }
}

/// Validate that an explicit (author-supplied) id segment matches
/// `[A-Za-z0-9._-]+`. The separator `:` and any whitespace or other special
/// character is rejected. Empty strings are also rejected.
pub fn validate_segment(value: &str, label: &str) -> Result<()> {
    if value.is_empty() {
        return Err(anyhow!("{label} segment is empty"));
    }
    for c in value.chars() {
        let allowed = c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-';
        if !allowed {
            return Err(anyhow!(
                "{label} segment {value:?} contains disallowed character {c:?}; \
                 allowed characters are [A-Za-z0-9._-]"
            ));
        }
    }
    Ok(())
}

/// Snake-case slug derivation used when a resource has no explicit `id`.
/// Returns `None` when the result would be empty (the caller should treat
/// this as a validation failure).
///
/// Defense-in-depth only: the install validator rejects any resource
/// missing `id` before this function is ever called from production code
/// paths. Kept for tests and possible future tooling.
#[allow(dead_code)]
///
/// Rule (matches `docs/barkloader/modules.md#slug-rule-slugname`):
///   1. ASCII uppercase letters become lowercase, prefixed with `_` when
///      the previous char was an ASCII lowercase letter or digit. This
///      gives `"ChannelCheer"` → `"channel_cheer"`.
///   2. Any character that isn't `[a-z0-9_]` becomes `_` (whitespace,
///      punctuation, non-ASCII).
///   3. Runs of `_` collapse to a single `_`.
///   4. Leading and trailing `_` are trimmed.
///   5. If the result is empty, return `None`.
pub fn slug(name: &str) -> Option<String> {
    let mut buf = String::with_capacity(name.len());
    let mut prev_was_alphanumeric_lower = false;
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            if prev_was_alphanumeric_lower {
                buf.push('_');
            }
            buf.push(c.to_ascii_lowercase());
            // An uppercase letter is not "lower" — don't insert `_` between
            // consecutive uppercase letters (so `"ABC"` collapses to `"abc"`).
            prev_was_alphanumeric_lower = false;
        } else if c.is_ascii_lowercase() || c.is_ascii_digit() {
            buf.push(c);
            prev_was_alphanumeric_lower = true;
        } else {
            buf.push('_');
            prev_was_alphanumeric_lower = false;
        }
    }

    // Collapse runs of `_` and trim.
    let mut out = String::with_capacity(buf.len());
    let mut prev_underscore = false;
    for c in buf.chars() {
        if c == '_' {
            if !prev_underscore {
                out.push('_');
            }
            prev_underscore = true;
        } else {
            out.push(c);
            prev_underscore = false;
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Resolve the resource-segment of a canonical id from the explicit `id`
/// (if present) or, failing that, from `slug(name)`. Returns an error when
/// neither is usable — that's a manifest validation failure.
///
/// `kind_label` and `position_label` are used purely to produce a clear
/// error message ("trigger #2 has neither id nor name") and have no effect
/// on the returned value.
///
/// Defense-in-depth only: the install validator requires `id` and rejects
/// missing-id manifests before this is reached from production code paths.
#[allow(dead_code)]
pub fn resolve_resource_segment(
    explicit_id: Option<&str>,
    name: Option<&str>,
    kind_label: &str,
    position_label: &str,
) -> Result<String> {
    if let Some(raw) = explicit_id {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            validate_segment(trimmed, &format!("{kind_label} {position_label} id"))?;
            return Ok(trimmed.to_string());
        }
    }
    let Some(name_value) = name else {
        return Err(anyhow!(
            "{kind_label} {position_label} has no id and no name; one of them is required"
        ));
    };
    if name_value.trim().is_empty() {
        return Err(anyhow!(
            "{kind_label} {position_label} has no id and an empty name"
        ));
    }
    slug(name_value).ok_or_else(|| {
        anyhow!(
            "{kind_label} {position_label} has no id and the slug of name {name_value:?} is empty"
        )
    })
}

/// Returns true if `s` already looks like a fully-qualified **surface**
/// canonical id — i.e. it contains the separator and has three non-empty
/// segments with one of the engine-reserved [`ResourceKind`] strings in
/// the middle. Used to detect cross-module references in fields like
/// `workflows[].trigger` so the validator knows to pass them through
/// verbatim instead of looking them up in the local symbol table.
///
/// This is intentionally strict: a typo in the kind segment fails the
/// check rather than being silently passed through, so the validator
/// catches it as an unresolved local reference.
///
/// For instance canonical ids (free-form kind strings), use
/// [`looks_like_instance_canonical_id`] instead.
pub fn looks_like_canonical_id(s: &str) -> bool {
    let parts: Vec<&str> = s.split(CANONICAL_ID_SEPARATOR).collect();
    if parts.len() != 3 {
        return false;
    }
    if parts.iter().any(|p| p.is_empty()) {
        return false;
    }
    matches!(
        parts[1],
        "trigger" | "action" | "function" | "command" | "workflow" | "widget" | "overlay" | "asset"
    )
}

/// Returns true if `s` looks like a fully-qualified **instance** canonical
/// id — three non-empty segments where every segment passes
/// [`validate_segment`]. Unlike [`looks_like_canonical_id`], the middle
/// segment is not constrained to a fixed list — kinds are open and
/// declared by modules in their `resources[]` manifest field.
///
/// Used for `resource_ref` ConfigField values, where the engine accepts
/// any well-formed canonical id and defers semantic validation to the
/// owning module.
pub fn looks_like_instance_canonical_id(s: &str) -> bool {
    let parts: Vec<&str> = s.split(CANONICAL_ID_SEPARATOR).collect();
    if parts.len() != 3 {
        return false;
    }
    parts.iter().all(|p| validate_segment(p, "segment").is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- slug ---

    #[test]
    fn slug_converts_camel_case_to_snake() {
        assert_eq!(slug("ChannelCheer").as_deref(), Some("channel_cheer"));
        assert_eq!(slug("TwitchPlatform").as_deref(), Some("twitch_platform"));
    }

    #[test]
    fn slug_lowercases_and_replaces_specials() {
        assert_eq!(slug("Channel subscribe").as_deref(), Some("channel_subscribe"));
        assert_eq!(
            slug("Channel: Cheer (rare!)").as_deref(),
            Some("channel_cheer_rare")
        );
    }

    #[test]
    fn slug_keeps_leading_digits() {
        assert_eq!(slug("1st Stream").as_deref(), Some("1st_stream"));
    }

    #[test]
    fn slug_returns_none_when_result_empty() {
        assert_eq!(slug(":-)"), None);
        assert_eq!(slug(""), None);
        assert_eq!(slug("   "), None);
    }

    #[test]
    fn slug_collapses_consecutive_uppercase() {
        // Documented behavior: "ABC" → "abc" (no underscores between
        // consecutive uppercase letters).
        assert_eq!(slug("ABC").as_deref(), Some("abc"));
    }

    #[test]
    fn slug_does_not_split_lowercase_after_uppercase_run() {
        // Documented limitation: "ABCFoo" → "abcfoo" (we do not look ahead
        // to detect the case boundary). Authors who want "abc_foo" should
        // supply an explicit id.
        assert_eq!(slug("ABCFoo").as_deref(), Some("abcfoo"));
    }

    // --- validate_segment ---

    #[test]
    fn validate_segment_accepts_allowed_chars() {
        assert!(validate_segment("twitch_platform", "moduleId").is_ok());
        assert!(validate_segment("twitch.channel.subscribe", "id").is_ok());
        assert!(validate_segment("foo-bar", "id").is_ok());
        assert!(validate_segment("ABC123", "id").is_ok());
    }

    #[test]
    fn validate_segment_rejects_separator() {
        let err = validate_segment("foo:bar", "id").unwrap_err();
        assert!(format!("{err}").contains("disallowed"));
    }

    #[test]
    fn validate_segment_rejects_whitespace() {
        assert!(validate_segment("foo bar", "id").is_err());
    }

    #[test]
    fn validate_segment_rejects_empty() {
        assert!(validate_segment("", "id").is_err());
    }

    // --- CanonicalId ---

    #[test]
    fn canonical_id_displays_with_colon_separator() {
        let cid = CanonicalId::new("twitch_platform", ResourceKind::Trigger, "channel_subscribe")
            .expect("valid id");
        assert_eq!(cid.to_string(), "twitch_platform:trigger:channel_subscribe");
    }

    #[test]
    fn canonical_id_rejects_invalid_module_segment() {
        assert!(CanonicalId::new("bad:id", ResourceKind::Trigger, "x").is_err());
    }

    // --- resolve_resource_segment ---

    #[test]
    fn resolve_prefers_explicit_id() {
        let r = resolve_resource_segment(Some("custom_id"), Some("Custom Name"), "trigger", "#0")
            .expect("ok");
        assert_eq!(r, "custom_id");
    }

    #[test]
    fn resolve_falls_back_to_name_slug() {
        let r = resolve_resource_segment(None, Some("Channel Cheer"), "trigger", "#0").expect("ok");
        assert_eq!(r, "channel_cheer");
    }

    #[test]
    fn resolve_treats_empty_explicit_id_as_missing() {
        let r = resolve_resource_segment(Some("   "), Some("Channel Cheer"), "trigger", "#0")
            .expect("ok");
        assert_eq!(r, "channel_cheer");
    }

    #[test]
    fn resolve_fails_when_both_missing() {
        let err = resolve_resource_segment(None, None, "trigger", "#0").unwrap_err();
        assert!(format!("{err}").contains("no id and no name"));
    }

    #[test]
    fn resolve_fails_when_name_slug_empty() {
        let err =
            resolve_resource_segment(None, Some(":-)"), "trigger", "#0").unwrap_err();
        assert!(format!("{err}").contains("slug"));
    }

    #[test]
    fn resolve_fails_when_explicit_id_invalid() {
        let err =
            resolve_resource_segment(Some("bad:id"), Some("X"), "trigger", "#0").unwrap_err();
        assert!(format!("{err}").contains("disallowed"));
    }

    // --- looks_like_canonical_id ---

    #[test]
    fn detects_canonical_form() {
        assert!(looks_like_canonical_id("mod:trigger:foo"));
        assert!(looks_like_canonical_id("a:action:b"));
    }

    #[test]
    fn rejects_non_canonical_strings() {
        assert!(!looks_like_canonical_id("just_a_slug"));
        assert!(!looks_like_canonical_id("two:segments"));
        assert!(!looks_like_canonical_id("mod:bad_kind:foo"));
        assert!(!looks_like_canonical_id("mod::foo"));
        assert!(!looks_like_canonical_id(""));
    }

    // --- looks_like_instance_canonical_id ---

    #[test]
    fn detects_instance_canonical_form_open_kinds() {
        assert!(looks_like_instance_canonical_id("counter:counter:death_count"));
        assert!(looks_like_instance_canonical_id("timer:race_clock:warmup"));
        assert!(looks_like_instance_canonical_id("polls:poll:lunch_choice"));
    }

    #[test]
    fn instance_form_accepts_reserved_kinds_too() {
        // Surface canonical ids are also valid instance canonical ids
        // by shape; consumers that need to distinguish should use
        // looks_like_canonical_id first.
        assert!(looks_like_instance_canonical_id("mod:trigger:foo"));
    }

    #[test]
    fn instance_form_rejects_malformed() {
        assert!(!looks_like_instance_canonical_id("just_a_slug"));
        assert!(!looks_like_instance_canonical_id("two:segments"));
        assert!(!looks_like_instance_canonical_id("mod::foo"));
        assert!(!looks_like_instance_canonical_id("mod:has space:foo"));
        assert!(!looks_like_instance_canonical_id(""));
    }
}
