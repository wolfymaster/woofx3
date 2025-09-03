use lib_repository::{CreateFileRequest, Repository};
use super::module_file::ModuleFile;
use serde::{Deserialize, Serialize};
use log::{info};
use anyhow::{anyhow, Result};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleFunction {
    function_name: String,
    file_name: String,
}

impl ModuleFunction {
    pub async fn process<R>(&self, files: &Vec<ModuleFile>, repository: &R) -> Result<()>
    where  R: Repository {
        info!("processing function: {}", self.function_name);        

        // get the file for this function
        let file = files.iter().find(|f| f.name == self.file_name).ok_or(anyhow!("No manifest found"))?;

        // create the createFileRequests
        let req = CreateFileRequest {
            content: Some(file.contents.clone()),
            extension: Some(file.kind.to_string()),
            file_name: file.name.clone(),
        };

        // upload the function to a repository
        let mut failed: Vec<String> = Vec::new();
        repository.create([req], &mut failed).await?;

        if failed.is_empty() {
            Ok(())
        } else {
            Err(anyhow!("Failed to save all files in repository"))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleCommand { 
    command: String,

    #[serde(rename = "type")]
    kind: ModuleCommandKind,
}

#[derive(Debug, PartialEq)]
pub enum ModuleCommandKind {
    TEXT,
    FUNCTION,
}

impl ModuleCommandKind {
    fn as_str(&self) -> &'static str {
        match self {
            ModuleCommandKind::TEXT => "text",
            ModuleCommandKind::FUNCTION => "function",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "text" => Some(ModuleCommandKind::TEXT),
            "function" => Some(ModuleCommandKind::FUNCTION),
            _ => None,
        }
    }
}

impl ModuleCommand {
    pub fn process(&self) -> Result<()> {
        info!("processing command: {}", self.command);

        match self.kind {
            ModuleCommandKind::TEXT => {
                // insert command into database
            },
            ModuleCommandKind::FUNCTION => {
                // insert command into database
            }
        }

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleStorage {}

impl ModuleStorage {
    pub fn process(&self) -> Result<()> {
        info!("processing storage");

        // offer only k/v storage? 
        // let the user define the key and store any value
        // i don't care what type the value is - just store it
        // so we just need a new "bucket" setup for their key
            // when does it expire? per stream or never?
            // prolly have some reaper that finds expired ones - not something to do here
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleWorkflow {

}

impl ModuleWorkflow {
    pub fn process(&self) -> Result<()> {
        info!("processing workflow");

        // send the workflow to wooflow
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleManifest {
    pub name: String,
    pub functions: Vec<ModuleFunction>,
    pub commands: Vec<ModuleCommand>,
    pub storage: ModuleStorage,
    pub workflows: Vec<ModuleWorkflow>
}
