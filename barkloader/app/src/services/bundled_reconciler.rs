//! Installs the embedded bundled modules at boot, through the ordinary
//! module install path.
//!
//! There is no second installer: `run_install` already provides the saga with
//! compensating cleanup, version diffing, archival of dropped resources, asset
//! upload, and canonical-id resolution. Reproducing any of that for bundled
//! modules would rebuild the brittleness this exists to remove.

use std::io::Read;

use anyhow::{Context, Result, anyhow};
use lib_module::db_proxy;
use lib_module::{InstallProvenance, ModuleFileKind, ModuleService, ModuleServiceConfig};
use lib_repository::{CreateFileRequest, Repository};
use sha2::{Digest, Sha256};
use tracing::info;

use crate::bundled_modules::{BUNDLED_MODULES, BundledModule};

/// What the reconciler did for one module, so the caller can log a summary
/// without the reconciler deciding how loud a no-op should be.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Already installed at this version. No writes.
    UpToDate,
    Installed {
        version: String,
    },
}

/// Install every embedded module that is missing or at a different version.
///
/// Fails on the first module that cannot be installed. The system is not
/// functional without its core actions, triggers, and widget, and starting
/// anyway is what produced the silent failures this replaces — so the caller
/// is expected to treat an error here as fatal.
pub async fn reconcile<R: Repository + Clone>(
    db_proxy_url: &str,
    repository: &R,
) -> Result<Vec<(String, Outcome)>> {
    let mut outcomes = Vec::with_capacity(BUNDLED_MODULES.len());
    for module in BUNDLED_MODULES {
        let outcome = reconcile_one(module, db_proxy_url, repository)
            .await
            .with_context(|| format!("bundled module {:?}", module.id))?;
        outcomes.push((module.id.to_string(), outcome));
    }
    Ok(outcomes)
}

async fn reconcile_one<R: Repository + Clone>(
    module: &BundledModule,
    db_proxy_url: &str,
    repository: &R,
) -> Result<Outcome> {
    module.verify()?;

    let installed = db_proxy::get_module_record_by_module_id(db_proxy_url, module.id).await?;
    let installed_version = installed.as_ref().map(|m| m.version.as_str());
    if !needs_install(installed_version, module.version) {
        return Ok(Outcome::UpToDate);
    }

    let previous = installed_version.unwrap_or("<none>");
    info!(
        module_id = module.id,
        from = previous,
        to = module.version,
        "installing bundled module"
    );

    install(module, db_proxy_url, repository).await?;
    Ok(Outcome::Installed {
        version: module.version.to_string(),
    })
}

/// Whether the embedded copy has to be installed over what is in the db.
///
/// Keyed on `(module_id, version)` rather than the composite module_key: the
/// key needs the archive bytes and would tie the decision to compression
/// determinism, while this is answerable offline from one lookup.
///
/// Any difference installs, not just a higher version — a bundled module is
/// whatever the running binary carries, so a rollback to an older binary must
/// converge the db back onto that older embedded copy.
fn needs_install(installed_version: Option<&str>, bundled_version: &str) -> bool {
    installed_version != Some(bundled_version)
}

async fn install<R: Repository + Clone>(
    module: &BundledModule,
    db_proxy_url: &str,
    repository: &R,
) -> Result<()> {
    let mut service = ModuleService::new(ModuleServiceConfig {
        repository: repository.clone(),
    });
    for (name, contents) in read_archive(module)? {
        let extension = std::path::Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        // Unknown extensions are skipped rather than fatal, matching the
        // upload path: an archive may carry files barkloader doesn't track.
        let Ok(kind) = extension.parse::<ModuleFileKind>() else {
            continue;
        };
        service.add_file(kind, name, contents);
    }

    let plan = service
        .create_plan()
        .map_err(|e| anyhow!("parse bundled manifest: {}", e))?;

    // Same `{id}:{version}:{hash}` composite every install uses; the hash
    // segment scopes this version's stored files so an upgrade never
    // overwrites the previous version's bytes.
    let digest = format!("{:x}", Sha256::digest(module.archive));
    let composite_module_key = format!(
        "{}:{}:{}",
        module.id,
        module.version,
        &digest[..7_usize.min(digest.len())]
    );
    let archive_key = format!("archives/{}.zip", composite_module_key);

    service
        .execute_plan_with_provenance(
            &plan,
            &archive_key,
            Some(db_proxy_url),
            "",
            // Not a force install: go through the diff-aware upgrade path so a
            // version bump archives resources the new manifest dropped.
            false,
            &composite_module_key,
            "",
            InstallProvenance::System,
        )
        .await
        .map_err(|e| anyhow!("install failed: {}", e))?;

    // Archive the source zip under the key the module row now points at, so a
    // bundled module can be inspected and rolled back like an uploaded one.
    let request = CreateFileRequest {
        content: Some(module.archive.to_vec()),
        extension: Some("zip".to_string()),
        file_name: archive_key.clone(),
    };
    let mut failed: Vec<String> = Vec::new();
    repository
        .create([request], &mut failed)
        .await
        .with_context(|| format!("store bundled archive at {archive_key}"))?;
    if !failed.is_empty() {
        return Err(anyhow!(
            "store bundled archive at {archive_key}: {}",
            failed.join(", ")
        ));
    }
    Ok(())
}

fn read_archive(module: &BundledModule) -> Result<Vec<(String, Vec<u8>)>> {
    let cursor = std::io::Cursor::new(module.archive);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| anyhow!("open embedded archive: {}", e))?;
    let mut files = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| anyhow!("read zip entry {}: {}", i, e))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut contents = Vec::new();
        entry
            .read_to_end(&mut contents)
            .map_err(|e| anyhow!("read zip entry {}: {}", name, e))?;
        files.push((name, contents));
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_module_installs() {
        assert!(needs_install(None, "0.1.0"));
    }

    #[test]
    fn a_matching_version_is_a_no_op() {
        assert!(!needs_install(Some("0.1.0"), "0.1.0"));
    }

    #[test]
    fn a_version_bump_installs() {
        assert!(needs_install(Some("0.1.0"), "0.2.0"));
    }

    /// Downgrades install too: the embedded copy is the source of truth, so
    /// running an older binary must converge the db back onto it.
    #[test]
    fn a_downgrade_installs() {
        assert!(needs_install(Some("0.2.0"), "0.1.0"));
    }

    #[test]
    fn a_corrupted_embed_is_caught_before_any_db_call() {
        let bad = BundledModule {
            id: "woofx3",
            version: "0.1.0",
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            archive: b"not the bytes that were hashed",
        };
        let err = bad.verify().expect_err("a mismatched digest must fail");
        assert!(
            err.to_string().contains("digest mismatch"),
            "unexpected error: {err}"
        );
    }
}
