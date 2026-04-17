// Module deletion pipeline.
//
// Mirrors the install architecture: `ModuleDeletePlan::build()` resolves the
// module and its tracked resources from db-proxy, then `execute()` runs one
// concrete `DeletableResource` per resource type in a fixed dependency-safe
// order (commands → workflows → actions → triggers → widgets/overlays →
// functions → archive → module resources ledger → module row).
//
// The usage check is performed before any deletion so callers can abort and
// return `DeleteError::InUse(list)` without touching any state.

use anyhow::{anyhow, Result};
use lib_repository::Repository;
use lib_sandbox::ModuleRegistry;
use log::{info, warn};
use std::sync::Arc;

use super::db_proxy::{
    self, complete_module_delete, delete_actions_by_module_id, delete_commands_by_module,
    delete_module, delete_module_resources, delete_triggers_by_module_id, delete_workflows_by_module,
    check_module_resource_usage, get_module_by_name, ResourceUsage,
};

pub struct DeleteContext<'a, R: Repository> {
    pub db_proxy_url: &'a str,
    pub application_id: Option<&'a str>,
    pub module_id: &'a str,
    pub module_name: &'a str,
    pub module_key: &'a str,
    /// The manifest id (first segment of `module_key`). This is what child
    /// resources — triggers, actions, commands, workflows — were registered
    /// against as `created_by_ref`, so by-module deletes must filter on this,
    /// not on `module_name` (which can differ from the manifest id).
    pub manifest_id: &'a str,
    pub repository: &'a R,
}

#[derive(Debug)]
pub enum DeleteError {
    /// One or more resources owned by the module are referenced externally.
    InUse(Vec<ResourceUsage>),
    /// Any other failure while executing a step.
    Other(anyhow::Error),
}

impl From<anyhow::Error> for DeleteError {
    fn from(e: anyhow::Error) -> Self {
        DeleteError::Other(e)
    }
}

impl std::fmt::Display for DeleteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeleteError::InUse(list) => write!(
                f,
                "{} resource(s) still in use by external references",
                list.len()
            ),
            DeleteError::Other(e) => write!(f, "{}", e),
        }
    }
}

impl std::error::Error for DeleteError {}

/// Describes a single removal step. Higher `priority` runs first — dependents
/// must be removed before the things they depend on so deletes never leave
/// dangling references.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum DeleteStep {
    Commands,
    Workflows,
    Actions,
    Triggers,
    WidgetFiles,
    OverlayFiles,
    FunctionFiles,
    Archive,
    ModuleResourcesLedger,
    ModuleRecord,
    UnregisterSandbox,
}

impl DeleteStep {
    fn priority(&self) -> u32 {
        match self {
            DeleteStep::Commands => 100,
            DeleteStep::Workflows => 90,
            DeleteStep::Actions => 80,
            DeleteStep::Triggers => 70,
            DeleteStep::WidgetFiles => 55,
            DeleteStep::OverlayFiles => 50,
            DeleteStep::FunctionFiles => 40,
            DeleteStep::Archive => 30,
            DeleteStep::ModuleResourcesLedger => 20,
            DeleteStep::ModuleRecord => 10,
            DeleteStep::UnregisterSandbox => 5,
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            DeleteStep::Commands => "commands",
            DeleteStep::Workflows => "workflows",
            DeleteStep::Actions => "actions",
            DeleteStep::Triggers => "triggers",
            DeleteStep::WidgetFiles => "widget_files",
            DeleteStep::OverlayFiles => "overlay_files",
            DeleteStep::FunctionFiles => "function_files",
            DeleteStep::Archive => "archive",
            DeleteStep::ModuleResourcesLedger => "module_resources_ledger",
            DeleteStep::ModuleRecord => "module_record",
            DeleteStep::UnregisterSandbox => "unregister_sandbox",
        }
    }
}

pub struct ModuleDeletePlan {
    pub module_id: String,
    pub module_name: String,
    pub module_key: String,
    pub steps: Vec<DeleteStep>,
}

