//! Hydrate the in-memory sandbox registry from db-proxy module rows and
//! function source bytes from the configured repository (file or S3).

use crate::db_proxy::{
    fetch_module_by_name, list_background_tasks, list_modules, BackgroundTaskJson, ModuleRecord,
};
use crate::module_manifest::ManifestBackgroundTask;
use lib_repository::Repository;
use lib_sandbox::models::function::Function;
use lib_sandbox::{ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule};
use tracing::{error, info, warn};
use std::collections::HashMap;

/// Host-owned background task registration. Implemented by the barkloader
/// app's `BackgroundTaskScheduler` so `lib_module` does not depend on Actix
/// or the cron loop itself.
pub trait BackgroundTaskRegistrar: Send + Sync {
    fn register(&self, module_key: &str, task_defs: &[ManifestBackgroundTask]);
    fn unregister(&self, module_key: &str);
}

impl<T: BackgroundTaskRegistrar + ?Sized> BackgroundTaskRegistrar for std::sync::Arc<T> {
    fn register(&self, module_key: &str, task_defs: &[ManifestBackgroundTask]) {
        (**self).register(module_key, task_defs);
    }

    fn unregister(&self, module_key: &str) {
        (**self).unregister(module_key);
    }
}

pub async fn hydrate_registry_from_db<R: Repository, S: BackgroundTaskRegistrar>(
    registry: &ModuleRegistry,
    db_proxy_url: &str,
    repository: &R,
    scheduler: &S,
) -> Result<(), String> {
    let modules = list_modules(db_proxy_url, Some("active"))
        .await
        .map_err(|e| e.to_string())?;

    if modules.is_empty() {
        info!("No active modules in db; sandbox registry is empty");
        return Ok(());
    }

    // Fetch all registered background tasks once and group by stable module id.
    // Tasks are keyed on module_id (first segment of created_by_ref) so they
    // match the registry_key used below.
    let all_tasks = match list_background_tasks(db_proxy_url).await {
        Ok(tasks) => tasks,
        Err(e) => {
            warn!("Failed to fetch background tasks from db; no tasks will be scheduled: {}", e);
            Vec::new()
        }
    };
    let mut tasks_by_module: HashMap<String, Vec<BackgroundTaskJson>> = HashMap::new();
    for task in all_tasks {
        tasks_by_module
            .entry(task.module_id.clone())
            .or_default()
            .push(task);
    }

    let mut loaded = 0usize;
    for module in modules {
        let registry_key = registry_key_for_module(&module);
        if registry_key.is_empty() {
            warn!(
                "Skipping module row {}: empty module_id and cannot derive registry key",
                module.name
            );
            continue;
        }
        match build_registered_module(&module, repository).await {
            // Declared functions that all failed to load is a broken install;
            // declaring none at all is a legitimate module (actions, triggers
            // and widgets need no sandbox code). `module.functions` is what the
            // manifest declared, so the two cases are distinguishable here -
            // `registered.functions` alone cannot tell them apart.
            Ok(registered)
                if functions_failed_to_load(module.functions.len(), registered.functions.len()) =>
            {
                warn!(
                    "Module {} (id={}) declared {} function(s) but none could be loaded from the repository; skipping registry entry",
                    module.name,
                    registry_key,
                    module.functions.len()
                );
            }
            Ok(registered) => {
                let function_count = registered.functions.len();
                let state = module.state.clone();
                if let Err(err) = registry.register_module(registry_key.clone(), registered) {
                    error!("Failed to register module {}: {}", registry_key, err);
                } else {
                    loaded += 1;
                    info!(
                        "Loaded module {} display_name={} ({} function(s), state={})",
                        registry_key, module.name, function_count, state
                    );
                    if let Some(tasks) = tasks_by_module.get(&registry_key) {
                        let task_defs: Vec<ManifestBackgroundTask> =
                            tasks.iter().map(db_task_to_manifest).collect();
                        scheduler.register(&registry_key, &task_defs);
                    }
                }
            }
            Err(err) => {
                error!(
                    "Failed to build sandbox module {} (display_name={}): {}",
                    registry_key, module.name, err
                );
            }
        }
    }

    info!(
        "Boot complete: {} active module(s) registered in sandbox",
        loaded
    );
    Ok(())
}

/// Reload one module into the registry after install, register, or rollback.
pub async fn refresh_module_in_registry<R: Repository, S: BackgroundTaskRegistrar>(
    registry: &ModuleRegistry,
    db_proxy_url: &str,
    module_name: &str,
    repository: &R,
    scheduler: &S,
) -> Result<(), String> {
    let module = fetch_module_by_name(db_proxy_url, module_name)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("module '{}' not found in db", module_name))?;

    let registry_key = registry_key_for_module(&module);
    if registry_key.is_empty() {
        return Err(format!(
            "module '{}' has no module_id in db (reinstall to populate)",
            module_name
        ));
    }

    let registered = build_registered_module(&module, repository).await?;
    // A declarations-only module registers with an empty function map. Only a
    // module that declared functions and loaded none of them is an error -
    // invoking an absent function id already fails cleanly as "not found".
    if functions_failed_to_load(module.functions.len(), registered.functions.len()) {
        return Err(format!(
            "module '{}' (id={}) declared {} function(s) but none could be loaded (check file_key rows and repository)",
            module_name,
            registry_key,
            module.functions.len()
        ));
    }

    let function_count = registered.functions.len();
    registry
        .register_module(registry_key.clone(), registered)
        .map_err(|e| e.to_string())?;

    // Fetch all background tasks and pick the ones for this module. The task
    // count is small enough that a full fetch is cheaper than a dedicated RPC.
    match list_background_tasks(db_proxy_url).await {
        Ok(all_tasks) => {
            let task_defs: Vec<ManifestBackgroundTask> = all_tasks
                .iter()
                .filter(|t| t.module_id == registry_key)
                .map(db_task_to_manifest)
                .collect();
            scheduler.register(&registry_key, &task_defs);
        }
        Err(e) => {
            warn!(
                "Failed to fetch background tasks for module {}; no tasks scheduled: {}",
                registry_key, e
            );
        }
    }

    info!(
        "Refreshed in-memory sandbox registry for id={} ({} function(s))",
        registry_key, function_count
    );
    Ok(())
}

