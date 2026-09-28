//! Bundled ("built-in") modules embedded into the binary at build time.
//!
//! The archives are produced by `build.rs` from `modules/*/` and carried in
//! the binary so first run needs no network and no `modules/` directory. The
//! boot reconciler installs them through the ordinary module install path.

use std::io::Read;
use std::sync::OnceLock;

use anyhow::{Result, anyhow};
use lib_module::SystemOnlyActions;
use lib_module::module_manifest::ModuleManifest;
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

impl BundledModule {
    /// The manifest inside the archive.
    pub fn manifest(&self) -> Result<ModuleManifest> {
        let cursor = std::io::Cursor::new(self.archive);
        let mut archive = zip::ZipArchive::new(cursor)
            .map_err(|e| anyhow!("bundled module {:?}: open archive: {e}", self.id))?;
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|e| anyhow!("bundled module {:?}: no manifest.json: {e}", self.id))?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| anyhow!("bundled module {:?}: read manifest.json: {e}", self.id))?;
        serde_json::from_slice(&bytes)
            .map_err(|e| anyhow!("bundled module {:?}: parse manifest.json: {e}", self.id))
    }
}

include!(concat!(env!("OUT_DIR"), "/bundled_modules_generated.rs"));

static SYSTEM_ONLY_ACTIONS: OnceLock<SystemOnlyActions> = OnceLock::new();

/// The `systemOnly` actions the embedded modules declare, which an uploaded
/// module may not reference. Read from the binary once; boot calls this before
/// serving uploads, so a damaged embed stops the process there instead of
/// failing each upload.
pub fn system_only_actions() -> Result<&'static SystemOnlyActions> {
    if let Some(actions) = SYSTEM_ONLY_ACTIONS.get() {
        return Ok(actions);
    }
    let manifests = BUNDLED_MODULES
        .iter()
        .map(BundledModule::manifest)
        .collect::<Result<Vec<_>>>()?;
    let actions = SystemOnlyActions::from_manifests(&manifests)?;
    Ok(SYSTEM_ONLY_ACTIONS.get_or_init(|| actions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lib_module::canonical_id::{CanonicalId, ResourceKind};
    use lib_module::manifest_validate::{InstallProvenance, validate_with_provenance};

    fn manifest_of(m: &BundledModule) -> ModuleManifest {
        m.manifest().unwrap_or_else(|e| panic!("{e}"))
    }

    fn action(id: &str) -> CanonicalId {
        CanonicalId::new("woofx3", ResourceKind::Action, id).expect("valid canonical id")
    }

    /// The Twitch actions module code may not request through `ctx.twitch`
    /// stay out of uploaded modules' workflows too; the ones it may request
    /// stay available.
    #[test]
    fn twitch_moderation_and_channel_edits_are_system_only() {
        let reserved = system_only_actions().expect("bundled manifests parse");
        assert!(reserved.contains(&action("twitch.timeout")));
        assert!(reserved.contains(&action("twitch.update_stream")));
        for open in [
            "twitch.shoutout",
            "twitch.clip",
            "twitch.marker",
            "chat.reply",
            "alert",
        ] {
            assert!(
                !reserved.contains(&action(open)),
                "{open} should be open to modules"
            );
        }
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