impl ModuleDeletePlan {
    pub fn new(module_id: String, module_name: String, module_key: String) -> Self {
        let mut steps = vec![
            DeleteStep::Commands,
            DeleteStep::Workflows,
            DeleteStep::Actions,
            DeleteStep::Triggers,
            DeleteStep::WidgetFiles,
            DeleteStep::OverlayFiles,
            DeleteStep::FunctionFiles,
            DeleteStep::Archive,
            DeleteStep::ModuleResourcesLedger,
            DeleteStep::UnregisterSandbox,
            DeleteStep::ModuleRecord,
        ];
        steps.sort_by(|a, b| b.priority().cmp(&a.priority()));
        Self {
            module_id,
            module_name,
            module_key,
            steps,
        }
    }

    pub async fn execute<R: Repository>(
        &self,
        ctx: &DeleteContext<'_, R>,
        registry: Arc<ModuleRegistry>,
    ) -> Result<()> {
        for step in &self.steps {
            info!("module delete step: {} (priority {})", step.kind(), step.priority());
            if let Err(e) = self.run_step(step, ctx, &registry).await {
                return Err(anyhow!("step {} failed: {}", step.kind(), e));
            }
        }
        Ok(())
    }

    async fn run_step<R: Repository>(
        &self,
        step: &DeleteStep,
        ctx: &DeleteContext<'_, R>,
        registry: &Arc<ModuleRegistry>,
    ) -> Result<()> {
        match step {
            DeleteStep::Commands => {
                if let Some(app_id) = ctx.application_id {
                    delete_commands_by_module(ctx.db_proxy_url, app_id, ctx.manifest_id).await?;
                }
                Ok(())
            }
            DeleteStep::Workflows => {
                if let Some(app_id) = ctx.application_id {
                    delete_workflows_by_module(ctx.db_proxy_url, app_id, ctx.manifest_id).await?;
                }
                Ok(())
            }
            DeleteStep::Actions => {
                delete_actions_by_module_id(ctx.db_proxy_url, ctx.manifest_id).await
            }
            DeleteStep::Triggers => {
                delete_triggers_by_module_id(ctx.db_proxy_url, ctx.manifest_id).await
            }
            DeleteStep::WidgetFiles => {
                let prefix = format!("modules/{}/widgets/", ctx.module_key);
                ctx.repository
                    .delete_prefix(&prefix)
                    .map_err(|e| anyhow!("delete widget prefix {}: {}", prefix, e))
            }
            DeleteStep::OverlayFiles => {
                let prefix = format!("modules/{}/overlays/", ctx.module_key);
                ctx.repository
                    .delete_prefix(&prefix)
                    .map_err(|e| anyhow!("delete overlay prefix {}: {}", prefix, e))
            }
            DeleteStep::FunctionFiles => {
                // The install path uploads function files under modules/{module_key}/functions/
                // and the whole module tree lives under modules/{module_key}. We clear the
                // entire module tree here so stray files (e.g. accidentally retained assets)
                // do not linger after delete.
                let prefix = format!("modules/{}", ctx.module_key);
                ctx.repository
                    .delete_prefix(&prefix)
                    .map_err(|e| anyhow!("delete module file prefix {}: {}", prefix, e))
            }
            DeleteStep::Archive => {
                let key = format!("archives/{}.zip", ctx.module_key);
                // delete_prefix handles single files too after the lib_repository change.
                ctx.repository
                    .delete_prefix(&key)
                    .map_err(|e| anyhow!("delete archive {}: {}", key, e))
            }
            DeleteStep::ModuleResourcesLedger => {
                delete_module_resources(ctx.db_proxy_url, ctx.module_id).await
            }
            DeleteStep::ModuleRecord => {
                delete_module(ctx.db_proxy_url, ctx.module_name).await
            }
            DeleteStep::UnregisterSandbox => {
                if let Err(e) = registry.unregister_module(ctx.module_name) {
                    // Not fatal: the module may never have been registered in this process.
                    warn!("unregister_module({}) failed: {}", ctx.module_name, e);
                }
                Ok(())
            }
        }
    }
}

