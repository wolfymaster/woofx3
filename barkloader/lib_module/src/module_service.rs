use anyhow::{Result, anyhow};
use lib_repository::Repository;

use super::db_proxy_client::HttpDbProxyClient;
use super::manifest_validate::{InstallProvenance, SystemOnlyActions};
use super::module_file::ModuleFile;
use super::module_file::ModuleFileKind;
use super::module_install::run_install_with_provenance;
use super::module_manifest::ModuleManifest;
use super::module_plan::ModulePlan;

/// How strongly an archive member name reads as the module manifest: lower
/// is preferred, `None` is not a manifest name at all. Real modules ship
/// `manifest.*` (see the woofx3-modules repo); `module.*` is kept,
/// lower-ranked, for the legacy convention. Matching is on the final path
/// segment, case-insensitively, so an archive whose files sit under one
/// top-level folder resolves the same way as a flat one. Anything that
/// locates the module root inside an archive ranks names with this, so it
/// agrees with the file the installer parsed.
pub fn manifest_file_rank(name: &str) -> Option<u8> {
    const PREFERRED: &[(&str, u8)] = &[
        ("manifest.json", 0),
        ("manifest.yaml", 1),
        ("manifest.yml", 2),
        ("module.json", 3),
        ("module.yaml", 4),
        ("module.yml", 5),
    ];
    let normalized = name.replace('\\', "/").to_lowercase();
    PREFERRED
        .iter()
        .find(|(suffix, _)| normalized == *suffix || normalized.ends_with(&format!("/{suffix}")))
        .map(|(_, rank)| *rank)
}

pub struct ModuleService<R> {
    files: Vec<ModuleFile>,
    pub repository: R,
    module_id: Option<String>,
    module_name: Option<String>,
    module_version: Option<String>,
    stored_manifest: Option<ModuleManifest>,
    system_only_actions: SystemOnlyActions,
}

pub struct ModuleServiceConfig<R> {
    pub repository: R,
    /// The bundled modules' `systemOnly` actions, which a user-provenance
    /// install may not reference. Required rather than defaulted so no upload
    /// path can install without the check by leaving it out.
    pub system_only_actions: SystemOnlyActions,
}

