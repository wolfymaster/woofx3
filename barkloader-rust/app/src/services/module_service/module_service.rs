use anyhow::{anyhow, Result};
use super::module_plan::ModulePlan;
use super::module_file::{ModuleFile, ModuleFileKind};

pub struct ModuleService {
    files: Vec<ModuleFile>,
}

impl ModuleService {
    pub fn new() -> Self {
        ModuleService { files: Vec::new() }
    }

    pub fn create_plan(&self) -> Result<ModulePlan> {
        // find the manifest
        let manifest_file = self.files.iter().find(|f| f.kind.is_manifest()).ok_or(anyhow!("No manifest found"))?;
        
        // parse manifest as a module manifest
        let manifest = manifest_file.parse_as_manifest()?;

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

    pub fn execute_plan(&self, plan: &ModulePlan) {
        // walk the list by iterating
        for item in plan.iter() {
            item.process(&self);
        }
    }
}
