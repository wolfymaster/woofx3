use anyhow::{anyhow, Error};
use std::str::FromStr;

pub struct ModulePlan {}

pub struct ModuleManifest {}

pub struct ModuleService {
    files: Vec<ModuleFile>,
}

pub enum ModuleValidProgramKind {
    JS,
    LUA,
}

pub enum ModuleValidManifestKind {
    JSON,
    YAML,
}

pub enum ModuleFileKind {
    MANIFEST(ModuleValidManifestKind),
    PROGRAM(ModuleValidProgramKind),
}

impl FromStr for ModuleFileKind {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().trim() {
            "js" => Ok(ModuleFileKind::PROGRAM(ModuleValidProgramKind::JS)),
            "lua" => Ok(ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA)),
            "json" => Ok(ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON)),
            "yaml" => Ok(ModuleFileKind::MANIFEST(ModuleValidManifestKind::YAML)),
            "yml" => Ok(ModuleFileKind::MANIFEST(ModuleValidManifestKind::YAML)),
            _ => Err(anyhow!("Invalid file kind")),
        }
    }
}

pub struct ModuleFile {
    name: String,
    kind: ModuleFileKind,
    contents: Vec<u8>,
}

impl ModuleService {
    pub fn new() -> Self {
        ModuleService { files: Vec::new() }
    }

    pub fn create_plan(&self) {
        // returns a ModulePlan
    }

    pub fn add_file(
        &mut self,
        kind: ModuleFileKind,
        name: impl Into<String>,
        contents: Vec<u8>,
    ) {
        self.files.push(ModuleFile {
            name: name.into(),
            kind,
            contents,
        });
    }

    pub fn execute_plan(&self, plan: &ModulePlan) {}
}
