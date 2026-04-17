use anyhow::{anyhow, Result};
use lib_repository::{CreateFileRequest, Repository};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::module_file::ModuleFile;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestTrigger {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "type", default)]
    pub trigger_type: String,
    /// UX / registry grouping (e.g. platform.twitch). Sent to RegisterTrigger as `category`.
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAction {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub call: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFunction {
    pub id: String,
    pub name: String,
    pub runtime: String,
    pub path: String,
    #[serde(default)]
    pub entry_point: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCommand {
    pub id: String,
    pub name: String,
    pub pattern: String,
    #[serde(rename = "type")]
    pub pattern_type: String,
    #[serde(default)]
    pub workflow: Option<String>,
    #[serde(default)]
    pub required_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWorkflowStep {
    pub action: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWorkflow {
    pub id: String,
    pub name: String,
    pub trigger: String,
    #[serde(default)]
    pub steps: Vec<ManifestWorkflowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestOverlay {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleWidget {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub entry: Option<String>,
    #[serde(default)]
    pub assets: Option<String>,
    #[serde(default)]
    pub settings_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub accepted_events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub triggers: Vec<ManifestTrigger>,
    #[serde(default)]
    pub actions: Vec<ManifestAction>,
    #[serde(default)]
    pub functions: Vec<ManifestFunction>,
    #[serde(default)]
    pub commands: Vec<ManifestCommand>,
    #[serde(default)]
    pub workflows: Vec<ManifestWorkflow>,
    #[serde(default)]
    pub widgets: Vec<ModuleWidget>,
    #[serde(default)]
    pub overlays: Vec<ManifestOverlay>,
}

impl ModuleManifest {
    pub fn module_key(&self) -> &str {
        &self.id
    }

    /// The ID component used in the composite module_id.
    /// Uses the manifest `id` field if non-empty, otherwise falls back to
    /// lowercase snake_case of the module name.
    pub fn id_component(&self) -> String {
        let trimmed = self.id.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
        to_snake_case(&self.name)
    }

    /// Compute the composite module_key: `{id}:{version}:{hash}` where hash is
    /// the first 7 characters of the SHA-256 hex digest of the zip bytes.
    pub fn compute_module_key(&self, zip_bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(zip_bytes);
        let hash = format!("{:x}", hasher.finalize());
        let short_hash = &hash[..7];
        format!("{}:{}:{}", self.id_component(), self.version, short_hash)
    }
}

fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('_');
            }
            result.push(c.to_ascii_lowercase());
        } else if c.is_whitespace() || c == '-' {
            result.push('_');
        } else {
            result.push(c);
        }
    }
    result
}

fn normalize_rel_path(s: &str) -> String {
    s.trim_start_matches("./")
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string()
}

pub fn resolve_zip_file<'a>(files: &'a [ModuleFile], rel_path: &str) -> Option<&'a ModuleFile> {
    let rel = normalize_rel_path(rel_path);
    if rel.is_empty() {
        return None;
    }
    files.iter().find(|f| {
        let n = normalize_rel_path(&f.name);
        n == rel || n.ends_with(&format!("/{rel}")) || rel.ends_with(&n)
    })
}

fn extension_for_path(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_string()
}

impl ManifestFunction {
    pub async fn upload_to_repository<R: Repository>(
        &self,
        module_key: &str,
        files: &[ModuleFile],
        repository: &R,
    ) -> Result<String> {
        let file = resolve_zip_file(files, &self.path).ok_or_else(|| {
            anyhow!(
                "Function {}: path '{}' not found in module archive",
                self.id,
                self.path
            )
        })?;
        let rel_in_module = normalize_rel_path(&self.path);
        let repo_key = format!("modules/{module_key}/functions/{rel_in_module}");
        let ext = extension_for_path(&self.path);
        let req = CreateFileRequest {
            content: Some(file.contents.clone()),
            extension: Some(ext),
            file_name: repo_key.clone(),
        };
        let mut failed = Vec::new();
        repository.create([req], &mut failed).await?;
        if failed.is_empty() {
            info!("Stored function {} at {}", self.id, repo_key);
            Ok(repo_key)
        } else {
            Err(anyhow!("Failed to store function {}", self.id))
        }
    }
}

