use anyhow::{anyhow, Result};
use lib_repository::Repository;
use tracing::{info, warn};
use std::collections::HashMap;
use std::path::Path;

use super::canonical_id::CanonicalId;
use super::db_proxy::CreateModuleFunctionJson;
use super::db_proxy_client::ModuleDbProxy;
use super::manifest_validate::{
    self, InstallProvenance, InstallStep, ResolvedActionImpl, ResolvedManifest, WorkflowTriggerRef,
};
use super::module_file::ModuleFile;
use super::module_manifest::{ModuleManifest, ResolvedWorkflowStep, ResolvedWorkflowTrigger};

/// `module_name` is the version-free manifest id — the value stored as
/// `created_by_ref`, and what every delete-by-module-id call matches on.
/// `module_key` is the composite `{id}:{version}:{hash}` being replaced;
/// it never participates in matching and is carried only so the
/// deregistration events name the exact version that went away.
pub async fn cleanup_old_version(
    module_name: &str,
    module_key: &str,
    db_proxy: Option<&dyn ModuleDbProxy>,
    application_id: &str,
) -> Result<()> {
    let proxy = match db_proxy {
        Some(p) => p,
        None => return Ok(()),
    };

    proxy.delete_triggers_by_module_id(module_name, module_key).await?;
    proxy.delete_actions_by_module_id(module_name, module_key).await?;
    proxy.delete_widgets_by_module_id(module_name, module_key).await?;
    proxy.delete_background_tasks_by_module_id(module_name, module_key).await?;
    info!("Deleted triggers, actions, widgets, and background tasks for module {}", module_name);

    proxy.delete_workflows_by_module("", module_name).await?;
    info!("Deleted workflows for module {}", module_name);

    proxy.delete_commands_by_module(module_name).await?;
    info!("Deleted commands for module {}", module_name);

    Ok(())
}

