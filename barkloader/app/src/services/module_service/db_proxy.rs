use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

/// Standard metadata that travels through service boundaries so downstream
/// services know who initiated the operation (mirrors common.RequestContext proto).
#[derive(Debug, Clone, Serialize)]
pub struct RequestContext {
    pub client_id: String,
    pub application_id: String,
    pub module_key: String,
}

#[derive(Debug, Serialize)]
pub struct CreateModuleFunctionJson {
    pub function_name: String,
    pub file_name: String,
    pub file_key: String,
    pub entry_point: String,
    pub runtime: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInputJson {
    pub category: String,
    pub name: String,
    pub description: String,
    pub event: String,
    pub config_schema: String,
    pub allow_variants: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionInputJson {
    pub name: String,
    pub description: String,
    pub call: String,
    pub params_schema: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterTriggersJson {
    pub module_key: String,
    pub module_name: String,
    pub version: String,
    pub triggers: Vec<TriggerInputJson>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterActionsJson {
    pub module_key: String,
    pub module_name: String,
    pub version: String,
    pub actions: Vec<ActionInputJson>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteByModuleIdJson {
    pub module_id: String,
}

/// Twirp JSON for `module.ModuleService/RegisterTriggers`.
pub async fn register_triggers(
    db_proxy_url: &str,
    module_key: &str,
    module_name: &str,
    version: &str,
    triggers: Vec<TriggerInputJson>,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/RegisterTriggers", db_proxy_url);
    let body = RegisterTriggersJson {
        module_key: module_key.to_string(),
        module_name: module_name.to_string(),
        version: version.to_string(),
        triggers,
    };
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("RegisterTriggers request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("RegisterTriggers failed {}: {}", status, text));
    }
    Ok(())
}

/// Twirp JSON for `module.ModuleService/RegisterActions`.
pub async fn register_actions(
    db_proxy_url: &str,
    module_key: &str,
    module_name: &str,
    version: &str,
    actions: Vec<ActionInputJson>,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/RegisterActions", db_proxy_url);
    let body = RegisterActionsJson {
        module_key: module_key.to_string(),
        module_name: module_name.to_string(),
        version: version.to_string(),
        actions,
    };
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("RegisterActions request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("RegisterActions failed {}: {}", status, text));
    }
    Ok(())
}

/// Twirp JSON for `module.ModuleService/DeleteTriggersByModuleId`.
/// Server-side prefix match on `created_by_ref LIKE '{module_id}:%'`.
pub async fn delete_triggers_by_module_id(
    db_proxy_url: &str,
    module_id: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/DeleteTriggersByModuleId", db_proxy_url);
    let body = DeleteByModuleIdJson { module_id: module_id.to_string() };
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("DeleteTriggersByModuleId request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeleteTriggersByModuleId failed {}: {}", status, text));
    }
    Ok(())
}

/// Twirp JSON for `module.ModuleService/DeleteActionsByModuleId`.
pub async fn delete_actions_by_module_id(
    db_proxy_url: &str,
    module_id: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/DeleteActionsByModuleId", db_proxy_url);
    let body = DeleteByModuleIdJson { module_id: module_id.to_string() };
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("DeleteActionsByModuleId request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeleteActionsByModuleId failed {}: {}", status, text));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct DeleteCommandsByModuleJson {
    pub module_name: String,
    pub application_id: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteWorkflowsByModuleJson {
    pub module_name: String,
    pub application_id: String,
}

#[derive(Debug, Serialize)]
pub struct GetModuleByNameJson {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommandJson {
    pub application_id: String,
    pub command: String,
    pub enabled: bool,
    pub cooldown: i32,
    #[serde(rename = "type")]
    pub command_type: String,
    pub type_value: String,
    pub priority: i32,
    pub created_by: String,
    pub created_by_type: String,
    pub created_by_ref: String,
}

/// Twirp JSON for `module.ModuleService/CreateModule`.
/// Returns the module ID from the created record.
///
/// `module_key` is the composite `{id}:{version}:{hash}` idempotency key
/// stored on the row — it is what the UI receives as `moduleKey` in
/// callbacks.
///
/// `client_id` is the CLIENT (UI instance) that initiated the install; it
/// is persisted as `created_by_ref` with `created_by_type = "CLIENT"` so we
/// can always trace a module back to the caller that installed it. A module
/// is owned by the client that installed it, not by another module.
pub async fn create_module(
    db_proxy_url: &str,
    name: &str,
    version: &str,
    manifest_json: &str,
    archive_key: &str,
    functions: &[CreateModuleFunctionJson],
    module_key: &str,
    client_id: &str,
) -> Result<String> {
    let url = format!("{}/twirp/module.ModuleService/CreateModule", db_proxy_url);
    let body = serde_json::json!({
        "name": name,
        "version": version,
        "manifest": manifest_json,
        "archive_key": archive_key,
        "functions": functions,
        "created_by_type": "CLIENT",
        "created_by_ref": client_id,
        "module_key": module_key,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("CreateModule request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("CreateModule failed {}: {}", status, text));
    }

    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| anyhow!("parse CreateModule response: {}", e))?;

    let module_id = value
        .get("module")
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(module_id)
}

/// Twirp JSON for `command.CommandService/CreateCommand`.
pub async fn create_command(
    db_proxy_url: &str,
    application_id: &str,
    command: &str,
    command_type: &str,
    type_value: &str,
    created_by: &str,
) -> Result<()> {
    let url = format!("{}/twirp/command.CommandService/CreateCommand", db_proxy_url);
    let body = CreateCommandJson {
        application_id: application_id.to_string(),
        command: command.to_string(),
        enabled: true,
        cooldown: 0,
        command_type: command_type.to_string(),
        type_value: type_value.to_string(),
        priority: 0,
        created_by: created_by.to_string(),
        created_by_type: "MODULE".to_string(),
        created_by_ref: created_by.trim_start_matches("module:").to_string(),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("CreateCommand request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("CreateCommand failed {}: {}", status, text));
    }

    Ok(())
}

/// Twirp JSON for finding commands by module and deleting them via pattern match.
pub async fn delete_commands_by_module(
    db_proxy_url: &str,
    application_id: &str,
    module_name: &str,
) -> Result<()> {
    let list_url = format!("{}/twirp/command.CommandService/ListCommands", db_proxy_url);
    let body = serde_json::json!({
        "application_id": application_id,
        "include_disabled": true
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&list_url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("ListCommands request failed: {}", e))?;

    if !response.status().is_success() {
        return Ok(());
    }

    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    let commands = value.get("commands").and_then(|c| c.as_array());
    let prefix = format!("module:{}", module_name);

    if let Some(cmds) = commands {
        for cmd in cmds {
            let created_by = cmd.get("created_by").and_then(|v| v.as_str()).unwrap_or("");
            if !created_by.starts_with(&prefix) {
                continue;
            }
            let id = match cmd.get("id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => continue,
            };

            let delete_url = format!("{}/twirp/command.CommandService/DeleteCommand", db_proxy_url);
            let delete_body = serde_json::json!({ "id": id });
            let _ = client
                .post(&delete_url)
                .header("Content-Type", "application/json")
                .json(&delete_body)
                .send()
                .await;
        }
    }

    Ok(())
}

/// Twirp JSON for finding workflows by module and deleting them.
pub async fn delete_workflows_by_module(
    db_proxy_url: &str,
    application_id: &str,
    module_name: &str,
) -> Result<()> {
    let list_url = format!("{}/twirp/workflow.WorkflowService/ListWorkflows", db_proxy_url);
    let body = serde_json::json!({
        "application_id": application_id
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&list_url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("ListWorkflows request failed: {}", e))?;

    if !response.status().is_success() {
        return Ok(());
    }

    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    let workflows = value.get("workflows").and_then(|w| w.as_array());
    let prefix = format!("module:{}", module_name);

    if let Some(wflows) = workflows {
        for wf in wflows {
            let created_by = wf.get("created_by").and_then(|v| v.as_str()).unwrap_or("");
            if !created_by.starts_with(&prefix) {
                continue;
            }
            let id = match wf.get("id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => continue,
            };

            let delete_url = format!("{}/twirp/workflow.WorkflowService/DeleteWorkflow", db_proxy_url);
            let delete_body = serde_json::json!({ "id": id });
            let _ = client
                .post(&delete_url)
                .header("Content-Type", "application/json")
                .json(&delete_body)
                .send()
                .await;
        }
    }

    Ok(())
}

/// Twirp JSON for `module.ModuleService/CreateModuleResource`.
pub async fn create_module_resource(
    db_proxy_url: &str,
    module_id: &str,
    resource_type: &str,
    resource_id: &str,
    manifest_id: &str,
    resource_name: &str,
    version: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/CreateModuleResource", db_proxy_url);
    let body = serde_json::json!({
        "module_id": module_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "manifest_id": manifest_id,
        "resource_name": resource_name,
        "version": version,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("CreateModuleResource request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("CreateModuleResource failed {}: {}", status, text));
    }

    Ok(())
}

/// Twirp JSON for `module.ModuleService/DeleteModuleResources`.
pub async fn delete_module_resources(
    db_proxy_url: &str,
    module_id: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/DeleteModuleResources", db_proxy_url);
    let body = serde_json::json!({
        "module_id": module_id,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("DeleteModuleResources request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeleteModuleResources failed {}: {}", status, text));
    }

    Ok(())
}

/// A single external reference to a module resource, mirrored from the
/// CheckModuleResourceUsage RPC response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageRef {
    #[serde(default)]
    pub source_type: String,
    #[serde(default, alias = "source_id")]
    pub source_id: String,
    #[serde(default)]
    pub source_name: String,
    #[serde(default)]
    pub context: String,
}

/// Grouping of every external reference to a single target resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    #[serde(default)]
    pub resource_id: String,
    #[serde(default)]
    pub resource_type: String,
    #[serde(default)]
    pub resource_name: String,
    #[serde(default)]
    pub used_by: Vec<UsageRef>,
}

/// Twirp JSON for `module.ModuleService/CheckModuleResourceUsage`.
pub async fn check_module_resource_usage(
    db_proxy_url: &str,
    module_id: &str,
    application_id: &str,
) -> Result<Vec<ResourceUsage>> {
    let url = format!(
        "{}/twirp/module.ModuleService/CheckModuleResourceUsage",
        db_proxy_url
    );
    let body = serde_json::json!({
        "module_id": module_id,
        "application_id": application_id,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("CheckModuleResourceUsage request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("CheckModuleResourceUsage failed {}: {}", status, text));
    }

    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| anyhow!("parse CheckModuleResourceUsage response: {}", e))?;

    let in_use = value.get("in_use").cloned().unwrap_or(serde_json::Value::Array(vec![]));
    let list: Vec<ResourceUsage> = serde_json::from_value(in_use)
        .map_err(|e| anyhow!("parse in_use array: {}", e))?;
    Ok(list)
}

/// Twirp JSON for `module.ModuleService/CompleteModuleDelete`.
pub async fn complete_module_delete(
    db_proxy_url: &str,
    module_id: &str,
    module_name: &str,
    status: &str,
    error_msg: &str,
    in_use: &[ResourceUsage],
    request_context: Option<&RequestContext>,
) -> Result<()> {
    let url = format!(
        "{}/twirp/module.ModuleService/CompleteModuleDelete",
        db_proxy_url
    );
    let mut body = serde_json::json!({
        "module_id": module_id,
        "module_name": module_name,
        "status": status,
        "error": error_msg,
        "in_use_resources": in_use,
    });
    if let Some(ctx) = request_context {
        body["request_context"] = serde_json::json!({
            "client_id": ctx.client_id,
            "application_id": ctx.application_id,
            "module_key": ctx.module_key,
        });
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("CompleteModuleDelete request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("CompleteModuleDelete failed {}: {}", status, text));
    }
    Ok(())
}

/// Twirp JSON for `module.ModuleService/DeleteModule`. Removes the module
/// row itself; functions cascade via FK, but triggers/actions/workflows/
/// commands and on-disk assets must be cleaned up before this is called.
pub async fn delete_module(db_proxy_url: &str, module_name: &str) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/DeleteModule", db_proxy_url);
    let body = serde_json::json!({ "name": module_name });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("DeleteModule request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeleteModule failed {}: {}", status, text));
    }
    Ok(())
}

/// Twirp JSON for `module.ModuleService/CompleteModuleInstall`.
/// `status` should be "completed" or "failed". `error_msg` is included for failures.
pub async fn complete_module_install(
    db_proxy_url: &str,
    module_id: &str,
    module_name: &str,
    version: &str,
    status: &str,
    error_msg: &str,
    request_context: Option<&RequestContext>,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/CompleteModuleInstall", db_proxy_url);
    let mut body = serde_json::json!({
        "module_id": module_id,
        "module_name": module_name,
        "version": version,
        "status": status,
        "error": error_msg,
    });
    if let Some(ctx) = request_context {
        body["request_context"] = serde_json::json!({
            "client_id": ctx.client_id,
            "application_id": ctx.application_id,
            "module_key": ctx.module_key,
        });
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("CompleteModuleInstall request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("CompleteModuleInstall failed {}: {}", status, text));
    }

    Ok(())
}

/// Twirp JSON for `module.ModuleService/GetModuleByName`.
#[allow(dead_code)]
pub async fn get_module_by_name(
    db_proxy_url: &str,
    name: &str,
) -> Result<Option<String>> {
    let url = format!("{}/twirp/module.ModuleService/GetModuleByName", db_proxy_url);
    let body = GetModuleByNameJson {
        name: name.to_string(),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("GetModuleByName request failed: {}", e))?;

    if response.status() == 404 {
        return Ok(None);
    }

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("GetModuleByName failed {}: {}", status, text));
    }

    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| anyhow!("parse GetModuleByName response: {}", e))?;

    Ok(Some(text))
}
