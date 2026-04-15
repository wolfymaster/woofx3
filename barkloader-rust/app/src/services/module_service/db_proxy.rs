use anyhow::{anyhow, Result};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CreateModuleFunctionJson {
    pub function_name: String,
    pub file_name: String,
    pub file_key: String,
    pub entry_point: String,
    pub runtime: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteTriggersByModuleJson {
    pub module_name: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteActionsByModuleJson {
    pub module_name: String,
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
pub struct RegisterActionJson {
    pub module_name: String,
    pub name: String,
    pub description: String,
    pub call: String,
    pub params_schema: String,
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
}

/// Twirp JSON for `module.ModuleService/CreateModule`.
pub async fn create_module(
    db_proxy_url: &str,
    name: &str,
    version: &str,
    manifest_json: &str,
    archive_key: &str,
    functions: &[CreateModuleFunctionJson],
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/CreateModule", db_proxy_url);
    let body = serde_json::json!({
        "name": name,
        "version": version,
        "manifest": manifest_json,
        "archive_key": archive_key,
        "functions": functions,
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

    Ok(())
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

/// Twirp JSON for `module.ModuleService/RegisterAction`.
pub async fn register_action(
    db_proxy_url: &str,
    module_name: &str,
    name: &str,
    description: &str,
    call: &str,
    params_schema: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/RegisterAction", db_proxy_url);
    let body = RegisterActionJson {
        module_name: module_name.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        call: call.to_string(),
        params_schema: params_schema.to_string(),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("RegisterAction request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("RegisterAction failed {}: {}", status, text));
    }

    Ok(())
}

/// Twirp JSON for `module.ModuleService/DeleteTriggersByModule`.
pub async fn delete_triggers_by_module(
    db_proxy_url: &str,
    module_name: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/DeleteTriggersByModule", db_proxy_url);
    let body = DeleteTriggersByModuleJson {
        module_name: module_name.to_string(),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("DeleteTriggersByModule request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeleteTriggersByModule failed {}: {}", status, text));
    }

    Ok(())
}

/// Twirp JSON for `module.ModuleService/DeleteActionsByModule`.
pub async fn delete_actions_by_module(
    db_proxy_url: &str,
    module_name: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/DeleteActionsByModule", db_proxy_url);
    let body = DeleteActionsByModuleJson {
        module_name: module_name.to_string(),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("DeleteActionsByModule request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeleteActionsByModule failed {}: {}", status, text));
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