/// Whether a module's function set means the install is broken.
///
/// A module that declares no sandboxed functions is a first-class module, not
/// a degraded one: actions, triggers and widgets need no sandbox code, and the
/// bundled system modules are entirely declarations. It registers with an
/// empty function map, and invoking a function id on it fails as "not found"
/// like any other unknown id.
///
/// What is broken is declaring functions and loading none of them - a missing
/// `file_key` row or an empty repository. `RegisteredModule::functions` alone
/// cannot tell the two apart, which is why both counts are passed in.
fn functions_failed_to_load(declared: usize, loaded: usize) -> bool {
    declared > 0 && loaded == 0
}

/// Manifest-local module id used as the in-memory registry key (matches
/// canonical id prefix, e.g. twitch_platform).
fn registry_key_for_module(module: &ModuleRecord) -> String {
    if !module.module_id.is_empty() {
        return module.module_id.clone();
    }
    // Legacy rows before module_id column: first segment of module_key.
    module
        .module_key
        .split(':')
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

/// Convert a DB background task row into the scheduler's input type.
fn db_task_to_manifest(task: &BackgroundTaskJson) -> ManifestBackgroundTask {
    ManifestBackgroundTask {
        id: task.manifest_id.clone(),
        function: task.function.clone(),
        schedule: task.schedule.clone(),
        description: task.description.clone(),
    }
}

async fn build_registered_module<R: Repository>(
    module: &ModuleRecord,
    repository: &R,
) -> Result<RegisteredModule, String> {
    let registry_key = registry_key_for_module(module);
    let mut functions = HashMap::new();

    for row in &module.functions {
        let function_id = function_manifest_id(row);
        if function_id.is_empty() {
            warn!(
                "Skipping function on module {}: no manifest_id (file_key={})",
                module.name, row.file_key
            );
            continue;
        }
        match load_sandbox_function(repository, &registry_key, row, &function_id).await {
            Ok(function) => {
                info!(
                    "Registered sandbox function module={} id={} entry_point={} file_key={}",
                    registry_key,
                    function_id,
                    function.resolved_entry_point(),
                    row.file_key
                );
                functions.insert(function_id, function);
            }
            Err(err) => {
                warn!(
                    "Skipping function {} on module {}: {}",
                    function_id, module.name, err
                );
            }
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    Ok(RegisteredModule {
        metadata: ModuleMetadata {
            name: registry_key.clone(),
            version: module.version.clone(),
            installed_at: now,
            updated_at: now,
        },
        functions,
        state: registry_state_from_db(&module.state),
    })
}

fn function_manifest_id(row: &crate::db_proxy::ModuleFunctionRecord) -> String {
    if !row.manifest_id.is_empty() {
        return row.manifest_id.clone();
    }
    if !row.name.is_empty() {
        return row.name.clone();
    }
    row.file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem.to_string())
        .unwrap_or_else(|| row.file_name.clone())
}

async fn load_sandbox_function<R: Repository>(
    repository: &R,
    module_name: &str,
    row: &crate::db_proxy::ModuleFunctionRecord,
    function_id: &str,
) -> Result<Function, String> {
    if row.file_key.is_empty() {
        return Err("file_key is empty".to_string());
    }

    let bytes = repository
        .read_file(&row.file_key)
        .await
        .map_err(|e| format!("repository read {}: {}", row.file_key, e))?;

    let entry_point = if row.entry_point.is_empty() {
        function_id.to_string()
    } else {
        row.entry_point.clone()
    };

    if entry_point.is_empty() {
        return Err(format!(
            "function {} on module {} has no entry_point",
            function_id, module_name
        ));
    }

    Ok(Function::new_with_entry_point(
        function_id.to_string(),
        row.file_name.clone(),
        String::from_utf8_lossy(&bytes).to_string(),
        false,
        Some(entry_point),
    ))
}

fn registry_state_from_db(state: &str) -> ModuleState {
    if state == "disabled" {
        ModuleState::Disabled
    } else {
        ModuleState::Active
    }
}

/// Cancel all background tasks for a module. Call this when the module is
/// uninstalled or deactivated so stale tasks don't keep firing.
pub fn unregister_background_tasks<S: BackgroundTaskRegistrar>(scheduler: &S, module_key: &str) {
    scheduler.unregister(module_key);
}

#[cfg(test)]
mod tests {
    use super::functions_failed_to_load;

    #[test]
    fn a_module_declaring_no_functions_is_not_broken() {
        // The bundled system modules are declarations only.
        assert!(!functions_failed_to_load(0, 0));
    }

    #[test]
    fn declaring_functions_and_loading_none_is_broken() {
        // A missing file_key row or an empty repository.
        assert!(functions_failed_to_load(3, 0));
    }

    #[test]
    fn loading_some_of_what_was_declared_is_not_fatal() {
        // Individual load failures are already warned about per function; the
        // module still has runnable code, so it registers.
        assert!(!functions_failed_to_load(3, 1));
    }

    #[test]
    fn loading_everything_declared_is_not_broken() {
        assert!(!functions_failed_to_load(2, 2));
    }
}
