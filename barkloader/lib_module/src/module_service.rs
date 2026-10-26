use anyhow::{Result, anyhow};
use lib_repository::Repository;

use super::db_proxy::MarketplaceOrigin;
use super::db_proxy_client::{HttpDbProxyClient, ModuleDbProxy};
use super::manifest_validate::{InstallProvenance, SystemOnlyActions};
use super::module_file::ModuleFile;
use super::module_file::ModuleFileKind;
use super::module_install::{InstallOutcome, reset_endpoint_settings, run_install_with_provenance};
use super::module_manifest::ModuleManifest;
use super::registry_loader::RegistryRefresher;

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

/// Why `ModuleService::finish_install` failed. The install's rows are
/// written by then, so each of these leaves the install failed, not undone.
#[derive(Debug, thiserror::Error)]
pub enum FinishInstallError {
    #[error("finish install: manifest not loaded; call load_manifest and install first")]
    ManifestNotLoaded,
    #[error("module '{module}' installed but the sandbox registry refresh failed: {reason}")]
    RegistryRefresh { module: String, reason: String },
    #[error(
        "module '{module}' installed but its local endpoint settings could not be reset: {reason:#}"
    )]
    EndpointReset {
        module: String,
        reason: anyhow::Error,
    },
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

    /// Picks and parses the archive's manifest and records the module's
    /// identity. Must run before [`Self::install`].
    pub fn load_manifest(&mut self) -> Result<()> {
        let manifest_file = self.pick_manifest_file()?;
        let manifest = manifest_file.parse_as_manifest()?;

        self.module_id = Some(manifest.module_key().to_string());
        self.module_name = Some(manifest.name.clone());
        self.module_version = Some(manifest.version.clone());
        self.stored_manifest = Some(manifest);
        Ok(())
    }

    pub fn add_file(&mut self, kind: ModuleFileKind, name: impl Into<String>, contents: Vec<u8>) {
        self.files
            .push(ModuleFile::new(name.into(), kind, contents));
    }

    /// The provenance-free entry point, because every caller but the
    /// bundled-module reconciler is a user upload. `marketplace` names the
    /// listing the upload came from, when it came from the marketplace.
    #[allow(clippy::too_many_arguments)]
    pub async fn install(
        &self,
        archive_key: &str,
        db_proxy_url: Option<&str>,
        composite_module_key: &str,
        client_id: &str,
        marketplace: Option<&MarketplaceOrigin>,
    ) -> Result<InstallOutcome> {
        self.install_with_provenance(
            archive_key,
            db_proxy_url,
            composite_module_key,
            client_id,
            InstallProvenance::User,
            marketplace,
        )
        .await
    }

    /// See `run_install_with_provenance` for what `System` unlocks.
    #[allow(clippy::too_many_arguments)]
    pub async fn install_with_provenance(
        &self,
        archive_key: &str,
        db_proxy_url: Option<&str>,
        composite_module_key: &str,
        client_id: &str,
        provenance: InstallProvenance,
        marketplace: Option<&MarketplaceOrigin>,
    ) -> Result<InstallOutcome> {
        let manifest = self
            .stored_manifest
            .as_ref()
            .ok_or_else(|| anyhow!("install: manifest not loaded; call load_manifest first"))?;
        let client = db_proxy_url.map(HttpDbProxyClient::new);
        run_install_with_provenance(
            manifest,
            &self.files,
            &self.repository,
            archive_key,
            client
                .as_ref()
                .map(|c| c as &dyn super::db_proxy_client::ModuleDbProxy),
            composite_module_key,
            client_id,
            provenance,
            marketplace,
            &self.system_only_actions,
        )
        .await
    }

    /// Finishes an install `install` has written: reloads the module into
    /// the sandbox registry, then resets the endpoint settings `outcome`
    /// names again. Until the refresh, code of the previous version can
    /// still write those settings; after it, the registry refuses the
    /// writes. Either step failing fails the install, because both leave a
    /// host/port the module planted in place: a registry still holding the
    /// previous version can write them again, and a skipped reset never
    /// clears them.
    pub async fn finish_install(
        &self,
        refresher: &dyn RegistryRefresher,
        db_proxy: &dyn ModuleDbProxy,
        outcome: &InstallOutcome,
    ) -> Result<(), FinishInstallError> {
        let manifest = self
            .stored_manifest
            .as_ref()
            .ok_or(FinishInstallError::ManifestNotLoaded)?;
        refresher
            .refresh_module(&manifest.name)
            .await
            .map_err(|reason| FinishInstallError::RegistryRefresh {
                module: manifest.name.clone(),
                reason,
            })?;
        reset_endpoint_settings(db_proxy, manifest, &outcome.relocated_endpoint_settings)
            .await
            .map_err(|reason| FinishInstallError::EndpointReset {
                module: manifest.name.clone(),
                reason,
            })
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
    use crate::db_proxy_client::FakeDbProxyClient;
    use crate::module_file::{ModuleFileKind, ModuleValidManifestKind};
    use async_trait::async_trait;
    use lib_repository::{FileRepository, FileRepositoryConfig};
    use std::sync::Mutex;

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
    fn load_manifest_prefers_manifest_json_over_module_json() {
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
            .load_manifest()
            .expect("load_manifest should pick a manifest");
        assert_eq!(service.module_id(), Some("real_id"));
    }

    #[test]
    fn load_manifest_still_accepts_module_json_alone() {
        let mut service = service_with(&[(
            "module.json",
            br#"{"id":"legacy_id","name":"Legacy","version":"0.1.0"}"#,
        )]);
        service
            .load_manifest()
            .expect("load_manifest should still pick module.json when it's the only manifest");
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

    /// A registry whose refresh records the modules it reloaded and fails
    /// with `failure` when one is set.
    #[derive(Default)]
    struct FakeRefresher {
        refreshed: Mutex<Vec<String>>,
        failure: Option<&'static str>,
    }

    #[async_trait]
    impl RegistryRefresher for FakeRefresher {
        async fn refresh_module(&self, module_name: &str) -> Result<(), String> {
            self.refreshed
                .lock()
                .expect("refreshed mutex poisoned")
                .push(module_name.to_string());
            match self.failure {
                Some(reason) => Err(reason.to_string()),
                None => Ok(()),
            }
        }
    }

    const OBS_MANIFEST: &[u8] = br#"{
        "id": "obs",
        "name": "OBS",
        "version": "1.1.0",
        "settings": [
            { "id": "obs_address", "label": "Address", "type": "text" },
            { "id": "obs_port", "label": "Port", "type": "number", "defaultValue": "4455" }
        ],
        "local": [{
            "id": "obs",
            "name": "OBS",
            "protocol": "websocket",
            "hostSetting": "obs_address",
            "portSetting": "obs_port"
        }]
    }"#;

    /// An install that moved `obs_address` into an endpoint address setting,
    /// with a value the previous version planted there after the install
    /// reset it.
    fn installed_obs() -> (ModuleService<FileRepository>, InstallOutcome) {
        let mut service = service_with(&[("manifest.json", OBS_MANIFEST)]);
        service.load_manifest().expect("manifest loads");
        let outcome = InstallOutcome {
            relocated_endpoint_settings: vec!["obs_address".to_string()],
        };
        (service, outcome)
    }

    #[tokio::test]
    async fn test_finish_install_resets_endpoint_settings_after_the_refresh() {
        let (service, outcome) = installed_obs();
        let refresher = FakeRefresher::default();
        let db = FakeDbProxyClient::new().with_setting("obs_address", "10.0.0.66");

        service
            .finish_install(&refresher, &db, &outcome)
            .await
            .expect("install finishes");

        assert_eq!(
            *refresher
                .refreshed
                .lock()
                .expect("refreshed mutex poisoned"),
            vec!["OBS".to_string()]
        );
        assert_eq!(
            db.settings().get("obs_address").map(String::as_str),
            Some("")
        );
    }

    #[tokio::test]
    async fn test_finish_install_fails_when_the_registry_refresh_fails() {
        let (service, outcome) = installed_obs();
        let refresher = FakeRefresher {
            failure: Some("module 'OBS' not found in db"),
            ..FakeRefresher::default()
        };
        let db = FakeDbProxyClient::new().with_setting("obs_address", "10.0.0.66");

        let result = service.finish_install(&refresher, &db, &outcome).await;

        assert!(
            matches!(&result, Err(FinishInstallError::RegistryRefresh { module, .. }) if module == "OBS"),
            "{result:?}"
        );
        // The previous version still runs, so a reset now would not hold.
        assert!(db.calls().is_empty(), "{:?}", db.calls());
    }

    #[tokio::test]
    async fn test_finish_install_fails_when_the_endpoint_reset_fails() {
        let (service, outcome) = installed_obs();
        let refresher = FakeRefresher::default();
        let db = FakeDbProxyClient::failing_on(["set_module_setting"])
            .with_setting("obs_address", "10.0.0.66");

        let result = service.finish_install(&refresher, &db, &outcome).await;

        assert!(
            matches!(&result, Err(FinishInstallError::EndpointReset { module, .. }) if module == "OBS"),
            "{result:?}"
        );
    }

    #[tokio::test]
    async fn test_finish_install_fails_without_a_loaded_manifest() {
        let service = service_with(&[("manifest.json", OBS_MANIFEST)]);
        let refresher = FakeRefresher::default();
        let db = FakeDbProxyClient::new();

        let result = service
            .finish_install(&refresher, &db, &InstallOutcome::default())
            .await;

        assert!(
            matches!(result, Err(FinishInstallError::ManifestNotLoaded)),
            "{result:?}"
        );
        assert!(
            refresher
                .refreshed
                .lock()
                .expect("refreshed mutex poisoned")
                .is_empty()
        );
    }
}
