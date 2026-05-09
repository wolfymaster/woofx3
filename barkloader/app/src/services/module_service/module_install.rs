use anyhow::{anyhow, Result};
use lib_repository::Repository;
use log::{info, warn};
use std::path::Path;

use super::db_proxy::{create_module, create_module_resource, CreateModuleFunctionJson};
use super::manifest_validate::{self, ResolvedActionImpl};
use super::module_file::ModuleFile;
use super::module_manifest::{ModuleManifest, ResolvedWorkflowStep, ResolvedWorkflowTrigger};

pub struct VersionConflict {
    pub module_name: String,
    pub existing_version: String,
    pub new_version: String,
}

pub enum VersionConflictAction {
    Reject,
    ForceOverwrite,
    AutoIncrementPatch,
}

pub async fn check_version_conflict<R: Repository>(
    module_name: &str,
    module_key: &str,
    new_version: &str,
    repository: &R,
) -> Result<Option<VersionConflict>> {
    let archive_key = format!("archives/{}.zip", module_key);
    match repository.exists(&archive_key).await {
        Ok(true) => Ok(Some(VersionConflict {
            module_name: module_name.to_string(),
            existing_version: new_version.to_string(),
            new_version: new_version.to_string(),
        })),
        Ok(false) => Ok(None),
        Err(_) => Ok(None),
    }
}

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
    info!("Deleted triggers and actions for module {}", module_name);

    super::db_proxy::delete_workflows_by_module(url, application_id, module_name).await?;
    info!("Deleted workflows for module {}", module_name);

    super::db_proxy::delete_commands_by_module(url, application_id, module_name).await?;
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
    // is written to the repository under
    // `modules/<moduleKey>/assets/<path>` and the resulting key is
    // captured for the RegisterAssets call further down.
    let mut asset_keys: Vec<String> = Vec::with_capacity(manifest.assets.len());
    for a in &manifest.assets {
        let repo_key = a.upload_to_repository(&module_key, files, repository).await?;
        asset_keys.push(repo_key);
    }

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
                composite_module_key,
                &manifest.name,
                &manifest.version,
                trigger_inputs,
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
                composite_module_key,
                &manifest.name,
                &manifest.version,
                action_inputs,
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
                    composite_module_key,
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
                    composite_module_key,
                    url,
                    application_id,
                    &resolved_trigger_ctx,
                    &resolved_steps_ctx,
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
                    application_id,
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
        warn!("DB_PROXY_ADDR not set; skipping CreateModule, trigger, workflow, action, and command registration");
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
            .read_file("modules/test-mod/functions/functions/f1.lua")
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
                "assets": "w/static/"
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

        let html = repo
            .read_file("modules/wm/widgets/w1/w/index.html")
            .expect("html");
        assert_eq!(html, b"<!doctype html>");
        let css = repo
            .read_file("modules/wm/widgets/w1/theme.css")
            .expect("css");
        assert_eq!(css, b"body{}");
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
            .expect("overlay html");
        assert_eq!(html, b"<html/>");
    }
}
