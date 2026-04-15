use anyhow::{anyhow, Result};
use lib_repository::Repository;

use super::module_file::ModuleFile;
use super::module_install::run_install;
use super::module_manifest::ModuleManifest;
use super::module_file::ModuleFileKind;
use super::module_plan::ModulePlan;

pub struct ModuleService<R> {
    files: Vec<ModuleFile>,
    pub repository: R,
    module_name: Option<String>,
    module_version: Option<String>,
    stored_manifest: Option<ModuleManifest>,
}

pub struct ModuleServiceConfig<R> {
    pub repository: R,
}

impl<R> ModuleService<R>
where
    R: Repository,
{
    pub fn new(config: ModuleServiceConfig<R>) -> Self {
        ModuleService {
            files: Vec::new(),
            repository: config.repository,
            module_name: None,
            module_version: None,
            stored_manifest: None,
        }
    }

    fn pick_manifest_file<'a>(&'a self) -> Result<&'a ModuleFile> {
        fn norm(p: &str) -> String {
            p.replace('\\', "/").to_lowercase()
        }
        let manifests: Vec<&ModuleFile> = self
            .files
            .iter()
            .filter(|f| f.kind.is_manifest())
            .collect();
        if manifests.is_empty() {
            return Err(anyhow!("No manifest found"));
        }
        let preferred_suffixes: &[(&str, u8)] = &[
            ("module.json", 0),
            ("module.yaml", 1),
            ("module.yml", 2),
        ];
        let mut best: Option<(&ModuleFile, u8)> = None;
        for f in &manifests {
            let n = norm(&f.name);
            for (suf, rank) in preferred_suffixes {
                if n == *suf || n.ends_with(&format!("/{}", suf)) {
                    let r = *rank;
                    best = match best {
                        None => Some((*f, r)),
                        Some((_, br)) if r < br => Some((*f, r)),
                        Some(other) => Some(other),
                    };
                }
            }
        }
        if let Some((f, _)) = best {
            return Ok(f);
        }
        Ok(manifests[0])
    }

    pub fn create_plan(&mut self) -> Result<ModulePlan> {
        let manifest_file = self.pick_manifest_file()?;
        let manifest = manifest_file.parse_as_manifest()?;

        self.module_name = Some(manifest.module_key().to_string());
        self.module_version = Some(manifest.version.clone());
        self.stored_manifest = Some(manifest);

        Ok(ModulePlan::new(self.stored_manifest.clone()))
    }

    pub fn add_file(
        &mut self,
        kind: ModuleFileKind,
        name: impl Into<String>,
        contents: Vec<u8>,
    ) {
        self.files.push(ModuleFile::new(name.into(), kind, contents));
    }

    pub async fn execute_plan(
        &self,
        _plan: &ModulePlan,
        archive_key: &str,
        db_proxy_url: Option<&str>,
        application_id: Option<&str>,
        force: bool,
    ) -> Result<()> {
        let cleanup_old = force;
        let manifest = self
            .stored_manifest
            .as_ref()
            .ok_or_else(|| anyhow!("execute_plan: manifest not loaded; call create_plan first"))?;
        run_install(
            manifest,
            &self.files,
            &self.repository,
            archive_key,
            db_proxy_url,
            application_id,
            cleanup_old,
        )
        .await
    }

    pub fn module_name(&self) -> Option<&str> {
        self.module_name.as_deref()
    }

    pub fn module_version(&self) -> Option<&str> {
        self.module_version.as_deref()
    }
}