impl ManifestTrigger {
    /// Category for `RegisterTrigger` and install-time grouping: manifest `category` when set
    /// (non-empty after trim), otherwise transport/type (`type` field, e.g. `eventbus`).
    pub fn register_category(&self) -> String {
        self.category
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| self.trigger_type.clone())
    }

    /// Build the Twirp TriggerInput JSON for bulk registration.
    pub fn to_input(&self) -> super::db_proxy::TriggerInputJson {
        let config_schema = self
            .schema
            .as_ref()
            .map(|v| v.to_string())
            .unwrap_or_else(|| "{}".to_string());
        super::db_proxy::TriggerInputJson {
            category: self.register_category(),
            name: self.name.clone(),
            description: self.description.clone(),
            event: self.id.clone(),
            config_schema,
            allow_variants: false,
        }
    }
}

fn widget_asset_prefix(assets: &str) -> String {
    normalize_rel_path(assets).trim_end_matches('/').to_string() + "/"
}

impl ModuleWidget {
    async fn upload_one_file<R: Repository>(
        &self,
        module_key: &str,
        file: &ModuleFile,
        rel_under_widget: &str,
        repository: &R,
    ) -> Result<String> {
        let rel = normalize_rel_path(rel_under_widget);
        let repo_key = format!("modules/{module_key}/widgets/{}/{rel}", self.id);
        let ext = extension_for_path(&file.name);
        let mut failed = Vec::new();
        repository
            .create(
                [CreateFileRequest {
                    content: Some(file.contents.clone()),
                    extension: Some(ext),
                    file_name: repo_key.clone(),
                }],
                &mut failed,
            )
            .await?;
        if failed.is_empty() {
            Ok(repo_key)
        } else {
            Err(anyhow!("Failed to store widget file for {}", self.id))
        }
    }

    pub async fn upload_assets<R: Repository>(
        &self,
        module_key: &str,
        files: &[ModuleFile],
        repository: &R,
    ) -> Result<Vec<String>> {
        let mut keys = Vec::new();

        if let Some(entry) = &self.entry {
            if let Some(f) = resolve_zip_file(files, entry) {
                let rel = normalize_rel_path(entry);
                keys.push(
                    self.upload_one_file(module_key, f, &rel, repository)
                        .await?,
                );
            } else {
                warn!("Widget {} entry '{}' not found in archive", self.id, entry);
            }
        }

        if let Some(assets_dir) = &self.assets {
            let prefix = widget_asset_prefix(assets_dir);
            for file in files {
                let n = normalize_rel_path(&file.name);
                if !n.starts_with(&prefix) {
                    continue;
                }
                let rel_under = n.strip_prefix(&prefix).unwrap_or(&n).to_string();
                if rel_under.is_empty() {
                    continue;
                }
                keys.push(
                    self.upload_one_file(module_key, file, &rel_under, repository)
                        .await?,
                );
            }
        }

        Ok(keys)
    }
}

impl ManifestOverlay {
    pub async fn upload_entry<R: Repository>(
        &self,
        module_key: &str,
        files: &[ModuleFile],
        repository: &R,
    ) -> Result<String> {
        let file = resolve_zip_file(files, &self.entry).ok_or_else(|| {
            anyhow!(
                "Overlay {}: entry '{}' not found in module archive",
                self.id,
                self.entry
            )
        })?;
        let rel = normalize_rel_path(&self.entry);
        let repo_key = format!("modules/{module_key}/overlays/{}/{rel}", self.id);
        let ext = extension_for_path(&self.entry);
        let mut failed = Vec::new();
        repository
            .create(
                [CreateFileRequest {
                    content: Some(file.contents.clone()),
                    extension: Some(ext),
                    file_name: repo_key.clone(),
                }],
                &mut failed,
            )
            .await?;
        if failed.is_empty() {
            Ok(repo_key)
        } else {
            Err(anyhow!("Failed to store overlay {}", self.id))
        }
    }
}

impl ManifestAction {
    /// Build the Twirp ActionInput JSON for bulk registration.
    pub fn to_input(&self) -> super::db_proxy::ActionInputJson {
        super::db_proxy::ActionInputJson {
            name: self.name.clone(),
            description: self.description.clone(),
            call: self.call.clone(),
            params_schema: self.params.to_string(),
        }
    }

    #[allow(dead_code)]
    pub async fn process(&self) -> Result<()> {
        info!(
            "action stub: id={} call={} (DB/workflow registration not wired)",
            self.id, self.call
        );
        Ok(())
    }
}

