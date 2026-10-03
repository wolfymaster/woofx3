//! Hydrate the in-memory sandbox registry from db-proxy module rows and
//! function source bytes from the configured repository (file or S3).

use crate::db_proxy::{
    BackgroundTaskJson, ModuleRecord, fetch_module_by_name, list_background_tasks, list_modules,
};
use crate::module_manifest::{ManifestBackgroundTask, ManifestDeadline, ModuleManifest};
use lib_repository::Repository;
use lib_sandbox::models::function::Function;
use lib_sandbox::{ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule};
use std::collections::{HashMap, HashSet};
use tracing::{error, info, warn};

/// Everything a module declares for the scheduler: cron background tasks
/// and the deadlines its functions may schedule.
#[derive(Debug, Clone, Default)]
pub struct ModuleSchedule {
    pub background_tasks: Vec<ManifestBackgroundTask>,
    pub deadlines: Vec<ManifestDeadline>,
}

impl ModuleSchedule {
    pub fn is_empty(&self) -> bool {
        self.background_tasks.is_empty() && self.deadlines.is_empty()
    }
}

/// Host-owned schedule registration. Implemented by the barkloader app's
/// `ModuleScheduler` so `lib_module` does not depend on Actix or the
/// scheduler loop itself.
///
/// `register` replaces whatever the module had: every pending entry is
/// dropped, including deadlines its functions scheduled. A module that needs
/// them back re-arms them from a `runOnLoad` task.
pub trait ScheduleRegistrar: Send + Sync {
    fn register(&self, module_key: &str, schedule: &ModuleSchedule);
    fn unregister(&self, module_key: &str);
}

impl<T: ScheduleRegistrar + ?Sized> ScheduleRegistrar for std::sync::Arc<T> {
    fn register(&self, module_key: &str, schedule: &ModuleSchedule) {
        (**self).register(module_key, schedule);
    }

    fn unregister(&self, module_key: &str) {
        (**self).unregister(module_key);
    }
}

