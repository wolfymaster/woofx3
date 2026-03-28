use anyhow::{anyhow, Result};
use lib_repository::Repository;
use super::module_plan::ModulePlan;
use super::module_file::{ModuleFile, ModuleFileKind};

// TODO: Module service needs to receive a db struct that can be used to retreive a channel to send messages on

pub struct ModuleService<R> {
    files: Vec<ModuleFile>,
    pub repository: R,
    module_name: Option<String>,
    module_version: Option<String>,
}

pub struct ModuleServiceConfig<R> {
    pub repository: R,
}

impl<R> ModuleService<R>
where R: Repository {
    pub fn new(config: ModuleServiceConfig<R>) -> Self {
        ModuleService {
            files: Vec::new(),
            repository: config.repository,
            module_name: None,
            module_version: None,
        }
    }

    pub fn create_plan(&mut self) -> Result<ModulePlan> {
        // find the manifest
        let manifest_file = self.files.iter().find(|f| f.kind.is_manifest()).ok_or(anyhow!("No manifest found"))?;

        // parse manifest as a module manifest
        let manifest = manifest_file.parse_as_manifest()?;

        self.module_name = Some(manifest.name.clone());
        self.module_version = Some(manifest.version.clone());

        // use the manifest file to generate a plan
        let plan = ModulePlan::new(Some(manifest));

        // returns a ModulePlan
        return Ok(plan)
    }

    pub fn add_file(
        &mut self,
        kind: ModuleFileKind,
        name: impl Into<String>,
        contents: Vec<u8>,
    ) {
        self.files.push(ModuleFile::new(name.into(), kind, contents));
    }

    pub async fn execute_plan(&self, plan: &ModulePlan, db_proxy_url: Option<&str>) {
        let module_name = self.module_name.as_deref().unwrap_or("unknown");
        for item in plan.iter() {
            item.process(module_name, &self.files, &self.repository, db_proxy_url).await;
        }
    }

    pub fn module_name(&self) -> Option<&str> {
        self.module_name.as_deref()
    }

    pub fn module_version(&self) -> Option<&str> {
        self.module_version.as_deref()
    }
}