/// Compensating cleanup for a half-completed install. Called when any db-side
/// step after `create_module` fails so the next install attempt doesn't trip
/// the `modules_name_key` unique constraint. Each step is best-effort — a
/// cleanup error is logged and suppressed so the original install error
/// surfaces to the caller.
async fn rollback_db_install(
    db_proxy: &dyn ModuleDbProxy,
    manifest_module_key: &str,
    composite_module_key: &str,
    module_name: &str,
    application_id: &str,
) {
    if let Err(e) =
        cleanup_old_version(manifest_module_key, composite_module_key, Some(db_proxy), application_id).await
    {
        warn!(
            "rollback: cleanup_old_version({}) failed: {}",
            manifest_module_key, e
        );
    }
    if let Err(e) = db_proxy.delete_module(module_name).await {
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
    db_proxy: &dyn ModuleDbProxy,
    module_key: &str,
    new_manifest: &ModuleManifest,
) {
    let prev_response = match db_proxy.get_module_by_module_id(module_key).await {
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
            db_proxy.delete_resource_by_manifest_id(module_key, resource_type, &manifest_id).await
        } else {
            db_proxy.archive_resource_by_manifest_id(module_key, resource_type, &manifest_id).await
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

/// Mutable state threaded through a single install's step execution:
/// values every step's own code needs, plus values later steps need that
/// an earlier step computed (`db_record_id` from `CreateModule`,
/// `module_record_id_for_commands` resolved lazily on the first
/// `RegisterCommand`). One `SagaState` per `run_install` call — steps run
/// strictly sequentially, so this never needs to be `Sync`.
struct SagaState<'a, R: Repository> {
    manifest: &'a ModuleManifest,
    resolved: &'a ResolvedManifest,
    files: &'a [ModuleFile],
    repository: &'a R,
    module_key: &'a str,
    version_dir: &'a str,
    composite_module_key: &'a str,
    application_id: &'a str,
    client_id: &'a str,
    archive_key: &'a str,
    provenance: InstallProvenance,
    fn_rows: Vec<CreateModuleFunctionJson>,
    asset_keys: Vec<String>,
    asset_repo_keys: HashMap<String, String>,
    db_record_id: Option<String>,
    module_record_id_for_commands: Option<String>,
}

impl<'a, R: Repository> SagaState<'a, R> {
    async fn execute(&mut self, step: &InstallStep, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        match step {
            // Uploads already ran unconditionally in `run_install` before
            // the plan executes (the no-db-proxy dry-validation path
            // needs files persisted too, so they can't live only inside
            // a plan that's built exclusively when `db_proxy` is
            // `Some`). Kept as explicit steps so the plan is a complete,
            // first-class picture of the install, and so `CreateModule`
            // / `RegisterAssets` / `RegisterWorkflow` can declare their
            // real dependency on them.
            InstallStep::UploadFunctionFiles
            | InstallStep::UploadWidgetAssets
            | InstallStep::UploadOverlayEntries
            | InstallStep::UploadAssets => Ok(()),
            InstallStep::CreateModule => self.execute_create_module(db_proxy).await,
            InstallStep::RegisterTriggers => self.execute_register_triggers(db_proxy).await,
            InstallStep::RegisterActions => self.execute_register_actions(db_proxy).await,
            InstallStep::RegisterWidgets => self.execute_register_widgets(db_proxy).await,
            InstallStep::RegisterBackgroundTasks => self.execute_register_background_tasks(db_proxy).await,
            InstallStep::RegisterSettings => self.execute_register_settings(db_proxy).await,
            InstallStep::RegisterAssets => self.execute_register_assets(db_proxy).await,
            InstallStep::RegisterWorkflow(canonical_id) => {
                self.execute_register_workflow(canonical_id, db_proxy).await
            }
            InstallStep::RegisterCommand(canonical_id) => {
                self.execute_register_command(canonical_id, db_proxy).await
            }
        }
    }

    async fn upload_files(&mut self) -> Result<()> {
        for f in &self.manifest.functions {
            let file_key = f
                .upload_to_repository(self.module_key, self.version_dir, self.files, self.repository)
                .await?;
            let file_name = Path::new(&f.path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("function")
                .to_string();
            self.fn_rows.push(CreateModuleFunctionJson {
                manifest_id: f.id.clone(),
                name: f.name.clone(),
                file_name,
                file_key,
                entry_point: f.entry_point.clone().unwrap_or_default(),
                runtime: f.runtime.clone(),
            });
        }

        for w in &self.manifest.widgets {
            w.upload_assets(self.module_key, self.version_dir, self.files, self.repository).await?;
        }

        // Upload static assets declared in manifest.assets[]. Each asset
        // is written to the repository under `modules/<moduleKey>/<versionDir>/<path>`
        // (path already carries its own directory, e.g. `assets/bell.mp3`
        // — see ManifestAsset::upload_to_repository) and the resulting key
        // is captured for the RegisterAssets call further down.
        for a in &self.manifest.assets {
            let repo_key = a
                .upload_to_repository(self.module_key, self.version_dir, self.files, self.repository)
                .await?;
            self.asset_keys.push(repo_key);
        }
        // Manifest-local asset id -> repository key, used to bake
        // `${asset:<id>}` markers in workflow step parameters into
        // `${woofx3_asset_url:<repositoryKey>}` at registration time (see
        // ManifestWorkflow::register / encode_asset_url_markers).
        self.asset_repo_keys = self
            .manifest
            .assets
            .iter()
            .zip(self.asset_keys.iter())
            .map(|(a, key)| (a.id.clone(), key.clone()))
            .collect();

        Ok(())
    }

    async fn execute_create_module(&mut self, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        let manifest_json = serde_json::to_string(self.manifest)
            .map_err(|e| anyhow!("serialize manifest: {}", e))?;
        let db_record_id = db_proxy
            .create_module(
                &self.manifest.name,
                self.module_key,
                &self.manifest.version,
                &manifest_json,
                self.archive_key,
                &self.fn_rows,
                self.composite_module_key,
                self.client_id,
                self.provenance,
            )
            .await?;

        // Record function resources in ledger. `resource_name` is the
        // canonical id — that's the value the in-use check and any
        // future reference resolution joins on. `manifest_id` keeps
        // the author's local id for debugging / display.
        for (i, f) in self.manifest.functions.iter().enumerate() {
            let canonical = self.resolved.functions[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(&db_record_id, "function", "", &f.id, &canonical, &self.manifest.version)
                .await
            {
                warn!("Failed to record function resource {}: {}", canonical, e);
            }
        }

        // Record widget resources in ledger
        for (i, w) in self.manifest.widgets.iter().enumerate() {
            let canonical = self.resolved.widgets[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(&db_record_id, "widget", "", &w.id, &canonical, &self.manifest.version)
                .await
            {
                warn!("Failed to record widget resource {}: {}", canonical, e);
            }
        }

        self.db_record_id = Some(db_record_id);
        Ok(())
    }

    async fn execute_register_triggers(&self, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        let db_record_id = self
            .db_record_id
            .as_deref()
            .expect("CreateModule runs before RegisterTriggers");

        // Register triggers as a single bulk call. Rows are keyed on the
        // version-free `module_key` (stored as created_by_ref) so an upgrade
        // upserts in place; the composite key rides along so the outbox event
        // can name the exact installed version.
        // The trigger row's `event` field is the actual NATS subject
        // the trigger fires on (publishers emit on this subject;
        // workflows subscribe to it). The trigger's *canonical id*
        // (`{moduleId}:trigger:{id}`) is recorded separately in the
        // module_resources ledger as `resource_name`, and referenced
        // from workflow `$ref` fields — never on the trigger row.
        let trigger_inputs: Vec<_> = self.manifest.triggers.iter().map(|t| t.to_input()).collect();
        info!(
            "Registering {} trigger(s) for module {} (moduleKey={})",
            trigger_inputs.len(),
            self.module_key,
            self.composite_module_key
        );
        db_proxy
            .register_triggers(self.module_key, self.composite_module_key, &self.manifest.name, &self.manifest.version, trigger_inputs, "")
            .await?;

        // Ledger rows record one resource per trigger, keyed by canonical id.
        for (i, t) in self.manifest.triggers.iter().enumerate() {
            let canonical = self.resolved.triggers[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(db_record_id, "trigger", "", &t.id, &canonical, &self.manifest.version)
                .await
            {
                warn!("Failed to record trigger resource {}: {}", canonical, e);
            }
        }
        Ok(())
    }

    async fn execute_register_actions(&self, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        let db_record_id = self
            .db_record_id
            .as_deref()
            .expect("CreateModule runs before RegisterActions");

        // Register actions as a single bulk call. Same keying as triggers:
        // version-free id for the row, composite key for the event.
        // The action's `call` field is the resolved canonical function
        // id of the action's resolved implementation.
        let action_inputs: Vec<_> = self
            .manifest
            .actions
            .iter()
            .enumerate()
            .map(|(i, a)| {
                // A function action dispatches through the `function` handler
                // with the canonical function id as its target; a native
                // action *is* its handler and has no target.
                let (action_type, resolved_call) = match &self.resolved.actions[i].implementation {
                    ResolvedActionImpl::Function { canonical_function_id } => {
                        ("function".to_string(), canonical_function_id.to_string())
                    }
                    ResolvedActionImpl::Native { handler } => (handler.clone(), String::new()),
                };
                a.to_input(&action_type, &resolved_call)
            })
            .collect();
        info!(
            "Registering {} action(s) for module {} (moduleKey={})",
            action_inputs.len(),
            self.module_key,
            self.composite_module_key
        );
        db_proxy
            .register_actions(self.module_key, self.composite_module_key, &self.manifest.name, &self.manifest.version, action_inputs, "")
            .await?;

        for (i, a) in self.manifest.actions.iter().enumerate() {
            let canonical = self.resolved.actions[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(db_record_id, "action", "", &a.id, &canonical, &self.manifest.version)
                .await
            {
                warn!("Failed to record action resource {}: {}", canonical, e);
            }
        }
        Ok(())
    }

    async fn execute_register_widgets(&self, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        let widget_inputs: Vec<_> = self.manifest.widgets.iter().map(|w| w.to_input()).collect();
        info!(
            "Registering {} widget(s) for module {} (moduleKey={})",
            widget_inputs.len(),
            self.module_key,
            self.composite_module_key
        );
        db_proxy
            .register_widgets(
                self.module_key,
                self.composite_module_key,
                &self.manifest.name,
                &self.manifest.version,
                widget_inputs,
                self.application_id,
            )
            .await?;
        Ok(())
    }

    async fn execute_register_background_tasks(&self, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        let task_inputs: Vec<_> = self
            .manifest
            .background_tasks
            .iter()
            .map(|t| super::db_proxy::BackgroundTaskInputJson {
                manifest_id: t.id.clone(),
                name: t.id.clone(),
                description: t.description.clone(),
                function: t.function.clone(),
                schedule: t.schedule.clone(),
            })
            .collect();
        info!(
            "Registering {} background task(s) for module {} (moduleKey={})",
            task_inputs.len(),
            self.module_key,
            self.composite_module_key
        );
        db_proxy
            .register_background_tasks(
                self.module_key,
                self.composite_module_key,
                &self.manifest.name,
                &self.manifest.version,
                task_inputs,
                self.application_id,
            )
            .await?;
        Ok(())
    }

    async fn execute_register_settings(&self, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        // "button" settings are UI-only triggers, not stored values — skip
        // them here so we don't register a meaningless empty-string row.
        let setting_inputs: Vec<_> = self
            .manifest
            .settings
            .iter()
            .filter(|s| s.setting_type != "button")
            .map(|s| super::db_proxy::SettingInputJson {
                key: s.id.clone(),
                value: s.resolved_default(),
                value_type: s.setting_type.clone(),
            })
            .collect();
        info!("Registering {} setting(s) for module {}", setting_inputs.len(), self.module_key);
        db_proxy
            .register_module_settings(self.module_key, setting_inputs)
            .await
            .map_err(|e| anyhow!("register settings: {}", e))?;
        Ok(())
    }

    async fn execute_register_assets(&self, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        let db_record_id = self
            .db_record_id
            .as_deref()
            .expect("CreateModule runs before RegisterAssets");

        // Register module assets — same idempotent pattern as actions.
        // `asset_keys[i]` was captured during the upload pass earlier in
        // `run_install`, so the order matches `manifest.assets[i]`.
        let asset_inputs: Vec<_> = self
            .manifest
            .assets
            .iter()
            .enumerate()
            .map(|(i, a)| a.to_input(self.asset_keys[i].clone()))
            .collect();
        info!(
            "Registering {} asset(s) for module {} (moduleKey={})",
            asset_inputs.len(),
            self.module_key,
            self.composite_module_key
        );
        db_proxy
            .register_assets(self.module_key, self.composite_module_key, &self.manifest.name, &self.manifest.version, asset_inputs)
            .await?;

        for (i, a) in self.manifest.assets.iter().enumerate() {
            let canonical = self.resolved.assets[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(db_record_id, "asset", "", &a.id, &canonical, &self.manifest.version)
                .await
            {
                warn!("Failed to record asset resource {}: {}", canonical, e);
            }
        }
        Ok(())
    }

    async fn execute_register_workflow(
        &self,
        canonical_id: &CanonicalId,
        db_proxy: &dyn ModuleDbProxy,
    ) -> Result<()> {
        let db_record_id = self
            .db_record_id
            .as_deref()
            .expect("CreateModule runs before RegisterWorkflow");
        let i = self
            .resolved
            .workflows
            .iter()
            .position(|w| &w.canonical_id == canonical_id)
            .ok_or_else(|| anyhow!("internal: install plan references workflow {} not found in resolved manifest", canonical_id))?;
        let wf = &self.manifest.workflows[i];
        let resolved_wf = &self.resolved.workflows[i];

        // Build the trigger context: $ref carries the canonical
        // trigger id; event_subject carries the NATS subject the
        // workflow engine actually subscribes to.
        //
        // Same-module triggers resolve via the local manifest.
        // Cross-module triggers (canonical id pointing at another
        // module's trigger declaration) get a db lookup to recover
        // the trigger row's `event` field — that module must be
        // installed first or this fails loudly.
        let resolved_trigger_ctx = match &resolved_wf.trigger {
            // An event binding already is the subject. No lookup, no
            // `trigger_ref` — an empty ref is what keeps this workflow out of
            // the dependency graph, so the emitting module stays uninstallable
            // and reinstallable underneath it.
            WorkflowTriggerRef::Event(event) => ResolvedWorkflowTrigger {
                trigger_ref: String::new(),
                event_subject: event.clone(),
            },
            WorkflowTriggerRef::Resource(canonical)
                if canonical.module_id() == self.resolved.module_id =>
            {
                let trigger_local_id = canonical.resource_id();
                let trigger_event_subject = self
                    .manifest
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
                    trigger_ref: canonical.to_string(),
                    event_subject: trigger_event_subject,
                }
            }
            WorkflowTriggerRef::Resource(canonical) => {
                let canonical = canonical.to_string();
                let event_subject = db_proxy
                    .get_trigger_event_by_canonical_id(&canonical)
                    .await
                    .map_err(|e| anyhow!(
                        "bundled workflow {} references trigger {} but the trigger could not be resolved (is the owning module installed?): {}",
                        wf.id,
                        canonical,
                        e,
                    ))?;
                ResolvedWorkflowTrigger { trigger_ref: canonical, event_subject }
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
        let mut resolved_steps_ctx: Vec<ResolvedWorkflowStep> = Vec::with_capacity(resolved_wf.step_actions.len());
        for (si, action_canonical) in resolved_wf.step_actions.iter().enumerate() {
            // (engine_action, function_call) — engine_action is
            // the workflow handler name (function / alert / …);
            // function_call is set only when engine_action is
            // "function" (the canonical fn id to invoke).
            let (engine_action, function_call): (String, Option<String>) =
                if action_canonical.module_id() == self.resolved.module_id {
                    let resolved_action = self
                        .resolved
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
                        // The step dispatches straight through the engine
                        // handler; there is no function for it to name.
                        ResolvedActionImpl::Native { handler } => (handler.clone(), None),
                    }
                } else {
                    let canonical = action_canonical.to_string();
                    let resolved_ref = db_proxy
                        .get_action_ref_by_canonical_id(&canonical)
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

        wf.register(self.module_key, db_proxy, &resolved_trigger_ctx, &resolved_steps_ctx, &self.asset_repo_keys)
            .await?;
        let canonical = resolved_wf.canonical_id.to_string();
        if let Err(e) = db_proxy
            .create_module_resource(db_record_id, "workflow", "", &wf.id, &canonical, &self.manifest.version)
            .await
        {
            warn!("Failed to record workflow resource {}: {}", canonical, e);
        }
        Ok(())
    }

    async fn execute_register_command(
        &mut self,
        canonical_id: &CanonicalId,
        db_proxy: &dyn ModuleDbProxy,
    ) -> Result<()> {
        let i = self
            .resolved
            .commands
            .iter()
            .position(|c| &c.canonical_id == canonical_id)
            .ok_or_else(|| anyhow!("internal: install plan references command {} not found in resolved manifest", canonical_id))?;
        let cmd = &self.manifest.commands[i];
        let resolved_cmd = &self.resolved.commands[i];
        let resolved_workflow = resolved_cmd.workflow.as_ref().map(|c| c.to_string());
        cmd.register(self.module_key, db_proxy, resolved_workflow.as_deref()).await?;

        // Resolved lazily and cached: today's code looks this up once,
        // unconditionally, before the (possibly empty) commands loop;
        // since this plan only has a `RegisterCommand` node per actual
        // command, resolving on first use gets the same "looked up (at
        // most) once" behavior without a synthetic non-step graph node,
        // and skips the read entirely when there are no commands.
        if self.module_record_id_for_commands.is_none() {
            let mid = match db_proxy.get_module_by_name(self.module_key).await {
                Ok(Some(resp)) => {
                    let v: serde_json::Value = serde_json::from_str(&resp).unwrap_or_default();
                    v.get("module").and_then(|m| m.get("id")).and_then(|v| v.as_str()).unwrap_or("").to_string()
                }
                _ => String::new(),
            };
            self.module_record_id_for_commands = Some(mid);
        }
        let mid = self.module_record_id_for_commands.as_deref().unwrap_or("");

        let canonical = resolved_cmd.canonical_id.to_string();
        if !mid.is_empty() {
            if let Err(e) = db_proxy
                .create_module_resource(mid, "command", "", &cmd.id, &canonical, &self.manifest.version)
                .await
            {
                warn!("Failed to record command resource {}: {}", canonical, e);
            }
        }
        Ok(())
    }
}

/// The provenance-free entry point, because every caller but the bundled-module
/// reconciler is a user upload.
#[allow(clippy::too_many_arguments)]
pub async fn run_install<R: Repository>(
    manifest: &ModuleManifest,
    files: &[ModuleFile],
    repository: &R,
    archive_key: &str,
    db_proxy: Option<&dyn ModuleDbProxy>,
    application_id: &str,
    cleanup_old: bool,
    composite_module_key: &str,
    client_id: &str,
) -> Result<()> {
    run_install_with_provenance(
        manifest,
        files,
        repository,
        archive_key,
        db_proxy,
        application_id,
        cleanup_old,
        composite_module_key,
        client_id,
        InstallProvenance::User,
    )
    .await
}

/// Install a module, enforcing the rules that depend on who is installing.
///
/// `System` unlocks the reserved `woofx3` module id and `native` action
/// declarations, and stamps the module row SYSTEM so the uninstall guard
/// refuses it. Child resource rows keep the ordinary (MODULE, module_key)
/// pairing every install uses — bundled modules are ordinary modules, and
/// forking how their resources are keyed would defeat the point.
#[allow(clippy::too_many_arguments)]
pub async fn run_install_with_provenance<R: Repository>(
    manifest: &ModuleManifest,
    files: &[ModuleFile],
    repository: &R,
    archive_key: &str,
    db_proxy: Option<&dyn ModuleDbProxy>,
    application_id: &str,
    cleanup_old: bool,
    composite_module_key: &str,
    client_id: &str,
    provenance: InstallProvenance,
) -> Result<()> {
    // `module_key` here is the manifest id (used for file paths and as the
    // module_name-style ref passed to child resource registrations).
    // `composite_module_key` is the `{id}:{version}:{hash}` idempotency key
    // that gets persisted on the module row and is the actual `moduleKey`
    // returned to the UI — these two are NOT the same.
    let module_key = manifest.module_key();

    // Short content-hash segment of `composite_module_key` — the trailing
    // `{hash}` in `{id}:{version}:{hash}`. Used as a version-scoped
    // storage directory (see `upload_content_addressed` in
    // module_manifest.rs) so upgrading a module never overwrites the
    // previous version's function/widget/asset/overlay bytes: every
    // version's files live under their own directory, sibling relative
    // references within a version (e.g. a widget's `<link href="style.css">`)
    // keep resolving correctly since they share that one directory, and
    // re-installing byte-identical content reuses the same directory for
    // free via the `exists()` short-circuit.
    let version_dir = composite_module_key
        .rsplit(':')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(composite_module_key);

    // Validate the manifest and resolve every intra-manifest reference
    // before any side effect runs. Validation enforces the canonical-id
    // contract documented in `docs/barkloader/modules.md`: required ids,
    // valid characters, per-kind uniqueness, resolvable references. Any
    // failure here aborts the install with no DB or filesystem state
    // touched.
    let resolved = manifest_validate::validate_with_provenance(manifest, provenance)
        .map_err(|e| anyhow!("manifest validation failed: {}", e))?;

    // Build the full install plan (graph + cross-module validation +
    // topo-sort) up front, before any side effect runs — same fail-fast
    // guarantee `validate_cross_module_dependencies` used to give on its
    // own, now folded into plan construction (see
    // `manifest_validate::build_install_plan`).
    let plan = match db_proxy {
        Some(proxy) => Some(manifest_validate::build_install_plan(manifest, &resolved, proxy).await?),
        None => None,
    };

    if let (Some(proxy), false) = (db_proxy, cleanup_old) {
        // Diff against the previously installed version (if any) and
        // prune anything the new manifest no longer declares, before
        // registering what it does declare. This is what makes an
        // upgrade converge to exactly the new manifest's resource set
        // instead of only ever adding/updating.
        prune_removed_resources(proxy, module_key, manifest).await;
    }

    let mut state = SagaState {
        manifest,
        resolved: &resolved,
        files,
        repository,
        module_key,
        version_dir,
        composite_module_key,
        application_id,
        client_id,
        archive_key,
        provenance,
        fn_rows: Vec::with_capacity(manifest.functions.len()),
        asset_keys: Vec::with_capacity(manifest.assets.len()),
        asset_repo_keys: HashMap::new(),
        db_record_id: None,
        module_record_id_for_commands: None,
    };
    state.upload_files().await?;

    if let Some(proxy) = db_proxy {
        let plan = plan.expect("plan was built above whenever db_proxy is Some");

        if cleanup_old {
            cleanup_old_version(module_key, composite_module_key, Some(proxy), application_id).await?;
        }

        // Saga-style install: every step after `CreateModule` must be
        // paired with a compensating cleanup if the install fails
        // partway through. Run the whole plan inside one async block so
        // a single rollback path handles any step's failure.
        let install_result: Result<()> = async {
            for step in &plan {
                state.execute(step, proxy).await?;
            }
            Ok(())
        }
        .await;

        if let Err(e) = install_result {
            warn!(
                "install failed for module {} ({}): rolling back db state: {}",
                manifest.name, composite_module_key, e
            );
            rollback_db_install(proxy, module_key, composite_module_key, &manifest.name, application_id).await;
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
    use super::super::db_proxy_client::FakeDbProxyClient;

    // ---------------------------------------------------------------
    // Install provenance. `System` is what a bundled module installs
    // under: it unlocks the reserved module id and `native` actions, and
    // stamps the module row so the uninstall guard refuses it.
    // ---------------------------------------------------------------

    fn system_manifest(id: &str) -> (ModuleManifest, Vec<u8>) {
        let json = serde_json::json!({
            "id": id,
            "name": id,
            "version": "1.0.0",
            "description": "bundled system module fixture"
        })
        .to_string();
        let manifest: ModuleManifest = serde_json::from_str(&json).expect("parse fixture manifest");
        (manifest, json.into_bytes())
    }

    #[tokio::test]
    async fn system_provenance_stamps_the_module_row() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig { destination: dir.path().to_path_buf() });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = system_manifest("woofx3");
        let files = vec![ModuleFile::new(
            "manifest.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
            manifest_json.clone(),
        )];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install_with_provenance(
            &manifest, &files, &repo, "archives/woofx3.zip", Some(&db_proxy), "", false, &mid, "",
            InstallProvenance::System,
        )
        .await
        .expect("system install succeeds");

        assert_eq!(db_proxy.create_module_provenance(), Some(InstallProvenance::System));
    }

    #[tokio::test]
    async fn the_reserved_id_is_refused_under_user_provenance() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig { destination: dir.path().to_path_buf() });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = system_manifest("woofx3");
        let files = vec![ModuleFile::new(
            "manifest.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
            manifest_json.clone(),
        )];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        let err = run_install(&manifest, &files, &repo, "archives/woofx3.zip", Some(&db_proxy), "", false, &mid, "")
            .await
            .expect_err("the reserved id must not install from an upload");
        assert!(err.to_string().contains("reserved"), "unexpected error: {err}");
        assert!(
            db_proxy.calls().is_empty(),
            "validation must fail before any db write: {:?}",
            db_proxy.calls()
        );
    }

    #[tokio::test]
    async fn run_install_defaults_to_user_provenance() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig { destination: dir.path().to_path_buf() });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = system_manifest("ordinary_module");
        let files = vec![ModuleFile::new(
            "manifest.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
            manifest_json.clone(),
        )];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install(&manifest, &files, &repo, "archives/om.zip", Some(&db_proxy), "", false, &mid, "")
            .await
            .expect("ordinary install succeeds");

        assert_eq!(db_proxy.create_module_provenance(), Some(InstallProvenance::User));
    }

    use crate::module_file::{
        ModuleFile, ModuleFileKind, ModuleValidManifestKind, ModuleValidProgramKind,
    };
    use lib_repository::{FileRepository, FileRepositoryConfig, Repository};

    // ---------------------------------------------------------------
    // Install plan execution against a fake db-proxy: the coverage gap
    // this whole refactor exists to close — the saga's partial-failure
    // rollback path had zero direct tests before this (the only prior
    // integration-style tests passed `db_proxy_url: None`, skipping the
    // entire branch). `RegisterWorkflow`/`RegisterCommand` are part of
    // the `ModuleDbProxy` seam too (`register_workflow`/`register_command`),
    // so a manifest with a workflow and a command exercises the whole
    // plan through the fake with no live network call.
    // ---------------------------------------------------------------

    fn fault_test_manifest(id: &str) -> (ModuleManifest, Vec<u8>) {
        let manifest_json = format!(
            r#"{{
                "id": "{id}",
                "name": "Test Mod",
                "version": "1.0.0",
                "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus" }}],
                "functions": [{{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }}],
                "actions": [{{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }}]
            }}"#
        )
        .into_bytes();
        let manifest: ModuleManifest = serde_json::from_slice(&manifest_json).expect("manifest");
        (manifest, manifest_json)
    }

    #[tokio::test]
    async fn install_with_db_proxy_runs_create_module_then_triggers_then_actions_in_order() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig { destination: dir.path().to_path_buf() });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-1");
        let files = vec![
            ModuleFile::new("module.json".into(), ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON), manifest_json.clone()),
            ModuleFile::new("functions/f1.lua".into(), ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA), b"return 1".to_vec()),
        ];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install(
            &manifest, &files, &repo, "archives/fault-mod-1.zip",
            Some(&db_proxy as &dyn ModuleDbProxy), "", false, &mid, "",
        )
        .await
        .expect("install should succeed against a fake with no configured failures");

        // create_module (+ its embedded function ledger write) before
        // triggers before actions — the exact order `InstallStep::phase`
        // documents.
        let calls = db_proxy.calls();
        let idx = |name: &str| calls.iter().position(|c| c == name).unwrap_or_else(|| panic!("{name} not called: {calls:?}"));
        assert!(idx("create_module") < idx("register_triggers"));
        assert!(idx("register_triggers") < idx("register_actions"));
    }

    fn fault_test_manifest_with_workflow(id: &str) -> (ModuleManifest, Vec<u8>) {
        let manifest_json = format!(
            r#"{{
                "id": "{id}",
                "name": "Test Mod",
                "version": "1.0.0",
                "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus" }}],
                "functions": [{{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }}],
                "actions": [{{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }}],
                "workflows": [{{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [{{ "action": "a1" }}] }}],
                "commands": [{{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix", "workflow": "w1" }}]
            }}"#
        )
        .into_bytes();
        let manifest: ModuleManifest = serde_json::from_slice(&manifest_json).expect("manifest");
        (manifest, manifest_json)
    }

    #[tokio::test]
    async fn install_with_db_proxy_registers_workflow_then_command_last() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig { destination: dir.path().to_path_buf() });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest_with_workflow("fault-mod-wf");
        let files = vec![
            ModuleFile::new("module.json".into(), ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON), manifest_json.clone()),
            ModuleFile::new("functions/f1.lua".into(), ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA), b"return 1".to_vec()),
        ];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install(
            &manifest, &files, &repo, "archives/fault-mod-wf.zip",
            Some(&db_proxy as &dyn ModuleDbProxy), "", false, &mid, "",
        )
        .await
        .expect("install should succeed against a fake with no configured failures");

        let calls = db_proxy.calls();
        let idx = |name: &str| calls.iter().position(|c| c == name).unwrap_or_else(|| panic!("{name} not called: {calls:?}"));
        assert!(idx("register_actions") < idx("register_workflow"));
        assert!(idx("register_workflow") < idx("register_command"));
    }

    #[tokio::test]
    async fn install_failure_registering_workflow_triggers_full_rollback() {
        // Proves RegisterWorkflow is genuinely part of the seam now: a
        // failure inside it (not just in its cross-module lookups) still
        // triggers the same compensating rollback as every other step.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig { destination: dir.path().to_path_buf() });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest_with_workflow("fault-mod-wf-2");
        let files = vec![
            ModuleFile::new("module.json".into(), ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON), manifest_json.clone()),
            ModuleFile::new("functions/f1.lua".into(), ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA), b"return 1".to_vec()),
        ];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["register_workflow"]);
        let err = run_install(
            &manifest, &files, &repo, "archives/fault-mod-wf-2.zip",
            Some(&db_proxy as &dyn ModuleDbProxy), "", false, &mid, "",
        )
        .await
        .expect_err("install should fail when register_workflow fails");
        assert!(err.to_string().contains("Failed to create workflow"), "got: {err}");

        let calls = db_proxy.calls();
        let rollback_start = calls.iter().position(|c| c == "register_workflow").expect("register_workflow was attempted") + 1;
        assert_eq!(
            &calls[rollback_start..],
            &[
                "delete_triggers_by_module_id",
                "delete_actions_by_module_id",
                "delete_widgets_by_module_id",
                "delete_background_tasks_by_module_id",
                "delete_workflows_by_module",
                "delete_commands_by_module",
                "delete_module",
            ]
        );
        // register_command must never run — the plan aborts before it.
        assert!(!calls.contains(&"register_command".to_string()));
    }

    #[tokio::test]
    async fn install_failure_after_create_module_triggers_full_rollback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig { destination: dir.path().to_path_buf() });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-2");
        let files = vec![
            ModuleFile::new("module.json".into(), ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON), manifest_json.clone()),
            ModuleFile::new("functions/f1.lua".into(), ModuleFileKind::PROGRAM(ModuleValidProgramKind::LUA), b"return 1".to_vec()),
        ];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["register_actions"]);
        let err = run_install(
            &manifest, &files, &repo, "archives/fault-mod-2.zip",
            Some(&db_proxy as &dyn ModuleDbProxy), "", false, &mid, "",
        )
        .await
        .expect_err("install should fail when register_actions fails");
        assert!(err.to_string().contains("register_actions"), "got: {err}");

        let calls = db_proxy.calls();
        let rollback_start = calls.iter().position(|c| c == "register_actions").expect("register_actions was attempted") + 1;
        assert_eq!(
            &calls[rollback_start..],
            &[
                "delete_triggers_by_module_id",
                "delete_actions_by_module_id",
                "delete_widgets_by_module_id",
                "delete_background_tasks_by_module_id",
                "delete_workflows_by_module",
                "delete_commands_by_module",
                "delete_module",
            ],
            "rollback_db_install's exact compensating sequence must run after any post-CreateModule failure"
        );
    }

    #[tokio::test]
    async fn install_failure_before_create_module_does_not_roll_back() {
        // A failure resolving a cross-module reference aborts inside
        // `build_install_plan`, before any db-proxy write — there is
        // nothing to compensate for, so `delete_module` etc. must never
        // be called.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig { destination: dir.path().to_path_buf() });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "fault-mod-3",
            "name": "Test Mod",
            "version": "1.0.0",
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "other_mod:trigger:missing", "steps": [] }]
        }"#;
        let files = vec![ModuleFile::new(
            "module.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
            manifest_json.to_vec(),
        )];
        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["get_trigger_event_by_canonical_id"]);
        let err = run_install(
            &manifest, &files, &repo, "archives/fault-mod-3.zip",
            Some(&db_proxy as &dyn ModuleDbProxy), "", false, &mid, "",
        )
        .await
        .expect_err("unresolvable cross-module trigger must fail install");
        assert!(err.to_string().contains("not installed"), "got: {err}");
        // Only the failing lookup itself ran — no write, and no rollback.
        assert_eq!(db_proxy.calls(), vec!["get_trigger_event_by_canonical_id".to_string()]);
    }

    /// Mirrors `run_install`'s `version_dir` derivation, for tests that
    /// need to predict the version-scoped storage path a given
    /// composite module key (`mid`) produces.
    fn version_dir_of(mid: &str) -> &str {
        mid.rsplit(':').next().unwrap_or(mid)
    }

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
            .read_file(&format!("modules/test-mod/{}/functions/f1.lua", version_dir_of(&mid)))
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
        // under `modules/{module_key}/{version_dir}/widgets/{widget_id}/`
        // — so the registered `entry` ("index.html") resolves directly.
        let version_dir = version_dir_of(&mid);
        let html = repo
            .read_file(&format!("modules/wm/{version_dir}/widgets/w1/index.html"))
            .await
            .expect("html");
        assert_eq!(html, b"<!doctype html>");
        let css = repo
            .read_file(&format!("modules/wm/{version_dir}/widgets/w1/static/theme.css"))
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

        let version_dir = version_dir_of(&mid);
        let bytes = repo
            .read_file(&format!("modules/am/{version_dir}/assets/bell.mp3"))
            .await
            .expect("asset stored at modules/{module_key}/{version_dir}/assets/bell.mp3, not nested under assets/assets/");
        assert_eq!(bytes, b"fake-mp3-bytes");

        // The bug this guards against: a doubled "assets/assets/" prefix.
        assert!(
            repo.read_file(&format!("modules/am/{version_dir}/assets/assets/bell.mp3"))
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

    /// The retired `overlays[]` surface must stop the install rather than
    /// upload a file nothing can serve. Silently ignoring the field would let
    /// an author keep depending on something that never resolves, which is the
    /// failure this removal exists to end.
    #[tokio::test]
    async fn install_rejects_the_retired_overlays_field() {
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

        let files = vec![ModuleFile::new(
            "module.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::JSON),
            manifest_json.to_vec(),
        )];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/om/2.0.0.zip",
            None,
            "",
            false,
            &mid,
            "",
        )
        .await
        .expect_err("an overlay declaration must fail the install");

        let message = err.to_string();
        assert!(message.contains("overlays"), "unexpected error: {message}");
        assert!(
            message.contains("o1"),
            "the error must name the offending id: {message}"
        );
    }
}