pub async fn hydrate_registry_from_db<R: Repository, S: ScheduleRegistrar>(
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
            warn!(
                "Failed to fetch background tasks from db; no tasks will be scheduled: {}",
                e
            );
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
                    let tasks = tasks_by_module
                        .get(&registry_key)
                        .map(Vec::as_slice)
                        .unwrap_or_default();
                    let schedule = module_schedule(&module, tasks);
                    if !schedule.is_empty() {
                        scheduler.register(&registry_key, &schedule);
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
pub async fn refresh_module_in_registry<R: Repository, S: ScheduleRegistrar>(
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
            let tasks: Vec<BackgroundTaskJson> = all_tasks
                .into_iter()
                .filter(|t| t.module_id == registry_key)
                .collect();
            scheduler.register(&registry_key, &module_schedule(&module, &tasks));
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

/// The scheduler's input for one module.
///
/// Background tasks come from their db rows, as they always have; `runOnLoad`
/// and `deadlines` are read from the stored manifest, which already carries
/// them, rather than widening the background task table for a flag and
/// adding a table for declarations only this process reads. A module with no
/// readable manifest schedules its cron tasks and nothing else.
fn module_schedule(module: &ModuleRecord, tasks: &[BackgroundTaskJson]) -> ModuleSchedule {
    let manifest = stored_manifest(module);
    let run_on_load: HashSet<&str> = manifest
        .iter()
        .flat_map(|m| m.background_tasks.iter())
        .filter(|task| task.run_on_load)
        .map(|task| task.id.as_str())
        .collect();
    let background_tasks = tasks
        .iter()
        .map(|task| ManifestBackgroundTask {
            id: task.manifest_id.clone(),
            function: task.function.clone(),
            schedule: task.schedule.clone(),
            description: task.description.clone(),
            run_on_load: run_on_load.contains(task.manifest_id.as_str()),
        })
        .collect();
    let deadlines = manifest
        .as_ref()
        .map(|m| m.deadlines.clone())
        .unwrap_or_default();
    ModuleSchedule {
        background_tasks,
        deadlines,
    }
}

/// The module's manifest as stored at install, or `None` when it is missing
/// or unreadable.
fn stored_manifest(module: &ModuleRecord) -> Option<ModuleManifest> {
    let raw = module
        .manifest_json
        .as_deref()
        .filter(|raw| !raw.is_empty())?;
    match serde_json::from_str::<ModuleManifest>(raw) {
        Ok(manifest) => Some(manifest),
        Err(err) => {
            warn!("Module {} has an unreadable manifest: {}", module.name, err);
            None
        }
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
        event_types: eventbus_event_types(module),
        permissions: declared_permissions(module),
        url_settings: url_setting_ids(module),
        oauth: stored_manifest(module)
            .map(|manifest| manifest.oauth)
            .unwrap_or_default(),
        actions: function_actions(module),
    })
}

/// Action id to the function it runs, for the module's function actions, read
/// from its stored manifest: what `ctx.resources.run` may run. A cross-module
/// function reference is left out, since `run` runs only the code the
/// providing module ships, and so is a `systemOnly` action, which module code
/// may not reach by any route (see docs/services/engine-integrity.md).
fn function_actions(module: &ModuleRecord) -> HashMap<String, String> {
    stored_manifest(module)
        .map(|manifest| {
            manifest
                .actions
                .into_iter()
                .filter(|action| !action.system_only)
                .filter_map(|action| match action.implementation {
                    crate::module_manifest::ManifestActionImpl::Function { function }
                        if !function.contains(':') =>
                    {
                        Some((action.id, function))
                    }
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The events of the module's eventbus triggers, read from its stored
/// manifest. A manifest that is missing or unreadable yields none, so the
/// module's functions can publish nothing rather than anything.
fn eventbus_event_types(module: &ModuleRecord) -> HashSet<String> {
    let Some(manifest) = stored_manifest(module) else {
        return HashSet::new();
    };
    manifest
        .triggers
        .into_iter()
        .filter(|trigger| trigger.trigger_type == "eventbus" && !trigger.event.is_empty())
        .map(|trigger| trigger.event)
        .collect()
}

/// The permissions the module's stored manifest declares. A manifest that is
/// missing or unreadable grants none, so its privileged calls are refused.
fn declared_permissions(module: &ModuleRecord) -> HashSet<String> {
    stored_manifest(module)
        .map(|manifest| manifest.permissions.into_iter().collect())
        .unwrap_or_default()
}

/// The ids of the module's `url` settings, whose values' origins its
/// `ctx.http` may reach.
fn url_setting_ids(module: &ModuleRecord) -> HashSet<String> {
    stored_manifest(module)
        .map(|manifest| {
            manifest
                .settings
                .into_iter()
                .filter(|setting| setting.setting_type == crate::module_manifest::URL_SETTING_TYPE)
                .map(|setting| setting.id)
                .collect()
        })
        .unwrap_or_default()
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

/// Drop everything a module has scheduled. Call this when the module is
/// uninstalled so stale tasks and deadlines don't keep firing.
pub fn unregister_schedule<S: ScheduleRegistrar>(scheduler: &S, module_key: &str) {
    scheduler.unregister(module_key);
}

#[cfg(test)]
mod tests {
    use super::{
        BackgroundTaskJson, ModuleRecord, declared_permissions, eventbus_event_types,
        function_actions, functions_failed_to_load, module_schedule,
    };

    fn module_with_manifest(manifest_json: Option<&str>) -> ModuleRecord {
        ModuleRecord {
            id: "row-1".into(),
            module_id: "woofx3".into(),
            module_key: String::new(),
            name: "woofx3".into(),
            version: "1.0.0".into(),
            state: "active".into(),
            functions: Vec::new(),
            manifest_json: manifest_json.map(String::from),
        }
    }

    #[test]
    fn a_module_may_publish_the_events_of_its_eventbus_triggers_only() {
        let manifest = r#"{ "id": "woofx3", "name": "woofx3", "triggers": [
            { "id": "a", "name": "A", "type": "eventbus", "event": "counter.changed" },
            { "id": "b", "name": "B", "type": "webhook", "handler": "h" }
        ] }"#;
        let events = eventbus_event_types(&module_with_manifest(Some(manifest)));
        assert_eq!(
            events,
            ["counter.changed".to_string()].into_iter().collect()
        );
    }

    // What `ctx.resources.run` may run: the module's own function actions,
    // never a `systemOnly` one or another module's function.
    #[test]
    fn runnable_actions_are_the_modules_own_function_actions_but_not_system_only_ones() {
        let manifest = r#"{ "id": "woofx3", "name": "woofx3",
            "functions": [{ "id": "timer.add", "name": "Add", "runtime": "js", "path": "f.js" }],
            "actions": [
                { "id": "timer.add", "name": "Add", "type": "function", "function": "timer.add" },
                { "id": "danger", "name": "Danger", "type": "function", "function": "timer.add", "systemOnly": true },
                { "id": "borrowed", "name": "Borrowed", "type": "function", "function": "other:function:x" },
                { "id": "alert", "name": "Alert", "type": "native", "handler": "alert" }
            ] }"#;
        let actions = function_actions(&module_with_manifest(Some(manifest)));
        assert_eq!(
            actions,
            [("timer.add".to_string(), "timer.add".to_string())].into_iter().collect()
        );
    }

    #[test]
    fn a_missing_or_unreadable_manifest_allows_no_events() {
        assert!(eventbus_event_types(&module_with_manifest(None)).is_empty());
        assert!(eventbus_event_types(&module_with_manifest(Some("not json"))).is_empty());
    }

    #[test]
    fn a_module_holds_the_permissions_its_stored_manifest_declares() {
        let manifest =
            r#"{ "id": "woofx3", "name": "woofx3", "permissions": ["twitch.moderation"] }"#;
        assert_eq!(
            declared_permissions(&module_with_manifest(Some(manifest))),
            ["twitch.moderation".to_string()].into_iter().collect()
        );
        assert!(declared_permissions(&module_with_manifest(None)).is_empty());
    }

    fn task_row(manifest_id: &str) -> BackgroundTaskJson {
        BackgroundTaskJson {
            id: format!("row-{manifest_id}"),
            module_id: "woofx3".into(),
            manifest_id: manifest_id.into(),
            name: manifest_id.into(),
            description: String::new(),
            function: "timer.reconcile".into(),
            schedule: "* * * * *".into(),
        }
    }

    #[test]
    fn the_schedule_takes_run_on_load_and_deadlines_from_the_stored_manifest() {
        let manifest = r#"{ "id": "woofx3", "name": "woofx3",
            "backgroundTasks": [
                { "id": "reconcile", "function": "timer.reconcile", "schedule": "* * * * *", "runOnLoad": true },
                { "id": "sweep", "function": "timer.reconcile", "schedule": "* * * * *" }
            ],
            "deadlines": [{ "id": "timer_end", "function": "timer.expire", "maxPending": 8 }]
        }"#;
        let schedule = module_schedule(
            &module_with_manifest(Some(manifest)),
            &[task_row("reconcile"), task_row("sweep")],
        );
        let flags: Vec<(&str, bool)> = schedule
            .background_tasks
            .iter()
            .map(|t| (t.id.as_str(), t.run_on_load))
            .collect();
        assert_eq!(flags, vec![("reconcile", true), ("sweep", false)]);
        assert_eq!(schedule.deadlines.len(), 1);
        assert_eq!(schedule.deadlines[0].max_pending, 8);
    }

    #[test]
    fn without_a_manifest_the_schedule_is_the_cron_rows_alone() {
        let schedule = module_schedule(&module_with_manifest(None), &[task_row("sweep")]);
        assert_eq!(schedule.background_tasks.len(), 1);
        assert!(!schedule.background_tasks[0].run_on_load);
        assert!(schedule.deadlines.is_empty());
    }

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