impl<R> ModuleService<R>
where
    R: Repository,
{
    pub fn new(config: ModuleServiceConfig<R>) -> Self {
        ModuleService {
            files: Vec::new(),
            repository: config.repository,
            module_id: None,
            module_name: None,
            module_version: None,
            stored_manifest: None,
            system_only_actions: config.system_only_actions,
        }
    }

    fn pick_manifest_file(&self) -> Result<&ModuleFile> {
        let manifests: Vec<&ModuleFile> =
            self.files.iter().filter(|f| f.kind.is_manifest()).collect();
        if manifests.is_empty() {
            return Err(anyhow!("No manifest found"));
        }
        let mut best: Option<(&ModuleFile, u8)> = None;
        for f in &manifests {
            let Some(rank) = manifest_file_rank(&f.name) else {
                continue;
            };
            best = match best {
                Some((_, best_rank)) if best_rank <= rank => best,
                _ => Some((*f, rank)),
            };
        }
        if let Some((f, _)) = best {
            return Ok(f);
        }
        Ok(manifests[0])
    }

    pub fn create_plan(&mut self) -> Result<ModulePlan> {
        let manifest_file = self.pick_manifest_file()?;
        let manifest = manifest_file.parse_as_manifest()?;

        self.module_id = Some(manifest.module_key().to_string());
        self.module_name = Some(manifest.name.clone());
        self.module_version = Some(manifest.version.clone());
        self.stored_manifest = Some(manifest);

        Ok(ModulePlan::new(self.stored_manifest.clone()))
    }

    pub fn add_file(&mut self, kind: ModuleFileKind, name: impl Into<String>, contents: Vec<u8>) {
        self.files
            .push(ModuleFile::new(name.into(), kind, contents));
    }

    /// The provenance-free entry point, because every caller but the
    /// bundled-module reconciler is a user upload.
    #[allow(clippy::too_many_arguments)]
    pub async fn execute_plan(
        &self,
        plan: &ModulePlan,
        archive_key: &str,
        db_proxy_url: Option<&str>,
        force: bool,
        composite_module_key: &str,
        client_id: &str,
    ) -> Result<()> {
        self.execute_plan_with_provenance(
            plan,
            archive_key,
            db_proxy_url,
            force,
            composite_module_key,
            client_id,
            InstallProvenance::User,
        )
        .await
    }

    /// See `run_install_with_provenance` for what `System` unlocks.
    #[allow(clippy::too_many_arguments)]
    pub async fn execute_plan_with_provenance(
        &self,
        _plan: &ModulePlan,
        archive_key: &str,
        db_proxy_url: Option<&str>,
        force: bool,
        composite_module_key: &str,
        client_id: &str,
        provenance: InstallProvenance,
    ) -> Result<()> {
        let cleanup_old = force;
        let manifest = self
            .stored_manifest
            .as_ref()
            .ok_or_else(|| anyhow!("execute_plan: manifest not loaded; call create_plan first"))?;
        let client = db_proxy_url.map(HttpDbProxyClient::new);
        run_install_with_provenance(
            manifest,
            &self.files,
            &self.repository,
            archive_key,
            client
                .as_ref()
                .map(|c| c as &dyn super::db_proxy_client::ModuleDbProxy),
            cleanup_old,
            composite_module_key,
            client_id,
            provenance,
            &self.system_only_actions,
        )
        .await
    }

    pub fn files(&self) -> &[ModuleFile] {
        &self.files
    }

    pub fn module_id(&self) -> Option<&str> {
        self.module_id.as_deref()
    }

    pub fn module_name(&self) -> Option<&str> {
        self.module_name.as_deref()
    }

    pub fn module_version(&self) -> Option<&str> {
        self.module_version.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::module_file::{ModuleFileKind, ModuleValidManifestKind};
    use lib_repository::{FileRepository, FileRepositoryConfig};

    fn service_with(files: &[(&str, &[u8])]) -> ModuleService<FileRepository> {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        let mut service = ModuleService::new(ModuleServiceConfig {
            repository: repo,
            system_only_actions: SystemOnlyActions::default(),
        });
        for (name, contents) in files {
            service.add_file(
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
                *name,
                contents.to_vec(),
            );
        }
        service
    }

    #[test]
    fn create_plan_prefers_manifest_json_over_module_json() {
        // manifest.json is what every real example module ships; module.json
        // is a legacy/unused convention that should still work but lose the
        // tie when both are present in one archive.
        let mut service = service_with(&[
            (
                "module.json",
                br#"{"id":"legacy_id","name":"Legacy","version":"0.1.0"}"#,
            ),
            (
                "manifest.json",
                br#"{"id":"real_id","name":"Real","version":"1.0.0"}"#,
            ),
        ]);
        service
            .create_plan()
            .expect("create_plan should pick a manifest");
        assert_eq!(service.module_id(), Some("real_id"));
    }

    #[test]
    fn create_plan_still_accepts_module_json_alone() {
        let mut service = service_with(&[(
            "module.json",
            br#"{"id":"legacy_id","name":"Legacy","version":"0.1.0"}"#,
        )]);
        service
            .create_plan()
            .expect("create_plan should still pick module.json when it's the only manifest");
        assert_eq!(service.module_id(), Some("legacy_id"));
    }

    #[test]
    fn manifest_file_rank_matches_the_final_segment_case_insensitively() {
        assert_eq!(manifest_file_rank("manifest.json"), Some(0));
        assert_eq!(manifest_file_rank("demo/Manifest.JSON"), Some(0));
        assert_eq!(manifest_file_rank("demo\\manifest.yaml"), Some(1));
        assert_eq!(manifest_file_rank("module.json"), Some(3));
        assert_eq!(manifest_file_rank("assets/bit_overlay.json"), None);
        assert_eq!(manifest_file_rank("not_manifest.json"), None);
    }
}
