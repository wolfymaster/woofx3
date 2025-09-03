use std::str::FromStr;
use anyhow::{anyhow, Result, Error};
use super::module_manifest::ModuleManifest;

#[derive(Debug, Clone)]
pub enum ModuleValidProgramKind {
    JS,
    LUA,
}

#[derive(Debug, Clone)]
pub enum ModuleValidManifestKind {
    JSON,
    YAML,
}

 #[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum ModuleFileKind {
    MANIFEST(ModuleValidManifestKind),
    PROGRAM(ModuleValidProgramKind),
}

impl ModuleFileKind {
    pub fn is_manifest(&self) -> bool {
        match self {
            ModuleFileKind::MANIFEST(_) => true,
            _ => false,
        }
    }

    pub fn to_string(&self) -> String {
        match self {
            ModuleFileKind::PROGRAM(ModuleValidProgramKind::JS) => "js",
            ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA) => "lua",
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON) => "json",
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::YAML) => "yaml",
        }.to_string()
    }

    // pub fn is_json_manifest(&self) -> bool {
    //     match self {
    //         ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON) => true,
    //         _ => false,
    //     }
    // }

    // pub fn is_yaml_manifest(&self) -> bool {
    //     match self {
    //         ModuleFileKind::MANIFEST(ModuleValidManifestKind::YAML) => true,
    //         _ => false,
    //     }
    // }
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

impl Into<String> for &ModuleFileKind {
    fn into(self) -> String {
        match self {
            ModuleFileKind::PROGRAM(ModuleValidProgramKind::JS) => "js",
            ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA) => "lua",
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON) => "json",
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::YAML) => "yaml",
        }.to_string()
    }
}

#[derive(Debug)]
pub struct ModuleFile {
    pub name: String,
    pub kind: ModuleFileKind,
    pub contents: Vec<u8>,
}

impl ModuleFile {
    pub fn new(name: String, kind: ModuleFileKind, contents: Vec<u8>) -> Self {
        Self { name, kind, contents }
    }

    pub fn parse_as_manifest(&self) -> Result<ModuleManifest> {
        match &self.kind {
            ModuleFileKind::MANIFEST(manifest_kind) => {
                self.parse_manifest_by_kind(manifest_kind)
            }
            ModuleFileKind::PROGRAM(_) => Err(anyhow!("File '{}' is not a manifest", self.name)),
        }
    }

    fn parse_manifest_by_kind(&self, kind: &ModuleValidManifestKind) -> Result<ModuleManifest> {
        let content_str = std::str::from_utf8(&self.contents)
            .map_err(|_| anyhow!("File '{}' contents are not valid UTF-8", self.name))?;

        match kind {
            ModuleValidManifestKind::JSON => {
                serde_json::from_str(content_str)
                    .map_err(|e| anyhow!("Failed to parse JSON manifest '{}': {}", self.name, e))
            }
            ModuleValidManifestKind::YAML => {
                serde_yaml::from_str(content_str)
                    .map_err(|e| anyhow!("Failed to parse YAML manifest '{}': {}", self.name, e))
            }
        }
    }
}
