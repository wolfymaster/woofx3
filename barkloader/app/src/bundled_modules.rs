//! Bundled ("built-in") modules embedded into the binary at build time.
//!
//! The archives are produced by `build.rs` from `modules/*/` and carried in
//! the binary so first run needs no network and no `modules/` directory. The
//! boot reconciler installs them through the ordinary module install path.

use anyhow::{Result, anyhow};
use sha2::{Digest, Sha256};

/// One embedded module archive, with the identity read from its manifest at
/// build time so the reconciler can decide whether work is needed without
/// unzipping anything.
pub struct BundledModule {
    pub id: &'static str,
    pub version: &'static str,
    /// SHA-256 of `archive`, computed at build time. Not the install
    /// idempotency key — that is `(module_id, version)` — but the integrity
    /// check that catches a corrupted embed.
    pub sha256: &'static str,
    pub archive: &'static [u8],
}

impl BundledModule {
    /// Fail loudly rather than hand `run_install` bytes that are not what was
    /// built. A mismatch here means the binary itself is damaged.
    pub fn verify(&self) -> Result<()> {
        let actual = format!("{:x}", Sha256::digest(self.archive));
        if actual != self.sha256 {
            return Err(anyhow!(
                "bundled module {:?} archive digest mismatch: expected {}, got {}",
                self.id,
                self.sha256,
                actual
            ));
        }
        Ok(())
    }
}

include!(concat!(env!("OUT_DIR"), "/bundled_modules_generated.rs"));

#[cfg(test)]
mod tests {
    use super::*;
    use lib_module::manifest_validate::{InstallProvenance, validate_with_provenance};
    use lib_module::module_manifest::ModuleManifest;
    use std::io::Read;

    fn manifest_of(m: &BundledModule) -> ModuleManifest {
        let cursor = std::io::Cursor::new(m.archive);
        let mut archive = zip::ZipArchive::new(cursor).expect("bundled archive is a valid zip");
        let mut entry = archive
            .by_name("manifest.json")
            .unwrap_or_else(|_| panic!("bundled module {:?} has no manifest.json entry", m.id));
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).expect("read manifest.json");
        serde_json::from_slice(&bytes).expect("bundled manifest parses as a ModuleManifest")
    }

    #[test]
    fn at_least_one_module_is_embedded() {
        assert!(
            !BUNDLED_MODULES.is_empty(),
            "no bundled modules were embedded"
        );
    }

    #[test]
    fn every_embedded_archive_matches_its_digest() {
        for m in BUNDLED_MODULES {
            m.verify().unwrap_or_else(|e| panic!("{e}"));
        }
    }

    #[test]
    fn the_system_module_is_embedded() {
        assert!(
            BUNDLED_MODULES.iter().any(|m| m.id == "woofx3"),
            "the woofx3 system module is not embedded"
        );
    }

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<&str> = BUNDLED_MODULES.iter().map(|m| m.id).collect();
        ids.sort_unstable();
        let before = ids.len();
        ids.dedup();
        assert_eq!(before, ids.len(), "duplicate bundled module ids");
    }

    /// The embedded identity is what the reconciler compares against the db to
    /// decide whether an install is needed; if it disagreed with the archive's
    /// own manifest the reconciler would install the wrong thing, or nothing.
    #[test]
    fn embedded_identity_matches_the_archived_manifest() {
        for m in BUNDLED_MODULES {
            let manifest = manifest_of(m);
            assert_eq!(
                manifest.id, m.id,
                "manifest id disagrees with embedded identity"
            );
            assert_eq!(
                manifest.version, m.version,
                "manifest version disagrees with embedded identity"
            );
        }
    }

    /// Bundled modules install through `run_install` like any other module, so
    /// a manifest that cannot pass validation is a build that boots into a
    /// fatal reconcile. Catch it here instead.
    #[test]
    fn every_bundled_manifest_passes_system_validation() {
        for m in BUNDLED_MODULES {
            let manifest = manifest_of(m);
            validate_with_provenance(&manifest, InstallProvenance::System)
                .unwrap_or_else(|e| panic!("bundled module {:?} fails validation: {e}", m.id));
        }
    }

    /// The engine's emitted event vocabulary, embedded at compile time so the
    /// check spans the language boundary the manifest sits across.
    const TWITCH_EVENTS_TS: &str =
        include_str!("../../../shared/common/typescript/cloudevents/Twitch/events.ts");

    fn emitted_event_types() -> Vec<String> {
        TWITCH_EVENTS_TS
            .lines()
            .filter_map(|l| {
                let (_, rest) = l.split_once(" = '")?;
                let (value, _) = rest.split_once('\'')?;
                Some(value.to_string())
            })
            .collect()
    }

    /// A widget's `acceptedEvents` are compared against a CloudEvent's `type`
    /// by the scene fan-out. An entry no one emits is not an error anywhere at
    /// runtime -- it simply never matches, and the widget goes dark with no
    /// log. That is exactly how the retired `*.user.twitch` names survived, so
    /// the manifest and the engine's vocabulary are checked against each other
    /// here rather than by eye.
    #[test]
    fn bundled_widget_accepted_events_are_emitted_by_the_engine() {
        let emitted = emitted_event_types();
        assert!(!emitted.is_empty(), "parsed no event types out of the enum");

        let mut checked = 0;
        for m in BUNDLED_MODULES {
            for widget in manifest_of(m).widgets {
                assert!(
                    !widget.accepted_events.is_empty(),
                    "widget {:?} accepts no events, so the fan-out can never reach it",
                    widget.id
                );
                for event in &widget.accepted_events {
                    assert!(
                        emitted.contains(event),
                        "widget {:?} accepts {event:?}, which the engine does not emit",
                        widget.id
                    );
                    checked += 1;
                }
            }
        }
        assert!(checked > 0, "no bundled widget declared any accepted event");
    }

    /// The reserved id is only installable as System. If a bundled manifest
    /// passed user validation it would mean the reservation had regressed.
    #[test]
    fn the_system_module_is_refused_under_user_provenance() {
        for m in BUNDLED_MODULES.iter().filter(|m| m.id == "woofx3") {
            let manifest = manifest_of(m);
            assert!(
                validate_with_provenance(&manifest, InstallProvenance::User).is_err(),
                "the reserved woofx3 id installed under user provenance"
            );
        }
    }
}