impl ManifestCommand {
    pub async fn register(
        &self,
        module_name: &str,
        db_proxy_url: &str,
        application_id: &str,
    ) -> Result<()> {
        let command_name = self
            .pattern
            .strip_prefix('!')
            .unwrap_or(&self.pattern);

        let command_type = if self.workflow.is_some() {
            "function"
        } else {
            "text"
        };

        let type_value = if let Some(ref workflow) = self.workflow {
            workflow.clone()
        } else {
            format!("Module command: {} ({}). Configure a workflow to handle this command.", self.name, self.pattern)
        };

        super::db_proxy::create_command(
            db_proxy_url,
            application_id,
            command_name,
            command_type,
            &type_value,
            &format!("module:{}", module_name),
        )
        .await?;

        info!(
            "Registered command: {} [{}] (pattern={}, type={}, workflow={:?})",
            self.name,
            self.id,
            self.pattern,
            command_type,
            self.workflow
        );
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn process(&self) -> Result<()> {
        info!(
            "command stub: id={} pattern={} (use register() instead)",
            self.id, self.pattern
        );
        Ok(())
    }
}

impl ManifestWorkflow {
    pub async fn register(
        &self,
        module_name: &str,
        db_proxy_url: &str,
        application_id: &str,
    ) -> Result<()> {
        let step_id_prefix = format!("{}-{}-", module_name, self.id);
        let steps: Vec<woofx3::db::workflow::WorkflowStep> = self
            .steps
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let params_map: std::collections::HashMap<String, String> = match &s.params {
                    serde_json::Value::Object(map) => map
                        .iter()
                        .map(|(k, v)| (k.clone(), v.to_string()))
                        .collect(),
                    _ => std::collections::HashMap::new(),
                };
                woofx3::db::workflow::WorkflowStep {
                    id: format!("{}{}", step_id_prefix, i),
                    name: s.action.clone(),
                    description: format!("Action: {}", s.action),
                    r#type: s.action.clone(),
                    parameters: params_map,
                    on_success: String::new(),
                    on_failure: String::new(),
                    timeout_seconds: 0,
                    retry_attempts: 0,
                    r#async: false,
                    outputs: std::collections::HashMap::new(),
                }
            })
            .collect();

        let request = woofx3::db::workflow::CreateWorkflowRequest {
            name: format!("{}/{}", module_name, self.name),
            description: format!(
                "Module workflow: {} (trigger: {}, steps: {})",
                self.name,
                self.trigger,
                self.steps.len()
            ),
            application_id: application_id.to_string(),
            created_by: format!("module:{}", module_name),
            enabled: true,
            steps,
            variables: std::collections::HashMap::new(),
            on_success: String::new(),
            on_failure: String::new(),
            max_retries: 0,
            timeout_seconds: 0,
            created_by_type: "MODULE".to_string(),
            created_by_ref: module_name.to_string(),
        };

        let client = woofx3_twirp::WorkflowServiceClient::new(db_proxy_url);
        let response = client.create_workflow(request).await.map_err(|e| {
            anyhow!(
                "Failed to create workflow {}: {} (trigger={})",
                self.id,
                e,
                self.trigger
            )
        })?;

        if let Some(status) = response.status {
            if status.code != 0 {
                return Err(anyhow!(
                    "CreateWorkflow failed for {}: {}",
                    self.id,
                    status.message
                ));
            }
        }

        info!(
            "Registered workflow: {} [{}] (trigger={}, steps={})",
            self.name,
            self.id,
            self.trigger,
            self.steps.len()
        );
        Ok(())
    }

    pub async fn process(&self) -> Result<()> {
        info!(
            "workflow stub: id={} trigger={} steps={} (use register() instead)",
            self.id,
            self.trigger,
            self.steps.len()
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_spec_manifest_json() {
        let j = r#"{
            "id": "test-mod",
            "name": "Test Mod",
            "version": "1.0.0",
            "triggers": [{ "id": "twitch.foo", "name": "Foo", "description": "d", "type": "eventbus" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }],
            "widgets": [{ "id": "w1", "name": "W", "entry": "widgets/w1/index.html" }]
        }"#;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert_eq!(m.module_key(), "test-mod");
        assert_eq!(m.functions.len(), 1);
        assert_eq!(m.functions[0].id, "f1");
    }

    #[test]
    fn trigger_register_category_prefers_manifest_category() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "category": "platform.twitch"
        }))
        .expect("parse");
        assert_eq!(t.register_category(), "platform.twitch");
    }

    #[test]
    fn trigger_register_category_falls_back_to_type() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus"
        }))
        .expect("parse");
        assert_eq!(t.register_category(), "eventbus");
    }

    #[test]
    fn trigger_register_category_ignores_blank_category() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "category": "   "
        }))
        .expect("parse");
        assert_eq!(t.register_category(), "eventbus");
    }
}
