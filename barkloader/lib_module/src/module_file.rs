use std::str::FromStr;

use anyhow::{Error, Result, anyhow};

use super::module_manifest::ModuleManifest;

#[derive(Debug, Clone)]
pub enum ModuleValidProgramKind {
    Js,
    Lua,
}

#[derive(Debug, Clone)]
pub enum ModuleValidManifestKind {
    Json,
    Yaml,
}

#[derive(Debug, Clone)]
pub enum ModuleFileKind {
    MANIFEST(ModuleValidManifestKind),
    PROGRAM(ModuleValidProgramKind),
    /// Static assets (html, css, images, fonts, …) stored with this file extension.
    ASSET(String),
}

impl ModuleFileKind {
    pub fn is_manifest(&self) -> bool {
        matches!(self, ModuleFileKind::MANIFEST(_))
    }
}

/// The file extension the kind was read from.
impl std::fmt::Display for ModuleFileKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModuleFileKind::PROGRAM(ModuleValidProgramKind::Js) => f.write_str("js"),
            ModuleFileKind::PROGRAM(ModuleValidProgramKind::Lua) => f.write_str("lua"),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json) => f.write_str("json"),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Yaml) => f.write_str("yaml"),
            ModuleFileKind::ASSET(ext) => f.write_str(ext),
        }
    }
}

impl FromStr for ModuleFileKind {
    type Err = Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().trim() {
            "js" => Ok(ModuleFileKind::PROGRAM(ModuleValidProgramKind::Js)),
            "lua" => Ok(ModuleFileKind::PROGRAM(ModuleValidProgramKind::Lua)),
            "json" => Ok(ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json)),
            "yaml" => Ok(ModuleFileKind::MANIFEST(ModuleValidManifestKind::Yaml)),
            "yml" => Ok(ModuleFileKind::MANIFEST(ModuleValidManifestKind::Yaml)),
            "zip" => Err(anyhow!("zip is handled separately")),
            other => Ok(ModuleFileKind::ASSET(other.to_string())),
        }
    }
}

impl From<&ModuleFileKind> for String {
    fn from(k: &ModuleFileKind) -> String {
        k.to_string()
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
        Self {
            name,
            kind,
            contents,
        }
    }

    pub fn parse_as_manifest(&self) -> Result<ModuleManifest> {
        match &self.kind {
            ModuleFileKind::MANIFEST(manifest_kind) => self.parse_manifest_by_kind(manifest_kind),
            _ => Err(anyhow!("File '{}' is not a manifest", self.name)),
        }
    }

    fn parse_manifest_by_kind(&self, kind: &ModuleValidManifestKind) -> Result<ModuleManifest> {
        let content_str = std::str::from_utf8(&self.contents)
            .map_err(|_| anyhow!("File '{}' contents are not valid UTF-8", self.name))?;

        match kind {
            ModuleValidManifestKind::Json => serde_json::from_str(content_str)
                .map_err(|e| anyhow!("Failed to parse JSON manifest '{}': {}", self.name, e)),
            ModuleValidManifestKind::Yaml => serde_yaml::from_str(content_str)
                .map_err(|e| anyhow!("Failed to parse YAML manifest '{}': {}", self.name, e)),
        }
    }
}
