use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Result};
use lib_repository::{CreateFileRequest, Repository};
use log::{info, warn};
use reqwest;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::module_file::ModuleFile;
// use crate:: storage::StorageClient;

use woofx3;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleFunction {
    function_name: String,
    file_name: String,
    #[serde(default)]
    entry_point: Option<String>,
}

impl ModuleFunction {
    pub async fn process<R>(&self, module_name: &str, files: &Vec<ModuleFile>, repository: &R) -> Result<()>
    where  R: Repository {
        info!("processing function: {}", self.function_name);

        // get the file for this function
        let file = files.iter().find(|f| f.name == self.file_name).ok_or(anyhow!("Function {} not found", self.function_name))?;

        // store at modules/{module_name}/{file_name}
        let repo_key = format!("{}/{}", module_name, file.name);
        let req = CreateFileRequest {
            content: Some(file.contents.clone()),
            extension: Some(file.kind.to_string()),
            file_name: repo_key,
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

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
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
    // fn process(&self, channel: &tonic::transport::Channel, application_id: Uuid) {}
    pub async fn process(&self) -> Result<()> {
        info!("processing command: {}", self.command);

        match self.kind {
            ModuleCommandKind::TEXT => {
                // insert command into database

                // TODO: pass &app.dbClient 
                // dbClient.create_command(CreateCommandRequest)
                // woofx3::db::command::command_service_client::CommandServiceClient::new(channel)
                //     .create_command(woofx3::db::command::CreateCommandRequest {
                //         command: self.command.clone(),
                //         application_id: application_id.to_string(),
                //         command_type: self.kind.as_str().to_string(),
                //         cooldown: 0,
                //         priority: 0,
                //         enabled: true,
                //         created_by: "barkloader".to_string(),
                //         created_at: None,
                //     })
                //     .await?;

            },
            ModuleCommandKind::FUNCTION => {
                // insert command into database
            }
        }

        Ok(())
    }
}

/// Configuration for a storage key in the module manifest
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StorageKeyConfig {
    /// Default value if key doesn't exist
    #[serde(default)]
    pub default_value: Option<String>,
    
    /// Time-to-live in seconds (None means never expires)
    #[serde(default)]
    pub ttl_seconds: Option<u64>,
    
    /// Namespace for grouping related keys
    #[serde(default)]
    pub namespace: String,
    
    /// Whether to clear this key when the stream ends
    #[serde(default)]
    pub clear_on_stream_end: bool,
    
    /// Whether to clear this key when the session ends
    #[serde(default)]
    pub clear_on_session_end: bool,
}

/// Represents storage configuration in the module manifest
#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleStorage {
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    keys: std::collections::HashMap<String, StorageKeyConfig>,
}

// impl ModuleStorage {
//     /// Process storage configuration and provision any required keys
//     pub async fn process(
//         &self, 
//         storage_client: &mut StorageClient, 
//         application_id: Uuid
//     ) -> Result<()> {
//         info!("processing storage configuration");

//         // Process each key configuration
//         for (key, config) in &self.keys {
//             // Check if key exists
//             if let Some(existing) = storage_client.get(key, application_id).await? {
//                 // If key exists and has no TTL, skip
//                 if existing.expires_at.is_none() {
//                     continue;
//                 }
                
//                 // If key exists but is expired, remove it
//                 if let Some(expires_at) = existing.expires_at {
//                     if SystemTime::now()
//                         .duration_since(SystemTime::UNIX_EPOCH)
//                         .map(|d| d.as_secs() > expires_at)
//                         .unwrap_or(false)
//                     {
//                         storage_client.delete(key, application_id).await?;
//                     }
//                 }
//             }

//             // Key doesn't exist or was expired, create it with default value
//             if let Some(default_value) = &config.default_value {
//                 let now = SystemTime::now()
//                     .duration_since(SystemTime::UNIX_EPOCH)
//                     .map_err(|e| anyhow!("Failed to get current time: {}", e))?
//                     .as_secs();

//                 let expires_at = config.ttl_seconds.map(|ttl| now + ttl);

//                 // storage_client.set(crate::storage::StorageKey {
//                 //     key: key.clone(),
//                 //     value: default_value.clone(),
//                 //     created_at: now,
//                 //     expires_at,
//                 //     namespace: config.namespace.clone(),
//                 //     application_id,
//                 //     clear_on_stream_end: config.clear_on_stream_end,
//                 //     clear_on_session_end: config.clear_on_session_end,
//                 // }).await?;
                
//                 info!("Provisioned storage key: {} in namespace: {}", key, config.namespace);
//             }
//         }

//         Ok(())
//     }

//     /// Clear all keys in a specific namespace
//     pub async fn clear_namespace(
//         &self, 
//         storage_client: &mut StorageClient,
//         namespace: &str, 
//         application_id: Uuid
//     ) -> Result<()> {
//         storage_client.clear_namespace(namespace, application_id).await
//     }

//     /// Clear all expired keys
//     pub async fn clear_expired(
//         &self, 
//         storage_client: &mut StorageClient, 
//         application_id: Uuid
//     ) -> Result<()> {
//         storage_client.clear_expired(application_id).await
//     }

//     /// Clear all keys for the application
//     pub async fn clear_all(
//         &self, 
//         storage_client: &mut StorageClient, 
//         application_id: Uuid
//     ) -> Result<()> {
//         storage_client.clear_all_for_application(application_id).await
//     }
// }

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleWorkflow {

}

impl ModuleWorkflow {
    pub async fn process(&self) -> Result<()> {
        info!("processing workflow");

        // send the workflow to wooflow
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleWorkflowTrigger {
    pub category: String,
    pub name: String,
    pub description: String,
    pub event: String,
    #[serde(default)]
    pub config: Vec<TriggerConfigField>,
    #[serde(default)]
    pub allow_variants: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerConfigField {
    pub name: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: TriggerFieldKind,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub options: Vec<TriggerFieldOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TriggerFieldKind {
    Text,
    Number,
    Select,
    Checkbox,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerFieldOption {
    pub label: String,
    pub value: String,
}

impl ModuleWorkflowTrigger {
    pub async fn process(&self, module_name: &str, db_proxy_url: &str) -> Result<()> {
        let config_schema = serde_json::to_string(&self.config)
            .map_err(|e| anyhow!("Failed to serialize config: {}", e))?;

        let body = serde_json::json!({
            "module_name": module_name,
            "category": self.category,
            "name": self.name,
            "description": self.description,
            "event": self.event,
            "config_schema": config_schema,
            "allow_variants": self.allow_variants,
        });

        let url = format!("{}/twirp/module.ModuleService/RegisterTrigger", db_proxy_url);

        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow!("Failed to call DB proxy RegisterTrigger: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow!("RegisterTrigger failed with status {}: {}", status, text));
        }

        info!("Registered trigger: {}/{}", module_name, self.name);
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModuleManifest {
    pub name: String,
    #[serde(default)]
    pub version: String,
    pub functions: Vec<ModuleFunction>,
    pub commands: Vec<ModuleCommand>,
    // pub storage: ModuleStorage,
    pub workflows: Vec<ModuleWorkflow>,
    #[serde(default)]
    pub workflow_triggers: Vec<ModuleWorkflowTrigger>,
}
