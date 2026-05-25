//! Hydrate the in-memory sandbox registry from db-proxy module rows and
//! function source bytes from the configured repository (file or S3).

use crate::services::module_service::db_proxy::{fetch_module_by_name, list_modules, ModuleRecord};
use lib_repository::Repository;
use lib_sandbox::models::function::Function;
use lib_sandbox::{ModuleMetadata, ModuleRegistry, ModuleState, RegisteredModule};
use log::{error, info, warn};
use std::collections::HashMap;

pub async fn hydrate_registry_from_db<R: Repository>(
    registry: &ModuleRegistry,
    db_proxy_url: &str,
    repository: &R,
) -> Result<(), String> {
    let modules = list_modules(db_proxy_url, Some("active"))
        .await
        .map_err(|e| e.to_string())?;

    if modules.is_empty() {
        info!("No active modules in db; sandbox registry is empty");
        return Ok(());
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
            Ok(registered) if registered.functions.is_empty() => {
                warn!(
                    "Module {} (id={}) has no runnable functions in repository; skipping registry entry",
                    module.name, registry_key
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
pub async fn refresh_module_in_registry<R: Repository>(
    registry: &ModuleRegistry,
    db_proxy_url: &str,
    module_name: &str,
    repository: &R,
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
    let function_count = registered.functions.len();
    if function_count == 0 {
        return Err(format!(
            "module '{}' (id={}) has no runnable functions (check file_key rows and repository)",
            module_name, registry_key
        ));
    }

    registry
        .register_module(registry_key.clone(), registered)
        .map_err(|e| e.to_string())?;

    info!(
        "Refreshed in-memory sandbox registry for id={} ({} function(s))",
        registry_key, function_count
    );
    Ok(())
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

fn function_manifest_id(row: &crate::services::module_service::db_proxy::ModuleFunctionRecord) -> String {
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
    row: &crate::services::module_service::db_proxy::ModuleFunctionRecord,
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
