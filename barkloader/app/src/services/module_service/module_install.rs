use anyhow::{anyhow, Result};
use lib_repository::Repository;
use log::{info, warn};
use std::collections::HashMap;
use std::path::Path;

use super::db_proxy::{create_module, create_module_resource, CreateModuleFunctionJson};
use super::manifest_validate::{self, ResolvedActionImpl};
use super::module_file::ModuleFile;
use super::module_manifest::{ModuleManifest, ResolvedWorkflowStep, ResolvedWorkflowTrigger};

pub async fn cleanup_old_version(
    module_name: &str,
    db_proxy_url: Option<&str>,
    application_id: &str,
) -> Result<()> {
    let url = match db_proxy_url {
        Some(u) => u,
        None => return Ok(()),
    };

    super::db_proxy::delete_triggers_by_module_id(url, module_name).await?;
    super::db_proxy::delete_actions_by_module_id(url, module_name).await?;
    super::db_proxy::delete_widgets_by_module_id(url, module_name).await?;
    super::db_proxy::delete_background_tasks_by_module_id(url, module_name).await?;
    info!("Deleted triggers, actions, widgets, and background tasks for module {}", module_name);

    super::db_proxy::delete_workflows_by_module(url, "", module_name).await?;
    info!("Deleted workflows for module {}", module_name);

    super::db_proxy::delete_commands_by_module(url, module_name).await?;
    info!("Deleted commands for module {}", module_name);

    Ok(())
}

/// Compensating cleanup for a half-completed install. Called when any db-side
/// step after `create_module` fails so the next install attempt doesn't trip
/// the `modules_name_key` unique constraint. Each step is best-effort — a
/// cleanup error is logged and suppressed so the original install error
/// surfaces to the caller.
async fn rollback_db_install(
    db_proxy_url: &str,
    manifest_module_key: &str,
    module_name: &str,
    application_id: &str,
) {
    if let Err(e) =
        cleanup_old_version(manifest_module_key, Some(db_proxy_url), application_id).await
    {
        warn!(
            "rollback: cleanup_old_version({}) failed: {}",
            manifest_module_key, e
        );
    }
    if let Err(e) = super::db_proxy::delete_module(db_proxy_url, module_name).await {
        warn!("rollback: delete_module({}) failed: {}", module_name, e);
    } else {
        info!("rollback: removed module row for {}", module_name);
    }
}

/// Extracts `module.manifest` (the raw manifest JSON string stored at
/// install time) from a `GetModuleByModuleId`/`GetModuleByName` Twirp JSON
/// response body. Returns `None` if the shape doesn't match — treated the
/// same as "no previous install" by callers.
fn extract_stored_manifest_json(module_response_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(module_response_json).ok()?;
    value
        .get("module")?
        .get("manifest")?
        .as_str()
        .map(|s| s.to_string())
}

/// Diffs two manifests' declared resource ids, kind by kind, and returns
/// every `(resource_type, manifest_id)` present in `old` but absent from
/// `new` — i.e. every resource the upgrade should archive (or, for
/// background_task, hard-delete — see `prune_removed_resources`).
///
/// Covers triggers, actions, widgets, functions, and background tasks —
/// the kinds a workflow/command can reference by canonical id at
/// creation *and* execution time, where deleting a removed one would
/// break anything still pointing at it. Assets are deliberately excluded:
/// nothing resolves an asset by canonical id at runtime (a workflow's
/// `${woofx3_asset_url:...}` reference is already a concrete URL by the
/// time it's baked in), so an asset dropped from the manifest is simply
/// left alone — not archived, not deleted.
fn removed_manifest_ids(old: &ModuleManifest, new: &ModuleManifest) -> Vec<(&'static str, String)> {
    fn removed<'a>(
        old_ids: impl Iterator<Item = &'a str>,
        new_ids: &std::collections::HashSet<&str>,
    ) -> Vec<String> {
        old_ids
            .filter(|id| !new_ids.contains(id))
            .map(|id| id.to_string())
            .collect()
    }

    let mut out = Vec::new();

    let new_triggers: std::collections::HashSet<&str> =
        new.triggers.iter().map(|t| t.id.as_str()).collect();
    out.extend(
        removed(old.triggers.iter().map(|t| t.id.as_str()), &new_triggers)
            .into_iter()
            .map(|id| ("trigger", id)),
    );

    let new_actions: std::collections::HashSet<&str> =
        new.actions.iter().map(|a| a.id.as_str()).collect();
    out.extend(
        removed(old.actions.iter().map(|a| a.id.as_str()), &new_actions)
            .into_iter()
            .map(|id| ("action", id)),
    );

    let new_widgets: std::collections::HashSet<&str> =
        new.widgets.iter().map(|w| w.id.as_str()).collect();
    out.extend(
        removed(old.widgets.iter().map(|w| w.id.as_str()), &new_widgets)
            .into_iter()
            .map(|id| ("widget", id)),
    );

    let new_functions: std::collections::HashSet<&str> =
        new.functions.iter().map(|f| f.id.as_str()).collect();
    out.extend(
        removed(old.functions.iter().map(|f| f.id.as_str()), &new_functions)
            .into_iter()
            .map(|id| ("function", id)),
    );

    let new_background_tasks: std::collections::HashSet<&str> =
        new.background_tasks.iter().map(|t| t.id.as_str()).collect();
    out.extend(
        removed(old.background_tasks.iter().map(|t| t.id.as_str()), &new_background_tasks)
            .into_iter()
            .map(|id| ("background_task", id)),
    );

    out
}

