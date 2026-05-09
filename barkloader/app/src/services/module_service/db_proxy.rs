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
    /// Stable manifest-local function id (e.g. "play_alert"). Forms
    /// the canonical id `{moduleId}:function:{manifest_id}`. Renamed
    /// from `function_name` to align with the triggers / actions
    /// `manifest_id` columns.
    pub manifest_id: String,
    /// Display name from the manifest (`functions[].name`); presentation only.
    pub name: String,
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
    /// Stable manifest-local id (e.g. "channel_subscribe"). Forms the
    /// canonical id `{moduleId}:trigger:{manifest_id}` together with the
    /// moduleId segment of the row's `created_by_ref`. Required for the
    /// dedupe/upsert key on the triggers table.
    pub manifest_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionInputJson {
    pub name: String,
    pub description: String,
    pub call: String,
    pub params_schema: String,
    /// Stable manifest-local id (e.g. "play_alert"). Forms the canonical
    /// id `{moduleId}:action:{manifest_id}`. Required for the
    /// dedupe/upsert key on the actions table.
    pub manifest_id: String,
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
    // Optional (MODULE, module_key) override. Both empty -> db-proxy falls
    // back to (MODULE, module_key). Both set -> non-module namespace
    // (e.g. SYSTEM:builtin) upsert key.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub created_by_type: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub created_by_ref: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteByModuleIdJson {
    pub module_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetInputJson {
    /// Stable manifest-local id (e.g. "raid_counter"). Forms the canonical
    /// id `{moduleId}:widget:{manifest_id}`. Required for the dedupe/upsert
    /// key on the widgets table.
    pub manifest_id: String,
    pub name: String,
    pub description: String,
    /// Path inside the module zip that contains the widget's bundled
    /// frontend assets. Engine uploads everything under this prefix to the
    /// file repository at install time (see `ModuleWidget::upload_assets`).
    pub directory: String,
    /// Wire-format AlertContext.type strings the widget renders. Derived
    /// from manifest `accepted_events` via the canonical → alert-type
    /// lookup, or supplied explicitly by manifest `alert_types`.
    pub alert_types: Vec<String>,
    /// Serialized JSON of the manifest's `settingsSchema` field. Engine
    /// stores opaquely; UI parses to render configuration controls.
    pub settings_schema: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterWidgetsJson {
    pub module_key: String,
    pub module_name: String,
    pub version: String,
    pub widgets: Vec<WidgetInputJson>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub created_by_type: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub created_by_ref: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInputJson {
    /// Stable manifest-local id (e.g. "victory_sound"). Forms the
    /// canonical id `{moduleId}:asset:{manifest_id}`.
    pub manifest_id: String,
    pub name: String,
    pub description: String,
    /// Original path declared in `manifest.json`. Preserved for
    /// diagnostics and the editor's asset picker display.
    pub manifest_path: String,
    /// Repository key the engine wrote the bytes to (e.g.
    /// `modules/<moduleKey>/assets/<path>`). Resolving this to a
    /// public URL is the deployer's concern.
    pub repository_key: String,
    /// Free-form category hint: `image` | `audio` | `video` | `font`
    /// | `data`. Optional.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub kind: String,
    /// Optional MIME type override declared in the manifest.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub content_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterAssetsJson {
    pub module_key: String,
    pub module_name: String,
    pub version: String,
    pub assets: Vec<AssetInputJson>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub created_by_type: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub created_by_ref: String,
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
    register_actions_with(
        db_proxy_url,
        module_key,
        module_name,
        version,
        actions,
        "",
        "",
    )
    .await
}

/// Twirp JSON for `module.ModuleService/RegisterActions` with an explicit
/// (created_by_type, created_by_ref) override. When both overrides are
/// empty, the db-proxy falls back to the default (MODULE, module_key)
/// pairing — behaviorally identical to the non-`_with` variant.
pub async fn register_actions_with(
    db_proxy_url: &str,
    module_key: &str,
    module_name: &str,
    version: &str,
    actions: Vec<ActionInputJson>,
    created_by_type: &str,
    created_by_ref: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/RegisterActions", db_proxy_url);
    let body = RegisterActionsJson {
        module_key: module_key.to_string(),
        module_name: module_name.to_string(),
        version: version.to_string(),
        actions,
        created_by_type: created_by_type.to_string(),
        created_by_ref: created_by_ref.to_string(),
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

/// Twirp JSON for `module.ModuleService/RegisterWidgets`. Mirrors
/// `register_triggers` / `register_actions` — the db-proxy persists rows,
/// emits `db.module.widget.registered.{appId}` on the NATS outbox, and the
/// api/ TypeScript service forwards the resulting `module.widget.registered`
/// CallbackEvent to the registered Convex webhook.
///
/// Wired pending the Go server-side handler — see
/// `~/.claude/plans/widget-producer-wiring.md` for the full execution plan.
/// Calling this against an engine that hasn't shipped the Go handler will
/// 404; install_flow integration is gated on that.
pub async fn register_widgets(
    db_proxy_url: &str,
    module_key: &str,
    module_name: &str,
    version: &str,
    widgets: Vec<WidgetInputJson>,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/RegisterWidgets", db_proxy_url);
    let body = RegisterWidgetsJson {
        module_key: module_key.to_string(),
        module_name: module_name.to_string(),
        version: version.to_string(),
        widgets,
        created_by_type: String::new(),
        created_by_ref: String::new(),
    };
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("RegisterWidgets request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("RegisterWidgets failed {}: {}", status, text));
    }
    Ok(())
}

/// Twirp JSON for `module.ModuleService/DeleteWidgetsByModuleId`.
/// Server-side prefix match on `created_by_ref LIKE '{module_id}:%'`.
pub async fn delete_widgets_by_module_id(
    db_proxy_url: &str,
    module_id: &str,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/DeleteWidgetsByModuleId", db_proxy_url);
    let body = DeleteByModuleIdJson { module_id: module_id.to_string() };
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("DeleteWidgetsByModuleId request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeleteWidgetsByModuleId failed {}: {}", status, text));
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
/// Resolve a cross-module trigger reference. Returns the trigger row's
/// `event` field (the NATS subject the engine must subscribe to when a
/// workflow names this trigger via `$ref`). Used by the install path
/// when a bundled workflow's `trigger` is a canonical id pointing at
/// another module.
pub async fn get_trigger_event_by_canonical_id(
    db_proxy_url: &str,
    canonical_id: &str,
) -> Result<String> {
    let url = format!(
        "{}/twirp/module.ModuleService/GetTriggerByCanonicalId",
        db_proxy_url
    );
    let body = serde_json::json!({ "canonical_id": canonical_id });
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("GetTriggerByCanonicalId request failed: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "GetTriggerByCanonicalId({canonical_id}) failed {}: {}",
            status,
            text
        ));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| anyhow!("parse GetTriggerByCanonicalId response: {}", e))?;
    value
        .get("trigger")
        .and_then(|t| t.get("event"))
        .and_then(|e| e.as_str())
        .map(str::to_owned)
        .ok_or_else(|| {
            anyhow!(
                "GetTriggerByCanonicalId({canonical_id}) response missing trigger.event"
            )
        })
}

/// Resolved cross-module action: the engine handler the action
/// dispatches to (`type` column), and the canonical function id when
/// `type == "function"` (the `call` column). For non-function
/// handlers (e.g. `alert`) `function_call` is `None`.
pub struct ResolvedActionRef {
    pub action_type: String,
    pub function_call: Option<String>,
}

/// Resolve a cross-module action reference. Reads the action row's
/// `type` (engine handler) and `call` (canonical function id, when
/// type is `function`). Used by the install path when a bundled
/// workflow step references an action from another module.
pub async fn get_action_ref_by_canonical_id(
    db_proxy_url: &str,
    canonical_id: &str,
) -> Result<ResolvedActionRef> {
    let url = format!(
        "{}/twirp/module.ModuleService/GetActionByCanonicalId",
        db_proxy_url
    );
    let body = serde_json::json!({ "canonical_id": canonical_id });
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("GetActionByCanonicalId request failed: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "GetActionByCanonicalId({canonical_id}) failed {}: {}",
            status,
            text
        ));
    }
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| anyhow!("parse GetActionByCanonicalId response: {}", e))?;
    let action = value
        .get("action")
        .ok_or_else(|| anyhow!("GetActionByCanonicalId({canonical_id}) response missing `action`"))?;
    // `type` defaults to "function" when absent — covers older db
    // rows that predate the type column.
    let action_type = action
        .get("type")
        .and_then(|t| t.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("function")
        .to_string();
    let call = action
        .get("call")
        .and_then(|c| c.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let function_call = if action_type == "function" {
        Some(call.ok_or_else(|| {
            anyhow!(
                "action {canonical_id} has type=function but `call` is empty"
            )
        })?)
    } else {
        None
    };
    Ok(ResolvedActionRef {
        action_type,
        function_call,
    })
}

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

/// Twirp JSON for `module.ModuleService/RegisterAssets`. Mirrors
/// `register_actions` — idempotent upsert keyed on
/// (created_by_type, created_by_ref, manifest_id) on the server side.
pub async fn register_assets(
    db_proxy_url: &str,
    module_key: &str,
    module_name: &str,
    version: &str,
    assets: Vec<AssetInputJson>,
) -> Result<()> {
    let url = format!("{}/twirp/module.ModuleService/RegisterAssets", db_proxy_url);
    let body = RegisterAssetsJson {
        module_key: module_key.to_string(),
        module_name: module_name.to_string(),
        version: version.to_string(),
        assets,
        created_by_type: String::new(),
        created_by_ref: String::new(),
    };
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("RegisterAssets request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("RegisterAssets failed {}: {}", status, text));
    }
    Ok(())
}

// -----------------------------------------------------------------------
// Resource-instance lifecycle.
//
// The runtime-instance kind system (see `module_resource_instance.proto`).
// Modules call these from sandbox host primitives (`ctx.resources.*`)
// when their commands create or delete instances of declared kinds. The
// engine learns identity (canonical id, owning module); semantics live in
// the calling module.
// -----------------------------------------------------------------------

/// Brief view of a resource instance returned by list/get RPCs. Mirrors
/// the proto `ModuleResourceInstance` message but only deserializes the
/// fields the sandbox actually needs (canonical_id and the parts that
/// reconstruct it). Extra fields on the wire are ignored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceInstanceJson {
    pub id: String,
    pub module_id: String,
    pub module_name: String,
    pub kind: String,
    pub instance_id: String,
    pub display_name: String,
    pub canonical_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceInstanceResponseJson {
    instance: Option<ResourceInstanceJson>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListResourceInstancesResponseJson {
    #[serde(default)]
    instances: Vec<ResourceInstanceJson>,
}

/// Twirp JSON for `module.ModuleService/CreateResourceInstance`. Returns
/// the persisted row including its derived canonical id, which callers
/// typically use as the storage key for the instance's value.
///
/// Pass either `module_id` (UUID, when known) or `module_name` (manifest
/// id, when known) — server resolves whichever is non-empty. Sandbox
/// callers (`ctx.resources.create`) typically only know the manifest id;
/// install-time callers usually have the UUID. Pass empty strings for
/// the unused argument.
pub async fn create_resource_instance(
    db_proxy_url: &str,
    module_id: &str,
    module_name: &str,
    kind: &str,
    instance_id: &str,
    display_name: &str,
    request_context: Option<&RequestContext>,
) -> Result<ResourceInstanceJson> {
    let url = format!(
        "{}/twirp/module.ModuleService/CreateResourceInstance",
        db_proxy_url
    );
    let body = serde_json::json!({
        "module_id": module_id,
        "module_name": module_name,
        "kind": kind,
        "instance_id": instance_id,
        "display_name": display_name,
        "request_context": request_context,
    });
    let response = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("CreateResourceInstance request failed: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("CreateResourceInstance failed {}: {}", status, text));
    }
    let parsed: ResourceInstanceResponseJson = response
        .json()
        .await
        .map_err(|e| anyhow!("parse CreateResourceInstance response: {}", e))?;
    parsed
        .instance
        .ok_or_else(|| anyhow!("CreateResourceInstance returned no instance"))
}

/// Twirp JSON for `module.ModuleService/DeleteResourceInstance`. Idempotent
/// from the caller's perspective — a NotFound from the server is surfaced
/// as a normal error since a missing instance usually indicates a bug in
/// the calling code.
pub async fn delete_resource_instance(
    db_proxy_url: &str,
    canonical_id: &str,
    request_context: Option<&RequestContext>,
) -> Result<()> {
    let url = format!(
        "{}/twirp/module.ModuleService/DeleteResourceInstance",
        db_proxy_url
    );
    let body = serde_json::json!({
        "canonical_id": canonical_id,
        "request_context": request_context,
    });
    let response = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("DeleteResourceInstance request failed: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeleteResourceInstance failed {}: {}", status, text));
    }
    Ok(())
}

/// Twirp JSON for `module.ModuleService/ListResourceInstancesByKind`.
/// Returns every instance of the kind across every installed module — the
/// flat list the UI picker for `resource_ref(kind=...)` ConfigField
/// values consumes.
pub async fn list_resource_instances_by_kind(
    db_proxy_url: &str,
    kind: &str,
) -> Result<Vec<ResourceInstanceJson>> {
    let url = format!(
        "{}/twirp/module.ModuleService/ListResourceInstancesByKind",
        db_proxy_url
    );
    let body = serde_json::json!({ "kind": kind });
    let response = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("ListResourceInstancesByKind request failed: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "ListResourceInstancesByKind failed {}: {}",
            status,
            text
        ));
    }
    let parsed: ListResourceInstancesResponseJson = response
        .json()
        .await
        .map_err(|e| anyhow!("parse ListResourceInstancesByKind response: {}", e))?;
    Ok(parsed.instances)
}

/// Twirp JSON for `module.ModuleService/ListResourceInstancesByModule`.
/// Used at uninstall time to surface or cascade-delete the instances a
/// module owns.
pub async fn list_resource_instances_by_module(
    db_proxy_url: &str,
    module_id: &str,
) -> Result<Vec<ResourceInstanceJson>> {
    let url = format!(
        "{}/twirp/module.ModuleService/ListResourceInstancesByModule",
        db_proxy_url
    );
    let body = serde_json::json!({ "module_id": module_id });
    let response = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!("ListResourceInstancesByModule request failed: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "ListResourceInstancesByModule failed {}: {}",
            status,
            text
        ));
    }
    let parsed: ListResourceInstancesResponseJson = response
        .json()
        .await
        .map_err(|e| anyhow!("parse ListResourceInstancesByModule response: {}", e))?;
    Ok(parsed.instances)
}
