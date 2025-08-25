use serde::{Deserialize, Serialize};
use log::{info};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleFunction {
    function_name: String,
    file_name: String,
}

impl ModuleFunction {
    pub fn process(&self) {
        info!("processing function: {}", self.function_name);

        // upload the function to a repository
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleCommand { 
    command: String,

    #[serde(rename = "type")]
    kind: String,
}

impl ModuleCommand {
    pub fn process(&self) {
        info!("processing command: {}", self.command);

        // add the command to the database
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleStorage {}

impl ModuleStorage {
    pub fn process(&self) {
        info!("processing storage");

        // offer only k/v storage? 
        // let the user define the key and store any value
        // i don't care what type the value is - just store it
        // so we just need a new "bucket" setup for their key
            // when does it expire? per stream or never?
            // prolly have some reaper that finds expired ones - not something to do here
        
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleWorkflow {

}

impl ModuleWorkflow {
    pub fn process(&self) {
        info!("processing workflow");

        // send the workflow to wooflow
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