/// Fetches the previously installed version of this module (by stable
/// manifest id) and, for every trigger/action/widget/function/
/// background_task that existed in that version but is absent from
/// `new_manifest`: archives it (background_task is hard-deleted instead
/// — see `db_proxy::delete_resource_by_manifest_id`'s doc comment for
/// why that one kind is safe to delete outright). Archiving keeps a
/// removed resource resolvable by canonical id, so any workflow or
/// command that already references it keeps working, while hiding it
/// from catalog listings going forward. A fresh install (no previous
/// version, or an unparseable stored manifest) is a no-op.
async fn prune_removed_resources(
    db_proxy_url: &str,
    module_key: &str,
    new_manifest: &ModuleManifest,
) {
    let prev_response = match super::db_proxy::get_module_by_module_id(db_proxy_url, module_key).await {
        Ok(Some(body)) => body,
        Ok(None) => return,
        Err(e) => {
            warn!("prune_removed_resources: lookup failed for {}: {}", module_key, e);
            return;
        }
    };

    let Some(prev_manifest_json) = extract_stored_manifest_json(&prev_response) else {
        return;
    };

    let prev_manifest: ModuleManifest = match serde_json::from_str(&prev_manifest_json) {
        Ok(m) => m,
        Err(e) => {
            warn!("prune_removed_resources: failed to parse stored manifest for {}: {}", module_key, e);
            return;
        }
    };

    for (resource_type, manifest_id) in removed_manifest_ids(&prev_manifest, new_manifest) {
        let result = if resource_type == "background_task" {
            super::db_proxy::delete_resource_by_manifest_id(db_proxy_url, module_key, resource_type, &manifest_id)
                .await
        } else {
            super::db_proxy::archive_resource_by_manifest_id(db_proxy_url, module_key, resource_type, &manifest_id)
                .await
        };
        if let Err(e) = result {
            warn!(
                "prune_removed_resources: failed to remove {} {} for {}: {}",
                resource_type, manifest_id, module_key, e
            );
        } else {
            info!(
                "Removed {} '{}' from module {} (dropped from manifest)",
                resource_type, manifest_id, module_key
            );
        }
    }
}

async fn validate_cross_module_dependencies(
    db_proxy_url: &str,
    resolved: &manifest_validate::ResolvedManifest,
) -> Result<()> {
    use std::collections::HashSet;

    let mut missing: Vec<String> = Vec::new();
    let mut checked: HashSet<String> = HashSet::new();

    for wf in &resolved.workflows {
        let canonical = &wf.trigger;
        if canonical.module_id() == resolved.module_id
            || canonical.module_id() == "builtin"
            || !checked.insert(canonical.to_string())
        {
            continue;
        }
        if let Err(e) =
            super::db_proxy::get_trigger_event_by_canonical_id(db_proxy_url, &canonical.to_string())
                .await
        {
            missing.push(format!(
                "workflow '{}' → trigger '{}' ({})",
                wf.canonical_id.resource_id(),
                canonical,
                e
            ));
        }
    }

    for widget in &resolved.widgets {
        for event in &widget.accepted_events {
            if event.module_id() == resolved.module_id
                || event.module_id() == "builtin"
                || !checked.insert(event.to_string())
            {
                continue;
            }
            if let Err(e) =
                super::db_proxy::get_trigger_event_by_canonical_id(db_proxy_url, &event.to_string())
                    .await
            {
                missing.push(format!(
                    "widget '{}' → trigger '{}' ({})",
                    widget.canonical_id.resource_id(),
                    event,
                    e
                ));
            }
        }
    }

    for wf in &resolved.workflows {
        for (si, action_canonical) in wf.step_actions.iter().enumerate() {
            if action_canonical.module_id() == resolved.module_id
                || action_canonical.module_id() == "builtin"
                || !checked.insert(action_canonical.to_string())
            {
                continue;
            }
            if let Err(e) = super::db_proxy::get_action_ref_by_canonical_id(
                db_proxy_url,
                &action_canonical.to_string(),
            )
            .await
            {
                missing.push(format!(
                    "workflow '{}' step #{} → action '{}' ({})",
                    wf.canonical_id.resource_id(),
                    si,
                    action_canonical,
                    e
                ));
            }
        }
    }

    if !missing.is_empty() {
        return Err(anyhow!(
            "Module depends on resources from other modules that are not installed:\n  - {}",
            missing.join("\n  - ")
        ));
    }

    Ok(())
}