/// Identity for a module we have looked up, returned by `resolve_module`.
/// Callers use this to populate the `RequestContext` before any work that
/// could fail, so the completion callback always carries the module_key.
#[derive(Debug, Clone)]
pub struct ResolvedModule {
    pub module_id: String,
    pub module_key: String,
    /// First segment of `module_key` ({id}:{version}:{hash}) — the manifest
    /// id used as `created_by_ref` on child resources (triggers, actions,
    /// commands, workflows) at install time.
    pub manifest_id: String,
}

/// Extract the manifest id (first segment) from a composite module_key of
/// the form `{id}:{version}:{hash}`. Falls back to the whole key if it is
/// not colon-delimited (legacy rows written before the composite format).
fn manifest_id_from_module_key(module_key: &str) -> String {
    match module_key.split_once(':') {
        Some((id, _)) if !id.is_empty() => id.to_string(),
        _ => module_key.to_string(),
    }
}

/// Look up a module by name and return its id + module_key.
///
/// Returns `Ok(None)` when the module does not exist — deletion callers
/// should treat that as the desired end state (idempotent delete) rather
/// than an error. `Err` is reserved for genuine resolution failures
/// (malformed response, network error, empty id on an existing row).
///
/// Separated from the delete pipeline so the caller can set
/// `request_context.module_key` before running the usage check or executing
/// the plan — both of which can fail and still need the key in their
/// webhook callback.
pub async fn resolve_module(
    db_proxy_url: &str,
    module_name: &str,
) -> Result<Option<ResolvedModule>> {
    let resolved = get_module_by_name(db_proxy_url, module_name).await?;
    let Some(body) = resolved else {
        return Ok(None);
    };

    let value: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| anyhow!("parse module response: {}", e))?;

    let module_id = value
        .get("module")
        .and_then(|m| m.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let module_key = value
        .get("module")
        .and_then(|m| m.get("module_key"))
        .and_then(|v| v.as_str())
        .unwrap_or(module_name)
        .to_string();

    if module_id.is_empty() {
        return Err(anyhow!("module {} resolved but id is empty", module_name));
    }

    let manifest_id = manifest_id_from_module_key(&module_key);
    Ok(Some(ResolvedModule { module_id, module_key, manifest_id }))
}

/// Run the usage check and execute the delete plan for a module whose identity
/// has already been resolved. The resolution step is deliberately factored out
/// so callers can set `request_context.module_key` before entering this
/// function — any error here still reports with the key populated.
pub async fn run_delete_resolved<R: Repository>(
    resolved: &ResolvedModule,
    module_name: &str,
    db_proxy_url: &str,
    application_id: Option<&str>,
    repository: &R,
    registry: Arc<ModuleRegistry>,
) -> Result<(), DeleteError> {
    // 1) usage check — abort if any external references exist
    let usage = check_module_resource_usage(
        db_proxy_url,
        &resolved.module_id,
        application_id.unwrap_or(""),
    )
    .await
    .map_err(DeleteError::Other)?;
    if !usage.is_empty() {
        return Err(DeleteError::InUse(usage));
    }

    // 2) execute plan
    let plan = ModuleDeletePlan::new(
        resolved.module_id.clone(),
        module_name.to_string(),
        resolved.module_key.clone(),
    );
    let ctx = DeleteContext {
        db_proxy_url,
        application_id,
        module_id: &resolved.module_id,
        module_name,
        module_key: &resolved.module_key,
        manifest_id: &resolved.manifest_id,
        repository,
    };
    plan.execute(&ctx, registry).await.map_err(DeleteError::Other)?;

    Ok(())
}

/// Send the completion callback. Wraps `complete_module_delete` so routes do
/// not need to know the Twirp details.
pub async fn notify_delete(
    db_proxy_url: &str,
    module_id: &str,
    module_name: &str,
    status: &str,
    error: &str,
    in_use: &[ResourceUsage],
    request_context: Option<&db_proxy::RequestContext>,
) {
    if let Err(e) = complete_module_delete(
        db_proxy_url,
        module_id,
        module_name,
        status,
        error,
        in_use,
        request_context,
    )
    .await
    {
        warn!(
            "CompleteModuleDelete failed for {}/{}: {}",
            module_name, status, e
        );
    }
}