pub async fn run_install<R: Repository>(
    manifest: &ModuleManifest,
    files: &[ModuleFile],
    repository: &R,
    archive_key: &str,
    db_proxy_url: Option<&str>,
    application_id: &str,
    cleanup_old: bool,
    composite_module_key: &str,
    client_id: &str,
) -> Result<()> {
    // `module_key` here is the manifest id (used for file paths and as the
    // module_name-style ref passed to child resource registrations).
    // `composite_module_key` is the `{id}:{version}:{hash}` idempotency key
    // that gets persisted on the module row and is the actual `moduleKey`
    // returned to the UI — these two are NOT the same.
    let module_key = manifest.module_key();

    // Validate the manifest and resolve every intra-manifest reference
    // before any side effect runs. Validation enforces the canonical-id
    // contract documented in `docs/barkloader/modules.md`: required ids,
    // valid characters, per-kind uniqueness, resolvable references. Any
    // failure here aborts the install with no DB or filesystem state
    // touched.
    let resolved = manifest_validate::validate(manifest)
        .map_err(|e| anyhow!("manifest validation failed: {}", e))?;

    if let Some(url) = db_proxy_url {
        validate_cross_module_dependencies(url, &resolved).await?;

        // Diff against the previously installed version (if any) and
        // prune anything the new manifest no longer declares, before
        // registering what it does declare. This is what makes an
        // upgrade converge to exactly the new manifest's resource set
        // instead of only ever adding/updating.
        if !cleanup_old {
            prune_removed_resources(url, module_key, manifest).await;
        }
    }

    let mut fn_rows: Vec<CreateModuleFunctionJson> =
        Vec::with_capacity(manifest.functions.len());

    for f in &manifest.functions {
        let file_key = f.upload_to_repository(&module_key, files, repository).await?;
        let file_name = Path::new(&f.path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("function")
            .to_string();
        fn_rows.push(CreateModuleFunctionJson {
            manifest_id: f.id.clone(),
            name: f.name.clone(),
            file_name,
            file_key,
            entry_point: f.entry_point.clone().unwrap_or_default(),
            runtime: f.runtime.clone(),
        });
    }

    for w in &manifest.widgets {
        w.upload_assets(&module_key, files, repository).await?;
    }

    for o in &manifest.overlays {
        o.upload_entry(&module_key, files, repository).await?;
    }

    // Upload static assets declared in manifest.assets[]. Each asset
    // is written to the repository under `modules/<moduleKey>/<path>`
    // (path already carries its own directory, e.g. `assets/bell.mp3`
    // — see ManifestAsset::upload_to_repository) and the resulting key
    // is captured for the RegisterAssets call further down.
    let mut asset_keys: Vec<String> = Vec::with_capacity(manifest.assets.len());
    for a in &manifest.assets {
        let repo_key = a.upload_to_repository(&module_key, files, repository).await?;
        asset_keys.push(repo_key);
    }
    // Manifest-local asset id -> repository key, used to bake
    // `${asset:<id>}` markers in workflow step parameters into
    // `${woofx3_asset_url:<repositoryKey>}` at registration time (see
    // ManifestWorkflow::register / encode_asset_url_markers).
    let asset_repo_keys: HashMap<String, String> = manifest
        .assets
        .iter()
        .zip(asset_keys.iter())
        .map(|(a, key)| (a.id.clone(), key.clone()))
        .collect();

    if let Some(url) = db_proxy_url {
        if cleanup_old {
            cleanup_old_version(module_key, Some(url), application_id).await?;
        }

        // Saga-style install: every step after `create_module` must be paired
        // with a compensating cleanup if the install fails partway through.
        // We run the whole db-side sequence inside an async block so a single
        // rollback path handles any failure.
        let install_result: Result<()> = async {
            let manifest_json = serde_json::to_string(manifest)
                .map_err(|e| anyhow!("serialize manifest: {}", e))?;
            let db_record_id = create_module(
                url,
                &manifest.name,
                module_key,
                &manifest.version,
                &manifest_json,
                archive_key,
                &fn_rows,
                composite_module_key,
                client_id,
            )
            .await?;

            // Record function resources in ledger. `resource_name` is the
            // canonical id — that's the value the in-use check and any
            // future reference resolution joins on. `manifest_id` keeps
            // the author's local id for debugging / display.
            for (i, f) in manifest.functions.iter().enumerate() {
                let canonical = resolved.functions[i].canonical_id.to_string();
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "function", "", &f.id, &canonical, &manifest.version,
                ).await {
                    warn!("Failed to record function resource {}: {}", canonical, e);
                }
            }

            // Record widget resources in ledger
            for (i, w) in manifest.widgets.iter().enumerate() {
                let canonical = resolved.widgets[i].canonical_id.to_string();
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "widget", "", &w.id, &canonical, &manifest.version,
                ).await {
                    warn!("Failed to record widget resource {}: {}", canonical, e);
                }
            }

            // Record overlay resources in ledger
            for (i, o) in manifest.overlays.iter().enumerate() {
                let canonical = resolved.overlays[i].canonical_id.to_string();
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "overlay", "", &o.id, &canonical, &manifest.version,
                ).await {
                    warn!("Failed to record overlay resource {}: {}", canonical, e);
                }
            }

            // Register triggers as a single bulk call keyed by the composite module_key.
            // The trigger row's `event` field is the actual NATS subject
            // the trigger fires on (publishers emit on this subject;
            // workflows subscribe to it). The trigger's *canonical id*
            // (`{moduleId}:trigger:{id}`) is recorded separately in the
            // module_resources ledger as `resource_name`, and referenced
            // from workflow `$ref` fields — never on the trigger row.
            let trigger_inputs: Vec<_> = manifest
                .triggers
                .iter()
                .map(|t| t.to_input())
                .collect();
            info!(
                "Registering {} trigger(s) for module {} (moduleKey={})",
                trigger_inputs.len(),
                module_key,
                composite_module_key
            );
            super::db_proxy::register_triggers(
                url,
                module_key,
                &manifest.name,
                &manifest.version,
                trigger_inputs,
                "",
            )
            .await?;

            // Ledger rows record one resource per trigger, keyed by canonical id.
            for (i, t) in manifest.triggers.iter().enumerate() {
                let canonical = resolved.triggers[i].canonical_id.to_string();
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "trigger", "", &t.id, &canonical, &manifest.version,
                ).await {
                    warn!("Failed to record trigger resource {}: {}", canonical, e);
                }
            }

            // Register actions as a single bulk call keyed by the composite module_key.
            // The action's `call` field is the resolved canonical function
            // id of the action's resolved implementation.
            let action_inputs: Vec<_> = manifest
                .actions
                .iter()
                .enumerate()
                .map(|(i, a)| {
                    let resolved_call = match &resolved.actions[i].implementation {
                        ResolvedActionImpl::Function { canonical_function_id } => {
                            canonical_function_id.to_string()
                        }
                    };
                    a.to_input(&resolved_call)
                })
                .collect();
            info!(
                "Registering {} action(s) for module {} (moduleKey={})",
                action_inputs.len(),
                module_key,
                composite_module_key
            );
            super::db_proxy::register_actions(
                url,
                module_key,
                &manifest.name,
                &manifest.version,
                action_inputs,
                "",
            )
            .await?;

            for (i, a) in manifest.actions.iter().enumerate() {
                let canonical = resolved.actions[i].canonical_id.to_string();
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "action", "", &a.id, &canonical, &manifest.version,
                ).await {
                    warn!("Failed to record action resource {}: {}", canonical, e);
                }
            }

            if !manifest.widgets.is_empty() {
                let widget_inputs: Vec<_> = manifest.widgets.iter().map(|w| w.to_input()).collect();
                info!(
                    "Registering {} widget(s) for module {} (moduleKey={})",
                    widget_inputs.len(),
                    module_key,
                    composite_module_key
                );
                super::db_proxy::register_widgets(
                    url,
                    module_key,
                    &manifest.name,
                    &manifest.version,
                    widget_inputs,
                    application_id,
                )
                .await?;
            }

            if !manifest.background_tasks.is_empty() {
                let task_inputs: Vec<_> = manifest.background_tasks.iter().map(|t| {
                    super::db_proxy::BackgroundTaskInputJson {
                        manifest_id: t.id.clone(),
                        name: t.id.clone(),
                        description: t.description.clone(),
                        function: t.function.clone(),
                        schedule: t.schedule.clone(),
                    }
                }).collect();
                info!(
                    "Registering {} background task(s) for module {} (moduleKey={})",
                    task_inputs.len(),
                    module_key,
                    composite_module_key
                );
                super::db_proxy::register_background_tasks(
                    url,
                    module_key,
                    &manifest.name,
                    &manifest.version,
                    task_inputs,
                    application_id,
                )
                .await?;
            }

            // "button" settings are UI-only triggers, not stored values — skip
            // them here so we don't register a meaningless empty-string row.
            let setting_inputs: Vec<_> = manifest
                .settings
                .iter()
                .filter(|s| s.setting_type != "button")
                .map(|s| super::db_proxy::SettingInputJson {
                    key: s.id.clone(),
                    value: s.resolved_default(),
                    value_type: s.setting_type.clone(),
                })
                .collect();
            if !setting_inputs.is_empty() {
                info!(
                    "Registering {} setting(s) for module {}",
                    setting_inputs.len(),
                    module_key
                );
                super::db_proxy::register_module_settings(url, module_key, setting_inputs)
                    .await
                    .map_err(|e| anyhow!("register settings: {}", e))?;
            }

            // Register module assets — same idempotent pattern as
            // actions. `asset_keys[i]` was captured during the upload
            // pass earlier in this function, so the order matches
            // `manifest.assets[i]`.
            if !manifest.assets.is_empty() {
                let asset_inputs: Vec<_> = manifest
                    .assets
                    .iter()
                    .enumerate()
                    .map(|(i, a)| a.to_input(asset_keys[i].clone()))
                    .collect();
                info!(
                    "Registering {} asset(s) for module {} (moduleKey={})",
                    asset_inputs.len(),
                    module_key,
                    composite_module_key
                );
                super::db_proxy::register_assets(
                    url,
                    module_key,
                    &manifest.name,
                    &manifest.version,
                    asset_inputs,
                )
                .await?;

                for (i, a) in manifest.assets.iter().enumerate() {
                    let canonical = resolved.assets[i].canonical_id.to_string();
                    if let Err(e) = create_module_resource(
                        url, &db_record_id, "asset", "", &a.id, &canonical, &manifest.version,
                    ).await {
                        warn!("Failed to record asset resource {}: {}", canonical, e);
                    }
                }
            }

            for (i, wf) in manifest.workflows.iter().enumerate() {
                let resolved_wf = &resolved.workflows[i];

                // Build the trigger context: $ref carries the canonical
                // trigger id; event_subject carries the NATS subject the
                // workflow engine actually subscribes to.
                //
                // Same-module triggers resolve via the local manifest.
                // Cross-module triggers (canonical id pointing at another
                // module's trigger declaration) get a db lookup to recover
                // the trigger row's `event` field — that module must be
                // installed first or this fails loudly.
                let resolved_trigger_ctx = if resolved_wf.trigger.module_id() == resolved.module_id {
                    let trigger_local_id = resolved_wf.trigger.resource_id();
                    let trigger_event_subject = manifest
                        .triggers
                        .iter()
                        .find(|t| t.id == trigger_local_id)
                        .map(|t| if t.event.is_empty() { t.id.clone() } else { t.event.clone() })
                        .ok_or_else(|| anyhow!(
                            "internal: bundled workflow {} references local trigger {} not found in manifest",
                            wf.id,
                            trigger_local_id,
                        ))?;
                    ResolvedWorkflowTrigger {
                        trigger_ref: resolved_wf.trigger.to_string(),
                        event_subject: trigger_event_subject,
                    }
                } else {
                    let canonical = resolved_wf.trigger.to_string();
                    let event_subject = super::db_proxy::get_trigger_event_by_canonical_id(
                        url,
                        &canonical,
                    )
                    .await
                    .map_err(|e| anyhow!(
                        "bundled workflow {} references trigger {} but the trigger could not be resolved (is the owning module installed?): {}",
                        wf.id,
                        canonical,
                        e,
                    ))?;
                    ResolvedWorkflowTrigger {
                        trigger_ref: canonical,
                        event_subject,
                    }
                };

                // Build per-step context. Each step references an action
                // by canonical id. Same-module actions resolve via the
                // local manifest's resolved actions table. Cross-module
                // actions get a db lookup to recover the action's `call`
                // (a canonical function id) so the workflow step's
                // `function` field can be baked in.
                //
                // We can't async-map a Vec inline, so collect step
                // contexts in a sequential loop.
                let mut resolved_steps_ctx: Vec<ResolvedWorkflowStep> =
                    Vec::with_capacity(resolved_wf.step_actions.len());
                for (si, action_canonical) in resolved_wf.step_actions.iter().enumerate() {
                    // (engine_action, function_call) — engine_action is
                    // the workflow handler name (function / alert / …);
                    // function_call is set only when engine_action is
                    // "function" (the canonical fn id to invoke).
                    let (engine_action, function_call): (String, Option<String>) =
                        if action_canonical.module_id() == resolved.module_id {
                            let resolved_action = resolved
                                .actions
                                .iter()
                                .find(|a| a.canonical_id.resource_id() == action_canonical.resource_id())
                                .ok_or_else(|| anyhow!(
                                    "internal: bundled workflow {} step #{} references action {} not found in resolved actions",
                                    wf.id,
                                    si,
                                    action_canonical,
                                ))?;
                            match &resolved_action.implementation {
                                ResolvedActionImpl::Function { canonical_function_id: cid } => {
                                    ("function".to_string(), Some(cid.to_string()))
                                }
                            }
                        } else {
                            let canonical = action_canonical.to_string();
                            let resolved_ref = super::db_proxy::get_action_ref_by_canonical_id(url, &canonical)
                                .await
                                .map_err(|e| anyhow!(
                                    "bundled workflow {} step #{} references action {} but the action could not be resolved (is the owning module installed?): {}",
                                    wf.id,
                                    si,
                                    canonical,
                                    e,
                                ))?;
                            (resolved_ref.action_type, resolved_ref.function_call)
                        };
                    resolved_steps_ctx.push(ResolvedWorkflowStep {
                        action_ref: action_canonical.to_string(),
                        engine_action,
                        function_call,
                    });
                }

                wf.register(
                    module_key,
                    url,
                    &resolved_trigger_ctx,
                    &resolved_steps_ctx,
                    &asset_repo_keys,
                )
                .await?;
                let canonical = resolved_wf.canonical_id.to_string();
                if let Err(e) = create_module_resource(
                    url, &db_record_id, "workflow", "", &wf.id, &canonical, &manifest.version,
                ).await {
                    warn!("Failed to record workflow resource {}: {}", canonical, e);
                }
            }

            // module_id may have been set above; retrieve it for resource tracking
            let mid = match super::db_proxy::get_module_by_name(url, module_key).await {
                Ok(Some(resp)) => {
                    let v: serde_json::Value = serde_json::from_str(&resp).unwrap_or_default();
                    v.get("module").and_then(|m| m.get("id")).and_then(|v| v.as_str()).unwrap_or("").to_string()
                }
                _ => String::new(),
            };

            for (i, cmd) in manifest.commands.iter().enumerate() {
                let resolved_cmd = &resolved.commands[i];
                let resolved_workflow = resolved_cmd.workflow.as_ref().map(|c| c.to_string());
                cmd.register(
                    module_key,
                    url,
                    resolved_workflow.as_deref(),
                )
                .await?;
                let canonical = resolved_cmd.canonical_id.to_string();
                if !mid.is_empty() {
                    if let Err(e) = create_module_resource(
                        url, &mid, "command", "", &cmd.id, &canonical, &manifest.version,
                    ).await {
                        warn!("Failed to record command resource {}: {}", canonical, e);
                    }
                }
            }

            Ok(())
        }
        .await;

        if let Err(e) = install_result {
            warn!(
                "install failed for module {} ({}): rolling back db state: {}",
                manifest.name, composite_module_key, e
            );
            rollback_db_install(url, module_key, &manifest.name, application_id).await;
            return Err(e);
        }
    } else {
        warn!(
            "databaseProxyUrl not set in .woofx3.json; skipping CreateModule, trigger, workflow, action, and command registration"
        );
        for wf in &manifest.workflows {
            wf.process().await?;
        }
        for c in &manifest.commands {
            c.process().await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::module_service::module_file::{
        ModuleFile, ModuleFileKind, ModuleValidManifestKind, ModuleValidProgramKind,
    };
    use lib_repository::{FileRepository, FileRepositoryConfig, Repository};

    fn manifest_with_trigger_ids(ids: &[&str]) -> ModuleManifest {
        let triggers: Vec<serde_json::Value> = ids
            .iter()
            .map(|id| serde_json::json!({ "id": id, "name": id, "event": id }))
            .collect();
        let manifest_json = serde_json::json!({
            "id": "diff-mod",
            "name": "Diff Mod",
            "version": "1.0.0",
            "triggers": triggers,
        });
        serde_json::from_value(manifest_json).expect("manifest")
    }

    #[test]
    fn removed_manifest_ids_reports_only_ids_dropped_from_the_new_manifest() {
        // v1 declares {A, B}; v2 declares {B, C} — A should be reported
        // for removal, B is kept (present in both, handled by the normal
        // upsert path), C is new (also handled by upsert, not by this
        // diff, since it's absent from `old`).
        let old = manifest_with_trigger_ids(&["A", "B"]);
        let new = manifest_with_trigger_ids(&["B", "C"]);

        let removed = removed_manifest_ids(&old, &new);

        assert_eq!(removed, vec![("trigger", "A".to_string())]);
    }

    #[test]
    fn removed_manifest_ids_is_empty_when_nothing_was_dropped() {
        let old = manifest_with_trigger_ids(&["A", "B"]);
        let new = manifest_with_trigger_ids(&["A", "B", "C"]);

        assert!(removed_manifest_ids(&old, &new).is_empty());
    }

    #[test]
    fn removed_manifest_ids_reports_dropped_functions_but_never_assets() {
        let old_json = serde_json::json!({
            "id": "diff-mod",
            "name": "Diff Mod",
            "version": "1.0.0",
            "functions": [
                { "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" },
            ],
            "assets": [
                { "id": "a1", "name": "A1", "path": "assets/a1.mp3" },
            ],
        });
        let new_json = serde_json::json!({
            "id": "diff-mod",
            "name": "Diff Mod",
            "version": "2.0.0",
            "functions": [],
            "assets": [],
        });
        let old: ModuleManifest = serde_json::from_value(old_json).expect("old manifest");
        let new: ModuleManifest = serde_json::from_value(new_json).expect("new manifest");

        let removed = removed_manifest_ids(&old, &new);

        // The dropped function is reported (so it gets archived, not
        // deleted); the dropped asset is never reported — assets are
        // left alone entirely, per the "should not be removed" contract.
        assert_eq!(removed, vec![("function", "f1".to_string())]);
    }

    #[tokio::test]
    async fn install_stores_function_without_db_proxy() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "test-mod",
            "name": "Test Mod",
            "version": "1.0.0",
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }]
        }"#;

        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "functions/f1.lua".into(),
                ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA),
                b"return 1".to_vec(),
            ),
        ];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/test-mod/1.0.0.zip",
            None,
            "",
            false,
            &mid,
            "",
        )
        .await
        .expect("install");

        let stored = repo
            .read_file("modules/test-mod/functions/f1.lua")
            .await
            .expect("read");
        assert_eq!(stored, b"return 1");
    }

    #[tokio::test]
    async fn install_stores_widget_entry_and_asset_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "wm",
            "name": "Widget Mod",
            "version": "1.0.0",
            "widgets": [{
                "id": "w1",
                "name": "W",
                "entry": "w/index.html",
                "assets": "w/"
            }]
        }"#;

        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "w/index.html".into(),
                ModuleFileKind::ASSET("html".into()),
                b"<!doctype html>".to_vec(),
            ),
            ModuleFile::new(
                "w/static/theme.css".into(),
                ModuleFileKind::ASSET("css".into()),
                b"body{}".to_vec(),
            ),
        ];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        run_install(&manifest, &files, &repo, "archives/wm/1.0.0.zip", None, "", false, &mid, "")
            .await
            .expect("install");

        // Entry and assets-dir files share one key shape: assets-relative
        // under `modules/{module_key}/widgets/{widget_id}/` — so the
        // registered `entry` ("index.html") resolves directly.
        let html = repo
            .read_file("modules/wm/widgets/w1/index.html")
            .await
            .expect("html");
        assert_eq!(html, b"<!doctype html>");
        let css = repo
            .read_file("modules/wm/widgets/w1/static/theme.css")
            .await
            .expect("css");
        assert_eq!(css, b"body{}");
    }

    #[tokio::test]
    async fn install_stores_top_level_asset_without_doubling_assets_prefix() {
        // Regression: manifest.assets[].path is the full zip-relative path
        // (e.g. "assets/bell.mp3", matching the functions[].path convention
        // — "functions/foo.lua"), so the repository key must not prepend
        // another "assets/" segment on top of it.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "am",
            "name": "Asset Mod",
            "version": "1.0.0",
            "assets": [{
                "id": "bell",
                "name": "Bell",
                "path": "assets/bell.mp3"
            }]
        }"#;

        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "assets/bell.mp3".into(),
                ModuleFileKind::ASSET("mp3".into()),
                b"fake-mp3-bytes".to_vec(),
            ),
        ];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        run_install(&manifest, &files, &repo, "archives/am/1.0.0.zip", None, "", false, &mid, "")
            .await
            .expect("install");

        let bytes = repo
            .read_file("modules/am/assets/bell.mp3")
            .await
            .expect("asset stored at modules/{module_key}/assets/bell.mp3, not nested under assets/assets/");
        assert_eq!(bytes, b"fake-mp3-bytes");

        // The bug this guards against: a doubled "assets/assets/" prefix.
        assert!(
            repo.read_file("modules/am/assets/assets/bell.mp3")
                .await
                .is_err(),
            "asset must not be stored under a doubled assets/assets/ prefix"
        );
    }

    #[tokio::test]
    async fn install_rejects_widget_entry_outside_assets() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "wm2",
            "name": "Widget Mod 2",
            "version": "1.0.0",
            "widgets": [{
                "id": "w1",
                "name": "W",
                "entry": "elsewhere/index.html",
                "assets": "w/"
            }]
        }"#;

        let files = vec![ModuleFile::new(
            "module.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
            manifest_json.to_vec(),
        )];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        let err = run_install(&manifest, &files, &repo, "archives/wm2/1.0.0.zip", None, "", false, &mid, "")
            .await
            .expect_err("entry outside assets must fail validation");
        assert!(
            err.to_string().contains("must live inside the `assets` directory"),
            "unexpected error: {err}"
        );
    }

    #[tokio::test]
    async fn install_rejects_widget_zip_member_name_traversal() {
        // Regression test for a confirmed zip-slip: the declared `entry`/
        // `assets` manifest strings are clean, but a zip archive member's
        // own *file name* resolves (after prefix-stripping) to a path
        // containing `..`. Before the fix, this survived normalize_rel_path
        // unchanged and produced a repository key like
        // "modules/wm3/widgets/w1/../../../evil.js", which FileRepository's
        // `destination.join(key)` + `create_dir_all` would honor, writing
        // outside `destination`. Assert both that install fails and that no
        // file lands anywhere outside the tempdir.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "wm3",
            "name": "Widget Mod 3",
            "version": "1.0.0",
            "widgets": [{
                "id": "w1",
                "name": "W",
                "entry": "w/index.html",
                "assets": "w/"
            }]
        }"#;

        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "w/index.html".into(),
                ModuleFileKind::ASSET("html".into()),
                b"<!doctype html>".to_vec(),
            ),
            // Malicious zip member: starts with the "w/" assets prefix, but
            // strips down to a `..`-containing relative path.
            ModuleFile::new(
                "w/../../../evil.js".into(),
                ModuleFileKind::ASSET("js".into()),
                b"pwned".to_vec(),
            ),
        ];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        let err = run_install(&manifest, &files, &repo, "archives/wm3/1.0.0.zip", None, "", false, &mid, "")
            .await
            .expect_err("zip member name traversal must fail install");
        assert!(
            err.to_string().contains("invalid file name in archive"),
            "unexpected error: {err}"
        );

        // No file escaped the tempdir, at any depth.
        for entry in walk_all_files(dir.path()) {
            let rel = entry.strip_prefix(dir.path()).expect("within tempdir");
            assert!(
                !rel.to_string_lossy().contains(".."),
                "found a path outside destination: {}",
                entry.display()
            );
        }
        // And the legitimate entry file still installed successfully up to
        // the point of failure is irrelevant here — the whole install must
        // fail, so evil.js must not exist anywhere on disk.
        assert!(
            walk_all_files(dir.path())
                .iter()
                .all(|p| p.file_name().map(|n| n != "evil.js").unwrap_or(true)),
            "evil.js must never be written"
        );
    }

    fn walk_all_files(root: &Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    out.push(path);
                }
            }
        }
        out
    }

    #[tokio::test]
    async fn install_stores_overlay_entry() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "om",
            "name": "Overlay Mod",
            "version": "2.0.0",
            "overlays": [{ "id": "o1", "name": "O", "entry": "overlays/o1/index.html" }]
        }"#;

        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "overlays/o1/index.html".into(),
                ModuleFileKind::ASSET("html".into()),
                b"<html/>".to_vec(),
            ),
        ];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        run_install(&manifest, &files, &repo, "archives/om/2.0.0.zip", None, "", false, &mid, "")
            .await
            .expect("install");

        let html = repo
            .read_file("modules/om/overlays/o1/overlays/o1/index.html")
            .await
            .expect("overlay html");
        assert_eq!(html, b"<html/>");
    }
}
