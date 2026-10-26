use anyhow::{Result, anyhow};
use lib_repository::Repository;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use tracing::{error, info, warn};

use super::canonical_id::CanonicalId;
use super::db_proxy::{
    CreateModuleFunctionJson, MarketplaceOrigin, ModuleFunctionRecord,
    provenance_from_created_by_type,
};
use super::db_proxy_client::ModuleDbProxy;
use super::manifest_validate::{
    self, InstallProvenance, InstallStep, ResolvedActionImpl, ResolvedManifest, SystemOnlyActions,
    WorkflowTriggerRef,
};
use super::module_file::ModuleFile;
use super::module_manifest::{
    ModuleManifest, ResolvedWorkflowStep, ResolvedWorkflowTrigger, WEBHOOK_EVENT_PREFIX,
    resolve_zip_file,
};
use super::resource_kind_ref;
use super::theme::InstalledModule;

/// Deletes every trigger, action, widget, background task and workflow
/// registered under `module_name`. Only a failed fresh install calls it,
/// when everything under that id is its own.
///
/// `module_name` is the version-free manifest id — the value stored as
/// `created_by_ref`, and what every delete-by-module-id call matches on.
/// `module_key` is the composite `{id}:{version}:{hash}` that failed; it
/// never participates in matching and is carried only so the deregistration
/// events name the exact version that went away.
///
/// Commands are left to `delete_commands_created_by_install`, which keeps
/// any an earlier install left behind.
async fn delete_registered_resources(
    proxy: &dyn ModuleDbProxy,
    module_name: &str,
    module_key: &str,
) -> Result<()> {
    proxy
        .delete_triggers_by_module_id(module_name, module_key)
        .await?;
    proxy
        .delete_actions_by_module_id(module_name, module_key)
        .await?;
    proxy
        .delete_widgets_by_module_id(module_name, module_key)
        .await?;
    proxy
        .delete_background_tasks_by_module_id(module_name, module_key)
        .await?;
    info!(
        "Deleted triggers, actions, widgets, and background tasks for module {}",
        module_name
    );

    proxy.delete_workflows_by_module(module_name).await?;
    info!("Deleted workflows for module {}", module_name);

    Ok(())
}

/// Deletes the module's commands that `manifest` no longer declares. Runs
/// after a successful install, so an upgrade converges on exactly the new
/// manifest's commands while keeping the rows (and edits) of every command
/// it still declares. Best-effort, like `prune_removed_resources`: a
/// leftover command is harmless next to a failed install.
async fn prune_removed_commands(
    db_proxy: &dyn ModuleDbProxy,
    module_name: &str,
    manifest: &ModuleManifest,
) {
    let declared: std::collections::HashSet<&str> =
        manifest.commands.iter().map(|c| c.command_name()).collect();
    let existing = match db_proxy.list_commands_by_module(module_name).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!(
                "prune_removed_commands: listing commands for {} failed: {}",
                module_name, e
            );
            return;
        }
    };
    for row in existing
        .iter()
        .filter(|row| !declared.contains(row.command.as_str()))
    {
        match db_proxy.delete_command(&row.id).await {
            Ok(()) => info!(
                "Removed command '{}' from module {} (dropped from manifest)",
                row.command, module_name
            ),
            Err(e) => warn!(
                "prune_removed_commands: failed to delete command {} for {}: {}",
                row.command, module_name, e
            ),
        }
    }
}

/// Deletes the module's commands that were not there before this install
/// began: the ones it created. Commands an earlier install left behind stay,
/// because they may carry the streamer's edits and a failed upgrade must
/// not cost them those.
async fn delete_commands_created_by_install(
    db_proxy: &dyn ModuleDbProxy,
    module_name: &str,
    preexisting_command_ids: &std::collections::HashSet<String>,
) {
    let existing = match db_proxy.list_commands_by_module(module_name).await {
        Ok(rows) => rows,
        Err(e) => {
            warn!(
                "rollback: listing commands for {} failed: {}",
                module_name, e
            );
            return;
        }
    };
    for row in existing
        .iter()
        .filter(|row| !preexisting_command_ids.contains(&row.id))
    {
        if let Err(e) = db_proxy.delete_command(&row.id).await {
            warn!(
                "rollback: failed to delete command {} for {}: {}",
                row.command, module_name, e
            );
        }
    }
}

/// Compensating cleanup for a half-completed fresh install: no earlier version
/// of the module existed, so everything registered under its id is this
/// install's and goes, row included, and the next attempt doesn't trip the
/// `modules_name_key` unique constraint. Each step is best-effort — a cleanup
/// error is logged and suppressed so the original install error surfaces to
/// the caller. An upgrade is compensated by `restore_previous_install`.
async fn rollback_db_install(
    db_proxy: &dyn ModuleDbProxy,
    manifest_module_key: &str,
    composite_module_key: &str,
    module_name: &str,
    db_record_id: &str,
    preexisting_command_ids: &std::collections::HashSet<String>,
) {
    if let Err(e) =
        delete_registered_resources(db_proxy, manifest_module_key, composite_module_key).await
    {
        warn!(
            "rollback: delete_registered_resources({}) failed: {}",
            manifest_module_key, e
        );
    }
    delete_commands_created_by_install(db_proxy, manifest_module_key, preexisting_command_ids)
        .await;
    if !name_resolves_to_installed_row(db_proxy, module_name, manifest_module_key, db_record_id)
        .await
    {
        return;
    }
    if let Err(e) = db_proxy.delete_module(module_name).await {
        warn!("rollback: delete_module({}) failed: {}", module_name, e);
    } else {
        info!("rollback: removed module row for {}", module_name);
    }
}

/// Whether `DeleteModule(module_name)` would delete the row this install
/// created (`db_record_id`, holding `module_id`). The db resolves a module
/// name against both the name and the module_id column, so a name that is
/// also another module's id can resolve to that module's row; the rollback
/// then leaves its own row in place (logged) rather than delete another
/// module.
async fn name_resolves_to_installed_row(
    db_proxy: &dyn ModuleDbProxy,
    module_name: &str,
    module_id: &str,
    db_record_id: &str,
) -> bool {
    let body = match db_proxy.get_module_by_name(module_name).await {
        Ok(Some(body)) => body,
        Ok(None) => {
            info!("rollback: no module row named {} to remove", module_name);
            return false;
        }
        Err(e) => {
            warn!(
                "rollback: look up module row {} failed, leaving it in place: {}",
                module_name, e
            );
            return false;
        }
    };
    let row = match serde_json::from_str::<ModuleRowBody>(&body) {
        Ok(parsed) => parsed.module,
        Err(e) => {
            warn!(
                "rollback: read module row {} failed, leaving it in place: {}",
                module_name, e
            );
            return false;
        }
    };
    if row.id != db_record_id || row.module_id != module_id {
        warn!(
            "rollback: module name {} resolves to row {} of module {:?}, not this install's row {} of {}; leaving it in place",
            module_name, row.id, row.module_id, db_record_id, module_id
        );
        return false;
    }
    true
}

/// The identity of a module row in a `GetModuleByName` response.
#[derive(Debug, Deserialize)]
struct ModuleRowBody {
    module: ModuleRowIdentity,
}

#[derive(Debug, Deserialize)]
struct ModuleRowIdentity {
    id: String,
    #[serde(default)]
    module_id: String,
}

/// The installed version of a module as the db holds it before an install
/// touches anything: what a failed upgrade is restored to, and what a
/// successful one is diffed against to archive the resources it dropped.
/// Field names are the proto names Twirp's JSON uses.
#[derive(Debug, Clone, Deserialize)]
struct PreviousInstall {
    name: String,
    /// Empty for a row written before module_id was recorded.
    #[serde(default)]
    module_id: String,
    module_key: String,
    version: String,
    #[serde(default)]
    manifest: String,
    #[serde(default)]
    archive_key: String,
    #[serde(rename = "created_by_type", deserialize_with = "provenance_field")]
    provenance: InstallProvenance,
    #[serde(default)]
    created_by_ref: String,
    #[serde(default)]
    marketplace_listing_id: Option<String>,
    #[serde(default)]
    marketplace_edition: Option<i32>,
    #[serde(default)]
    functions: Vec<ModuleFunctionRecord>,
}

#[derive(Debug, Deserialize)]
struct PreviousInstallBody {
    module: PreviousInstall,
}

fn provenance_field<'de, D>(deserializer: D) -> std::result::Result<InstallProvenance, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let created_by_type = String::deserialize(deserializer)?;
    provenance_from_created_by_type(&created_by_type).map_err(serde::de::Error::custom)
}

impl PreviousInstall {
    /// Parses a `GetModuleByModuleId` Twirp JSON response body.
    fn from_response(module_id: &str, body: &str) -> Result<Self> {
        serde_json::from_str::<PreviousInstallBody>(body)
            .map(|parsed| parsed.module)
            .map_err(|e| anyhow!("read installed module {}: {}", module_id, e))
    }

    /// The manifest this version was installed from, or `None` when it
    /// cannot be parsed (logged): there is then nothing to diff against.
    fn parsed_manifest(&self) -> Option<ModuleManifest> {
        match serde_json::from_str(&self.manifest) {
            Ok(manifest) => Some(manifest),
            Err(e) => {
                warn!(
                    "stored manifest of {} {} does not parse: {}",
                    self.module_id, self.version, e
                );
                None
            }
        }
    }

    /// The provenance and installing client the row was stamped with, so a
    /// restore stamps it the same way (see `db_proxy::create_module`).
    fn provenance(&self) -> (InstallProvenance, &str) {
        let client_id = match self.provenance {
            InstallProvenance::System => "",
            InstallProvenance::User => self.created_by_ref.as_str(),
        };
        (self.provenance, client_id)
    }

    fn marketplace(&self) -> Option<MarketplaceOrigin> {
        match (&self.marketplace_listing_id, self.marketplace_edition) {
            (Some(listing_id), Some(edition)) => Some(MarketplaceOrigin {
                listing_id: listing_id.clone(),
                edition,
            }),
            _ => None,
        }
    }

    fn function_rows(&self) -> Vec<CreateModuleFunctionJson> {
        self.functions
            .iter()
            .map(|f| CreateModuleFunctionJson {
                manifest_id: f.manifest_id.clone(),
                name: f.name.clone(),
                file_name: f.file_name.clone(),
                file_key: f.file_key.clone(),
                entry_point: f.entry_point.clone(),
                runtime: f.runtime.clone(),
            })
            .collect()
    }
}

/// The installed version of `module_id`, or `None` for a fresh install. A
/// failed lookup fails the install before it writes anything: without it
/// there is no telling whether a failure later must restore a working
/// version or remove a new one.
///
/// A row named `name` with no module_id is the installed version too:
/// CreateModule adopts such a row (written before module_id was recorded),
/// so a failed install over it is an upgrade to restore, not a fresh
/// install to delete.
async fn fetch_previous_install(
    db_proxy: &dyn ModuleDbProxy,
    module_id: &str,
    name: &str,
) -> Result<Option<PreviousInstall>> {
    if let Some(body) = db_proxy
        .get_module_by_module_id(module_id)
        .await
        .map_err(|e| anyhow!("look up installed module {}: {}", module_id, e))?
    {
        return PreviousInstall::from_response(module_id, &body).map(Some);
    }
    let Some(body) = db_proxy
        .get_module_by_name(name)
        .await
        .map_err(|e| anyhow!("look up installed module named {}: {}", name, e))?
    else {
        return Ok(None);
    };
    let row = serde_json::from_str::<ModuleRowBody>(&body)
        .map_err(|e| anyhow!("read installed module named {}: {}", name, e))?;
    if !row.module.module_id.is_empty() {
        return Ok(None);
    }
    PreviousInstall::from_response(module_id, &body).map(Some)
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
        removed(
            old.background_tasks.iter().map(|t| t.id.as_str()),
            &new_background_tasks,
        )
        .into_iter()
        .map(|id| ("background_task", id)),
    );

    out
}

/// Removes the resources `previous` declared that `new_manifest` does not,
/// once the install of `new_manifest` has succeeded: see
/// `remove_resources`. A previous version whose stored manifest does not
/// parse is left as it is.
async fn prune_removed_resources(
    db_proxy: &dyn ModuleDbProxy,
    module_key: &str,
    previous: &PreviousInstall,
    new_manifest: &ModuleManifest,
) {
    let Some(prev_manifest) = previous.parsed_manifest() else {
        return;
    };
    let removed = removed_manifest_ids(&prev_manifest, new_manifest);
    remove_resources(db_proxy, module_key, removed, "dropped from manifest").await;
}

/// The host and port settings of `new`'s `local[]` endpoints that `previous`
/// did not use as that endpoint's host or port: a key that is new, or that
/// differs from the installed manifest's key for the same endpoint id. With
/// no previous manifest (a fresh install, or one whose stored manifest does
/// not parse) every endpoint's keys count as new.
///
/// Such a key may already hold a value written while it was an ordinary
/// setting, which module code could write; once it is an endpoint setting
/// that value decides where the engine connects. Password settings are left
/// out: a planted password cannot redirect the engine anywhere.
fn relocated_endpoint_address_settings<'a>(
    previous: Option<&ModuleManifest>,
    new: &'a ModuleManifest,
) -> Vec<&'a str> {
    let mut relocated = Vec::new();
    for endpoint in &new.local {
        let installed = previous.and_then(|manifest| {
            manifest
                .local
                .iter()
                .find(|installed| installed.id == endpoint.id)
        });
        let (installed_host, installed_port) = match installed {
            Some(installed) => (
                Some(installed.host_setting.as_str()),
                Some(installed.port_setting.as_str()),
            ),
            None => (None, None),
        };
        if installed_host != Some(endpoint.host_setting.as_str()) {
            relocated.push(endpoint.host_setting.as_str());
        }
        if installed_port != Some(endpoint.port_setting.as_str()) {
            relocated.push(endpoint.port_setting.as_str());
        }
    }
    relocated
}

/// What a successful install leaves for its caller to finish once the
/// module is registered again in the sandbox.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct InstallOutcome {
    /// The local endpoint address settings the install reset
    /// (`relocated_endpoint_address_settings`). Until the sandbox registry is
    /// refreshed, code of the previous version can still write them, so the
    /// caller resets them again after the refresh
    /// (`ModuleService::finish_install`). From then on the
    /// registry refuses those writes, including from invocations already
    /// running.
    pub relocated_endpoint_settings: Vec<String>,
}

/// Puts each of `keys`, local endpoint address settings of `manifest`, back
/// to the value a newly registered key starts with: the manifest's default,
/// empty when it declares none. db-proxy stores an unset setting as an empty
/// value and has no delete for one setting, so this is how a stored value is
/// removed. A key with no stored row, or already holding its default, is
/// left alone, so running this again changes nothing.
///
/// Trade-off: a value the streamer typed into the setting before it became an
/// endpoint setting is cleared once, and the streamer or the companion sets
/// it again.
pub async fn reset_endpoint_settings(
    db_proxy: &dyn ModuleDbProxy,
    manifest: &ModuleManifest,
    keys: &[String],
) -> Result<()> {
    if keys.is_empty() {
        return Ok(());
    }
    let module_key = manifest.module_key();
    let stored = db_proxy
        .get_module_settings(module_key)
        .await
        .map_err(|e| anyhow!("clear endpoint settings: read settings: {e}"))?;
    for key in keys {
        let Some(row) = stored.iter().find(|row| &row.key == key) else {
            continue;
        };
        let default = manifest
            .settings
            .iter()
            .find(|setting| &setting.id == key)
            .map(|setting| setting.resolved_default())
            .ok_or_else(|| anyhow!("clear endpoint settings: `{key}` is not a declared setting"))?;
        if row.value == default {
            continue;
        }
        db_proxy
            .set_module_setting(module_key, key, &default)
            .await
            .map_err(|e| anyhow!("clear endpoint setting `{key}`: {e}"))?;
        info!(
            "Cleared module {}'s setting {}: it became a local endpoint address setting",
            module_key, key
        );
    }
    Ok(())
}

/// Archives each `(resource_type, manifest_id)` (background_task is
/// hard-deleted instead — see `db_proxy::delete_resource_by_manifest_id`'s
/// doc comment for why that one kind is safe to delete outright).
/// Archiving keeps a removed resource resolvable by canonical id, so any
/// workflow or command that already references it keeps working, while
/// hiding it from catalog listings going forward. Best-effort: a failure is
/// logged and the rest still go.
async fn remove_resources(
    db_proxy: &dyn ModuleDbProxy,
    module_key: &str,
    resources: Vec<(&'static str, String)>,
    reason: &str,
) {
    for (resource_type, manifest_id) in resources {
        let result = if resource_type == "background_task" {
            db_proxy
                .delete_resource_by_manifest_id(module_key, resource_type, &manifest_id)
                .await
        } else {
            db_proxy
                .archive_resource_by_manifest_id(module_key, resource_type, &manifest_id)
                .await
        };
        if let Err(e) = result {
            warn!(
                "failed to remove {} {} for {} ({}): {}",
                resource_type, manifest_id, module_key, reason, e
            );
        } else {
            info!(
                "Removed {} '{}' from module {} ({})",
                resource_type, manifest_id, module_key, reason
            );
        }
    }
}

/// Compensates a failed upgrade by putting `previous` back: the commands the
/// install created and the resources only the new manifest declares are
/// removed, and the module row and its functions are rewritten to the
/// previous version (the db replaces a module in one transaction, so this
/// lands whole or not at all). Nothing the previous version registered is
/// deleted. Resources both versions declare keep the definitions the failed
/// install registered for them.
///
/// Returns an error when the row cannot be restored: the module is then left
/// on the half-installed version, which the caller must report.
async fn restore_previous_install(
    db_proxy: &dyn ModuleDbProxy,
    module_key: &str,
    previous: &PreviousInstall,
    new_manifest: &ModuleManifest,
    preexisting_command_ids: &std::collections::HashSet<String>,
) -> Result<()> {
    delete_commands_created_by_install(db_proxy, module_key, preexisting_command_ids).await;
    if let Some(prev_manifest) = previous.parsed_manifest() {
        let added = removed_manifest_ids(new_manifest, &prev_manifest);
        remove_resources(
            db_proxy,
            module_key,
            added,
            "rolled back with a failed upgrade",
        )
        .await;
    }

    // `module_key`, not `previous.module_id`: a legacy row has none, and
    // the failed install already stamped it with `module_key`.
    let (provenance, client_id) = previous.provenance();
    db_proxy
        .create_module(
            &previous.name,
            module_key,
            &previous.version,
            &previous.manifest,
            &previous.archive_key,
            &previous.function_rows(),
            &previous.module_key,
            client_id,
            provenance,
            previous.marketplace().as_ref(),
        )
        .await
        .map_err(|e| anyhow!("restore {} {}: {}", previous.module_id, previous.version, e))?;
    info!(
        "rollback: restored module {} to {}",
        previous.module_id, previous.module_key
    );
    Ok(())
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
    client_id: &'a str,
    archive_key: &'a str,
    provenance: InstallProvenance,
    marketplace: Option<&'a MarketplaceOrigin>,
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
            InstallStep::RegisterBackgroundTasks => {
                self.execute_register_background_tasks(db_proxy).await
            }
            InstallStep::RegisterSettings => self.execute_register_settings(db_proxy).await,
            InstallStep::LinkResourceSettings => {
                self.execute_link_resource_settings(db_proxy).await
            }
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
        check_theme_files(self.manifest, self.files)?;

        for f in &self.manifest.functions {
            let file_key = f
                .upload_to_repository(
                    self.module_key,
                    self.version_dir,
                    self.files,
                    self.repository,
                )
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
            w.upload_assets(
                self.module_key,
                self.version_dir,
                self.files,
                self.repository,
            )
            .await?;
        }

        // Upload static assets declared in manifest.assets[]. Each asset
        // is written to the repository under `modules/<moduleKey>/<versionDir>/<path>`
        // (path already carries its own directory, e.g. `assets/bell.mp3`
        // — see ManifestAsset::upload_to_repository) and the resulting key
        // is captured for the RegisterAssets call further down.
        for a in &self.manifest.assets {
            let repo_key = a
                .upload_to_repository(
                    self.module_key,
                    self.version_dir,
                    self.files,
                    self.repository,
                )
                .await?;
            self.asset_keys.push(repo_key);
        }
        for t in &self.manifest.themes {
            t.upload_files(
                self.module_key,
                self.version_dir,
                self.files,
                self.repository,
            )
            .await?;
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
                self.marketplace,
            )
            .await?;

        // Record function resources in ledger. `resource_name` is the
        // canonical id — that's the value the in-use check and any
        // future reference resolution joins on. `manifest_id` keeps
        // the author's local id for debugging / display.
        for (i, f) in self.manifest.functions.iter().enumerate() {
            let canonical = self.resolved.functions[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(
                    &db_record_id,
                    "function",
                    "",
                    &f.id,
                    &canonical,
                    &self.manifest.version,
                )
                .await
            {
                warn!("Failed to record function resource {}: {}", canonical, e);
            }
        }

        // Record widget resources in ledger
        for (i, w) in self.manifest.widgets.iter().enumerate() {
            let canonical = self.resolved.widgets[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(
                    &db_record_id,
                    "widget",
                    "",
                    &w.id,
                    &canonical,
                    &self.manifest.version,
                )
                .await
            {
                warn!("Failed to record widget resource {}: {}", canonical, e);
            }
        }

        // A theme's ledger row is what a scene's reference edge to it joins
        // on, so uninstalling a theme that is on screen is refused.
        for (i, t) in self.manifest.themes.iter().enumerate() {
            let canonical = self.resolved.themes[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(
                    &db_record_id,
                    "theme",
                    "",
                    &t.id,
                    &canonical,
                    &self.manifest.version,
                )
                .await
            {
                warn!("Failed to record theme resource {}: {}", canonical, e);
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
        let trigger_inputs: Vec<_> = self
            .manifest
            .triggers
            .iter()
            .map(|t| t.to_input(&self.resolved.module_id))
            .collect();
        info!(
            "Registering {} trigger(s) for module {} (moduleKey={})",
            trigger_inputs.len(),
            self.module_key,
            self.composite_module_key
        );
        db_proxy
            .register_triggers(
                self.module_key,
                self.composite_module_key,
                &self.manifest.name,
                &self.manifest.version,
                trigger_inputs,
            )
            .await?;

        // Ledger rows record one resource per trigger, keyed by canonical id.
        for (i, t) in self.manifest.triggers.iter().enumerate() {
            let canonical = self.resolved.triggers[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(
                    db_record_id,
                    "trigger",
                    "",
                    &t.id,
                    &canonical,
                    &self.manifest.version,
                )
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
                    ResolvedActionImpl::Function {
                        canonical_function_id,
                    } => ("function".to_string(), canonical_function_id.to_string()),
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
            .register_actions(
                self.module_key,
                self.composite_module_key,
                &self.manifest.name,
                &self.manifest.version,
                action_inputs,
            )
            .await?;

        for (i, a) in self.manifest.actions.iter().enumerate() {
            let canonical = self.resolved.actions[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(
                    db_record_id,
                    "action",
                    "",
                    &a.id,
                    &canonical,
                    &self.manifest.version,
                )
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
        info!(
            "Registering {} setting(s) for module {}",
            setting_inputs.len(),
            self.module_key
        );
        db_proxy
            .register_module_settings(self.module_key, setting_inputs)
            .await
            .map_err(|e| anyhow!("register settings: {}", e))?;
        Ok(())
    }

    /// Links every `resource_ref` setting that declares `create` and is still
    /// empty: the instance is `{declaring module}:{kind}:{instanceId}`, made
    /// when it does not exist yet and reused when it does, so a reinstall or a
    /// second module asking for the same instance links rather than fails.
    ///
    /// A setting that already holds a value is left alone, whether install
    /// linked it before or the streamer picked another instance since.
    async fn execute_link_resource_settings(&self, db_proxy: &dyn ModuleDbProxy) -> Result<()> {
        let current: HashMap<String, String> = db_proxy
            .get_module_settings(self.module_key)
            .await
            .map_err(|e| anyhow!("link resource settings: read settings: {e}"))?
            .into_iter()
            .map(|s| (s.key, s.value))
            .collect();
        for setting in &self.manifest.settings {
            let (Some(create), Some(kind_ref)) =
                (&setting.create, setting.resource_kind.as_deref())
            else {
                continue;
            };
            if current
                .get(&setting.id)
                .is_some_and(|v| !v.trim().is_empty())
            {
                continue;
            }
            let parsed = resource_kind_ref::parse_kind_ref(kind_ref, "resourceKind")?;
            let Some(owner) = parsed.module else {
                return Err(anyhow!(
                    "setting `{}`: resourceKind {kind_ref:?} was not qualified before install",
                    setting.id
                ));
            };
            let kind = parsed.kind;
            let canonical_id = format!("{owner}:{kind}:{}", create.instance_id);
            let existing = db_proxy
                .get_resource_instance(&canonical_id)
                .await
                .map_err(|e| anyhow!("setting `{}`: look up {canonical_id}: {e}", setting.id))?;
            if existing.is_none() {
                let settings_json = create
                    .settings
                    .as_ref()
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "{}".to_string());
                db_proxy
                    .create_resource_instance(
                        owner,
                        kind,
                        &create.instance_id,
                        &create.display_name,
                        &settings_json,
                    )
                    .await
                    .map_err(|e| anyhow!("setting `{}`: create {canonical_id}: {e}", setting.id))?;
                info!(
                    "Created {} for module {}'s setting {}",
                    canonical_id, self.module_key, setting.id
                );
            }
            db_proxy
                .set_module_setting(self.module_key, &setting.id, &canonical_id)
                .await
                .map_err(|e| anyhow!("setting `{}`: link {canonical_id}: {e}", setting.id))?;
            info!(
                "Linked module {}'s setting {} to {}",
                self.module_key, setting.id, canonical_id
            );
        }
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
            .register_assets(
                self.module_key,
                self.composite_module_key,
                &self.manifest.name,
                &self.manifest.version,
                asset_inputs,
            )
            .await?;

        for (i, a) in self.manifest.assets.iter().enumerate() {
            let canonical = self.resolved.assets[i].canonical_id.to_string();
            if let Err(e) = db_proxy
                .create_module_resource(
                    db_record_id,
                    "asset",
                    "",
                    &a.id,
                    &canonical,
                    &self.manifest.version,
                )
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
            .ok_or_else(|| {
                anyhow!(
                    "internal: install plan references workflow {} not found in resolved manifest",
                    canonical_id
                )
            })?;
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
                    .map(|t| t.event_subject(&self.resolved.module_id))
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
                if event_subject.starts_with(WEBHOOK_EVENT_PREFIX) {
                    return Err(anyhow!(
                        "bundled workflow {} cannot bind to webhook trigger {}; bind to an event its handler returns",
                        wf.id,
                        canonical,
                    ));
                }
                ResolvedWorkflowTrigger {
                    trigger_ref: canonical,
                    event_subject,
                }
            }
        };

        let resolved_steps_ctx = self
            .resolve_steps(
                &format!("bundled workflow {}", wf.id),
                &resolved_wf.step_actions,
                db_proxy,
            )
            .await?;

        wf.register(
            self.module_key,
            db_proxy,
            &resolved_trigger_ctx,
            &resolved_steps_ctx,
            &self.asset_repo_keys,
        )
        .await?;
        let canonical = resolved_wf.canonical_id.to_string();
        if let Err(e) = db_proxy
            .create_module_resource(
                db_record_id,
                "workflow",
                "",
                &wf.id,
                &canonical,
                &self.manifest.version,
            )
            .await
        {
            warn!("Failed to record workflow resource {}: {}", canonical, e);
        }
        Ok(())
    }

    /// Resolves each step's action to what the engine dispatches, for a
    /// workflow's steps or a command's actions. Same-module actions resolve
    /// via the local manifest's resolved actions table. Cross-module actions
    /// get a db lookup to recover the action's `call` (a canonical function
    /// id) so the step's `function` field can be baked in. `owner` names the
    /// workflow or command in errors.
    async fn resolve_steps(
        &self,
        owner: &str,
        step_actions: &[CanonicalId],
        db_proxy: &dyn ModuleDbProxy,
    ) -> Result<Vec<ResolvedWorkflowStep>> {
        let mut resolved_steps: Vec<ResolvedWorkflowStep> = Vec::with_capacity(step_actions.len());
        for (si, action_canonical) in step_actions.iter().enumerate() {
            // (engine_action, function_call) — engine_action is
            // the workflow handler name (function / alert / …);
            // function_call is set only when engine_action is
            // "function" (the canonical fn id to invoke).
            let (engine_action, function_call): (String, Option<String>) = if action_canonical
                .module_id()
                == self.resolved.module_id
            {
                let resolved_action = self
                    .resolved
                    .actions
                    .iter()
                    .find(|a| a.canonical_id.resource_id() == action_canonical.resource_id())
                    .ok_or_else(|| {
                        anyhow!(
                            "internal: {} step #{} references action {} not found in resolved actions",
                            owner,
                            si,
                            action_canonical,
                        )
                    })?;
                match &resolved_action.implementation {
                    ResolvedActionImpl::Function {
                        canonical_function_id: cid,
                    } => ("function".to_string(), Some(cid.to_string())),
                    // The step dispatches straight through the engine
                    // handler; there is no function for it to name.
                    ResolvedActionImpl::Native { handler } => (handler.clone(), None),
                }
            } else {
                let canonical = action_canonical.to_string();
                let resolved_ref = db_proxy
                    .get_action_ref_by_canonical_id(&canonical)
                    .await
                    .map_err(|e| {
                        anyhow!(
                            "{} step #{} references action {} but the action could not be resolved (is the owning module installed?): {}",
                            owner,
                            si,
                            canonical,
                            e,
                        )
                    })?;
                (resolved_ref.action_type, resolved_ref.function_call)
            };
            resolved_steps.push(ResolvedWorkflowStep {
                action_ref: action_canonical.to_string(),
                engine_action,
                function_call,
            });
        }
        Ok(resolved_steps)
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
            .ok_or_else(|| {
                anyhow!(
                    "internal: install plan references command {} not found in resolved manifest",
                    canonical_id
                )
            })?;
        let cmd = &self.manifest.commands[i];
        let resolved_cmd = &self.resolved.commands[i];
        let resolved_workflow = resolved_cmd.workflow.as_ref().map(|c| c.to_string());
        let resolved_steps = self
            .resolve_steps(
                &format!("command {}", cmd.id),
                &resolved_cmd.step_actions,
                db_proxy,
            )
            .await?;
        cmd.register(
            self.module_key,
            db_proxy,
            resolved_workflow.as_deref(),
            &resolved_steps,
            &self.asset_repo_keys,
        )
        .await?;

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
                    v.get("module")
                        .and_then(|m| m.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string()
                }
                _ => String::new(),
            };
            self.module_record_id_for_commands = Some(mid);
        }
        let mid = self.module_record_id_for_commands.as_deref().unwrap_or("");

        let canonical = resolved_cmd.canonical_id.to_string();
        if !mid.is_empty()
            && let Err(e) = db_proxy
                .create_module_resource(
                    mid,
                    "command",
                    "",
                    &cmd.id,
                    &canonical,
                    &self.manifest.version,
                )
                .await
        {
            warn!("Failed to record command resource {}: {}", canonical, e);
        }
        Ok(())
    }
}

/// Fail the install, before anything is written, when a file a theme or a
/// theme contract names is not in the archive.
fn check_theme_files(manifest: &ModuleManifest, files: &[ModuleFile]) -> Result<()> {
    for t in &manifest.themes {
        for rel in t.files() {
            if resolve_zip_file(files, rel).is_none() {
                return Err(anyhow!(
                    "theme {}: file '{}' not found in module archive",
                    t.id,
                    rel
                ));
            }
        }
    }
    for w in &manifest.widgets {
        let Some(contract) = &w.theme else {
            continue;
        };
        for slot in &contract.asset_slots {
            if let Some(default) = &slot.default
                && resolve_zip_file(files, default).is_none()
            {
                return Err(anyhow!(
                    "widget {}: `theme.assetSlots` {} default '{}' not found in module archive",
                    w.id,
                    slot.id,
                    default
                ));
            }
        }
    }
    Ok(())
}

/// A user-provenance install that knows of no `systemOnly` actions, so it
/// refuses no reference as reserved. Uploads go through
/// `ModuleService::install`, which carries the bundled set.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub async fn run_install<R: Repository>(
    manifest: &ModuleManifest,
    files: &[ModuleFile],
    repository: &R,
    archive_key: &str,
    db_proxy: Option<&dyn ModuleDbProxy>,
    composite_module_key: &str,
    client_id: &str,
) -> Result<InstallOutcome> {
    run_install_with_provenance(
        manifest,
        files,
        repository,
        archive_key,
        db_proxy,
        composite_module_key,
        client_id,
        InstallProvenance::User,
        None,
        &SystemOnlyActions::default(),
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
///
/// `marketplace` is the listing the archive came from, recorded on the module
/// row; `None` for any other install.
///
/// An install never removes anything the installed version registered until
/// every step has succeeded: resources the new manifest drops are archived
/// after it. A failed upgrade restores the installed version
/// (`restore_previous_install`); a failed fresh install removes what it
/// registered (`rollback_db_install`).
///
/// The caller refreshes the sandbox registry after a successful install and
/// then finishes what the returned `InstallOutcome` names.
#[allow(clippy::too_many_arguments)]
pub async fn run_install_with_provenance<R: Repository>(
    manifest: &ModuleManifest,
    files: &[ModuleFile],
    repository: &R,
    archive_key: &str,
    db_proxy: Option<&dyn ModuleDbProxy>,
    composite_module_key: &str,
    client_id: &str,
    provenance: InstallProvenance,
    marketplace: Option<&MarketplaceOrigin>,
    system_only: &SystemOnlyActions,
) -> Result<InstallOutcome> {
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
    // Before validation, because validation serializes the schemas that get
    // registered: those must carry the qualified kinds. See
    // `resource_kind_ref` for why a kind is fixed at install.
    let qualified;
    let manifest = match db_proxy {
        Some(proxy) if resource_kind_ref::names_other_modules_kinds(manifest) => {
            let installed: Vec<InstalledModule> = proxy
                .list_modules()
                .await
                .map_err(|e| anyhow!("resolve resource kinds: list modules: {e}"))?
                .into_iter()
                .filter_map(InstalledModule::from_record)
                .collect();
            qualified = resource_kind_ref::qualify_resource_kinds(manifest, &installed)
                .map_err(|e| anyhow!("manifest validation failed: {}", e))?;
            &qualified
        }
        _ => {
            qualified = resource_kind_ref::qualify_resource_kinds(manifest, &[])
                .map_err(|e| anyhow!("manifest validation failed: {}", e))?;
            &qualified
        }
    };

    let resolved = manifest_validate::validate_with_provenance(manifest, provenance)
        .map_err(|e| anyhow!("manifest validation failed: {}", e))?;
    manifest_validate::refuse_system_only_references(&resolved, provenance, system_only)
        .map_err(|e| anyhow!("manifest validation failed: {}", e))?;

    // Build the full install plan (graph + cross-module validation +
    // topo-sort) up front, before any side effect runs — same fail-fast
    // guarantee `validate_cross_module_dependencies` used to give on its
    // own, now folded into plan construction (see
    // `manifest_validate::build_install_plan`).
    let plan = match db_proxy {
        Some(proxy) => {
            Some(manifest_validate::build_install_plan(manifest, &resolved, proxy).await?)
        }
        None => None,
    };

    // Taken before any db write: whether a version is installed decides how
    // a failure is compensated, and it is what a success is diffed against.
    let previous = match db_proxy {
        Some(proxy) => fetch_previous_install(proxy, module_key, &manifest.name).await?,
        None => None,
    };

    let mut state = SagaState {
        manifest,
        resolved: &resolved,
        files,
        repository,
        module_key,
        version_dir,
        composite_module_key,
        client_id,
        archive_key,
        provenance,
        marketplace,
        fn_rows: Vec::with_capacity(manifest.functions.len()),
        asset_keys: Vec::with_capacity(manifest.assets.len()),
        asset_repo_keys: HashMap::new(),
        db_record_id: None,
        module_record_id_for_commands: None,
    };
    state.upload_files().await?;

    let mut outcome = InstallOutcome::default();
    if let Some(proxy) = db_proxy {
        let plan = plan.expect("plan was built above whenever db_proxy is Some");

        // Taken before any db write so a rollback can tell the commands this
        // install created from the ones an earlier install left behind.
        let preexisting_command_ids: std::collections::HashSet<String> = proxy
            .list_commands_by_module(module_key)
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect();

        // Saga-style install: every step after `CreateModule` must be
        // paired with a compensating cleanup if the install fails
        // partway through. Run the whole plan inside one async block so
        // a single rollback path handles any step's failure.
        let install_result: Result<Vec<String>> = async {
            for step in &plan {
                state.execute(step, proxy).await?;
            }
            // Last, so a value is cleared only once every other step has
            // succeeded; a failure here still restores the previous version.
            let previous_manifest = previous.as_ref().and_then(PreviousInstall::parsed_manifest);
            let relocated: Vec<String> =
                relocated_endpoint_address_settings(previous_manifest.as_ref(), manifest)
                    .into_iter()
                    .map(str::to_string)
                    .collect();
            reset_endpoint_settings(proxy, manifest, &relocated).await?;
            Ok(relocated)
        }
        .await;

        let relocated = match install_result {
            Ok(relocated) => relocated,
            Err(e) => {
                // CreateModule is the first db write; until it succeeds this
                // install has written nothing to undo, and the module row the
                // db holds, if any, is not this install's.
                let Some(db_record_id) = state.db_record_id.clone() else {
                    return Err(e);
                };
                let Some(previous) = previous else {
                    warn!(
                        "install failed for module {} ({}): rolling back db state: {}",
                        manifest.name, composite_module_key, e
                    );
                    rollback_db_install(
                        proxy,
                        module_key,
                        composite_module_key,
                        &manifest.name,
                        &db_record_id,
                        &preexisting_command_ids,
                    )
                    .await;
                    return Err(e);
                };
                warn!(
                    "upgrade of module {} to {} failed: restoring {}: {}",
                    manifest.name, composite_module_key, previous.module_key, e
                );
                if let Err(restore) = restore_previous_install(
                    proxy,
                    module_key,
                    &previous,
                    manifest,
                    &preexisting_command_ids,
                )
                .await
                {
                    error!("rollback: {}", restore);
                    return Err(anyhow!(
                        "{e}; the previous version could not be restored: {restore}"
                    ));
                }
                return Err(e);
            }
        };

        if let Some(previous) = &previous {
            prune_removed_resources(proxy, module_key, previous, manifest).await;
        }
        prune_removed_commands(proxy, module_key, manifest).await;
        outcome.relocated_endpoint_settings = relocated;
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

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::super::db_proxy::ModuleCommandRow;
    use super::super::db_proxy_client::FakeDbProxyClient;
    use super::*;

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
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = system_manifest("woofx3");
        let files = vec![ModuleFile::new(
            "manifest.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
            manifest_json.clone(),
        )];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install_with_provenance(
            &manifest,
            &files,
            &repo,
            "archives/woofx3.zip",
            Some(&db_proxy),
            &mid,
            "",
            InstallProvenance::System,
            None,
            &SystemOnlyActions::default(),
        )
        .await
        .expect("system install succeeds");

        assert_eq!(
            db_proxy.create_module_provenance(),
            Some(InstallProvenance::System)
        );
    }

    #[tokio::test]
    async fn the_marketplace_origin_reaches_the_module_row() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = system_manifest("cozy");
        let files = vec![ModuleFile::new(
            "manifest.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
            manifest_json.clone(),
        )];
        let mid = manifest.compute_module_key(&manifest_json);
        let origin = MarketplaceOrigin {
            listing_id: "cozy-v2".to_string(),
            edition: 2,
        };

        let db_proxy = FakeDbProxyClient::new();
        run_install_with_provenance(
            &manifest,
            &files,
            &repo,
            "archives/cozy.zip",
            Some(&db_proxy),
            &mid,
            "client-1",
            InstallProvenance::User,
            Some(&origin),
            &SystemOnlyActions::default(),
        )
        .await
        .expect("marketplace install succeeds");

        assert_eq!(db_proxy.create_module_marketplace(), Some(origin));
    }

    #[tokio::test]
    async fn the_reserved_id_is_refused_under_user_provenance() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = system_manifest("woofx3");
        let files = vec![ModuleFile::new(
            "manifest.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
            manifest_json.clone(),
        )];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/woofx3.zip",
            Some(&db_proxy),
            &mid,
            "",
        )
        .await
        .expect_err("the reserved id must not install from an upload");
        assert!(
            err.to_string().contains("reserved"),
            "unexpected error: {err}"
        );
        assert!(
            db_proxy.calls().is_empty(),
            "validation must fail before any db write: {:?}",
            db_proxy.calls()
        );
    }

    #[tokio::test]
    async fn run_install_defaults_to_user_provenance() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = system_manifest("ordinary_module");
        let files = vec![ModuleFile::new(
            "manifest.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
            manifest_json.clone(),
        )];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/om.zip",
            Some(&db_proxy),
            &mid,
            "",
        )
        .await
        .expect("ordinary install succeeds");

        assert_eq!(
            db_proxy.create_module_provenance(),
            Some(InstallProvenance::User)
        );
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
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-1");
        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
                manifest_json.clone(),
            ),
            ModuleFile::new(
                "functions/f1.lua".into(),
                ModuleFileKind::PROGRAM(ModuleValidProgramKind::Lua),
                b"return 1".to_vec(),
            ),
        ];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-1.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect("install should succeed against a fake with no configured failures");

        // create_module (+ its embedded function ledger write) before
        // triggers before actions — the exact order `InstallStep::phase`
        // documents.
        let calls = db_proxy.calls();
        let idx = |name: &str| {
            calls
                .iter()
                .position(|c| c == name)
                .unwrap_or_else(|| panic!("{name} not called: {calls:?}"))
        };
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
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest_with_workflow("fault-mod-wf");
        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
                manifest_json.clone(),
            ),
            ModuleFile::new(
                "functions/f1.lua".into(),
                ModuleFileKind::PROGRAM(ModuleValidProgramKind::Lua),
                b"return 1".to_vec(),
            ),
        ];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-wf.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect("install should succeed against a fake with no configured failures");

        let calls = db_proxy.calls();
        let idx = |name: &str| {
            calls
                .iter()
                .position(|c| c == name)
                .unwrap_or_else(|| panic!("{name} not called: {calls:?}"))
        };
        assert!(idx("register_actions") < idx("register_workflow"));
        assert!(idx("register_workflow") < idx("register_command"));

        // A module's bundled workflows are part of what installing it means,
        // so they go live with the install rather than waiting to be switched on.
        let workflows = db_proxy.registered_workflows();
        assert!(!workflows.is_empty(), "no workflow registered");
        assert!(
            workflows.iter().all(|w| w.enabled),
            "a bundled workflow was registered disabled: {workflows:?}"
        );
    }

    #[tokio::test]
    async fn install_failure_registering_workflow_triggers_full_rollback() {
        // Proves RegisterWorkflow is genuinely part of the seam now: a
        // failure inside it (not just in its cross-module lookups) still
        // triggers the same compensating rollback as every other step.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest_with_workflow("fault-mod-wf-2");
        let files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
                manifest_json.clone(),
            ),
            ModuleFile::new(
                "functions/f1.lua".into(),
                ModuleFileKind::PROGRAM(ModuleValidProgramKind::Lua),
                b"return 1".to_vec(),
            ),
        ];
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["register_workflow"]);
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-wf-2.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("install should fail when register_workflow fails");
        assert!(
            err.to_string().contains("Failed to create workflow"),
            "got: {err}"
        );

        let calls = db_proxy.calls();
        let rollback_start = calls
            .iter()
            .position(|c| c == "register_workflow")
            .expect("register_workflow was attempted")
            + 1;
        assert_eq!(
            &calls[rollback_start..],
            &[
                "delete_triggers_by_module_id",
                "delete_actions_by_module_id",
                "delete_widgets_by_module_id",
                "delete_background_tasks_by_module_id",
                "delete_workflows_by_module",
                "list_commands_by_module",
                "get_module_by_name",
                "delete_module",
            ]
        );
        // register_command must never run — the plan aborts before it.
        assert!(!calls.contains(&"register_command".to_string()));
    }

    fn fault_test_files(manifest_json: &[u8]) -> Vec<ModuleFile> {
        vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "functions/f1.lua".into(),
                ModuleFileKind::PROGRAM(ModuleValidProgramKind::Lua),
                b"return 1".to_vec(),
            ),
        ]
    }

    const PREVIOUS_MODULE_KEY: &str = "fault-mod-up:0.9.0:0000000";

    /// The `GetModuleByModuleId` body for version 0.9.0 of `id`: it declares
    /// trigger `t_old` where `fault_test_manifest` declares `t1`, and the
    /// same function and action.
    fn previous_version_body(id: &str) -> String {
        serde_json::json!({ "module": previous_version_row(id) }).to_string()
    }

    /// The module row of version 0.9.0 of `id`, as `previous_version_body`
    /// describes it.
    fn previous_version_row(id: &str) -> serde_json::Value {
        let manifest = serde_json::json!({
            "id": id,
            "name": "Test Mod",
            "version": "0.9.0",
            "triggers": [{ "id": "t_old", "name": "T old", "type": "eventbus" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }]
        });
        serde_json::json!({
            "id": "row-1",
            "name": "Test Mod",
            "module_id": id,
            "module_key": PREVIOUS_MODULE_KEY,
            "version": "0.9.0",
            "manifest": manifest.to_string(),
            "archive_key": "archives/fault-mod-up-0.9.0.zip",
            "state": "active",
            "created_by_type": "CLIENT",
            "created_by_ref": "client-1",
            "functions": [{
                "manifest_id": "f1",
                "name": "F1",
                "file_name": "f1.lua",
                "file_key": "modules/fault-mod-up/0000000/functions/f1.lua",
                "entry_point": "",
                "runtime": "lua"
            }]
        })
    }

    #[tokio::test]
    async fn failed_fresh_install_leaves_the_module_whose_id_is_its_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-evil");
        let files = fault_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        // Another module whose manifest id is this upload's display name:
        // the db resolves DeleteModule("Test Mod") to that module's row.
        let db_proxy = FakeDbProxyClient::failing_on(["register_actions"]).with_module_row(
            serde_json::json!({
                "id": "victim-row",
                "module_id": manifest.name,
                "name": "Victim",
                "module_key": "victim:1.0.0:0000000",
                "version": "1.0.0",
                "created_by_type": "CLIENT",
            }),
        );
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-evil.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("install should fail when register_actions fails");

        let calls = db_proxy.calls();
        assert!(
            !calls.iter().any(|c| c == "delete_module"),
            "the rollback must not delete a row it did not create: {calls:?}"
        );
        assert!(
            calls.iter().any(|c| c == "delete_triggers_by_module_id"),
            "the rollback must still remove what this install registered: {calls:?}"
        );
    }

    #[tokio::test]
    async fn failed_upgrade_of_a_legacy_row_restores_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-up");
        let files = fault_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        // A row written before module_id was recorded, found by name only.
        let mut legacy = previous_version_row("fault-mod-up");
        legacy["module_id"] = serde_json::Value::from("");
        let db_proxy = FakeDbProxyClient::failing_on(["register_actions"]).with_module_row(legacy);
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-up.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("install should fail when register_actions fails");

        let calls = db_proxy.calls();
        assert!(
            !calls.iter().any(|c| c == "delete_module"),
            "a failed upgrade of a legacy row must not delete it: {calls:?}"
        );
        assert_eq!(
            db_proxy.created_modules().last(),
            Some(&(PREVIOUS_MODULE_KEY.to_string(), "0.9.0".to_string())),
            "the legacy row must be rewritten back to its version"
        );
    }

    #[tokio::test]
    async fn install_over_a_row_of_unknown_provenance_fails_before_writing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-up");
        let files = fault_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let mut row = previous_version_row("fault-mod-up");
        row["created_by_type"] = serde_json::Value::from("MODULE");
        let db_proxy = FakeDbProxyClient::new()
            .with_installed_version(serde_json::json!({ "module": row }).to_string());
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-up.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("an installed row of unknown provenance cannot be restored");
        assert!(err.to_string().contains("created_by_type"), "got: {err}");
        assert!(db_proxy.created_modules().is_empty());
    }

    #[tokio::test]
    async fn failed_fresh_install_after_create_module_removes_the_new_module() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-2");
        let files = fault_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["register_actions"]);
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-2.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("install should fail when register_actions fails");
        assert!(err.to_string().contains("register_actions"), "got: {err}");

        let calls = db_proxy.calls();
        let rollback_start = calls
            .iter()
            .position(|c| c == "register_actions")
            .expect("register_actions was attempted")
            + 1;
        assert_eq!(
            &calls[rollback_start..],
            &[
                "delete_triggers_by_module_id",
                "delete_actions_by_module_id",
                "delete_widgets_by_module_id",
                "delete_background_tasks_by_module_id",
                "delete_workflows_by_module",
                "list_commands_by_module",
                "get_module_by_name",
                "delete_module",
            ],
            "rollback_db_install's exact compensating sequence must run after a fresh install fails past CreateModule"
        );
    }

    #[tokio::test]
    async fn failed_upgrade_restores_the_previous_version() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-up");
        let files = fault_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["register_actions"])
            .with_installed_version(previous_version_body("fault-mod-up"));
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-up.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("install should fail when register_actions fails");
        assert!(err.to_string().contains("register_actions"), "got: {err}");

        let calls = db_proxy.calls();
        for destructive in [
            "delete_module",
            "delete_triggers_by_module_id",
            "delete_actions_by_module_id",
            "delete_widgets_by_module_id",
            "delete_background_tasks_by_module_id",
            "delete_workflows_by_module",
        ] {
            assert!(
                !calls.iter().any(|c| c == destructive),
                "a failed upgrade must not call {destructive}: {calls:?}"
            );
        }
        assert_eq!(
            db_proxy.created_modules(),
            vec![
                (mid.clone(), "1.0.0".to_string()),
                (PREVIOUS_MODULE_KEY.to_string(), "0.9.0".to_string()),
            ],
            "the module row must be rewritten back to the previous version"
        );
        assert_eq!(
            db_proxy
                .stored_manifest()
                .as_deref()
                .map(|m| m.contains("t_old")),
            Some(true),
            "the restored row must carry the previous manifest"
        );
        // Only what the failed install added goes; t_old, which only the
        // previous version declares, is never pruned by a failed install.
        assert_eq!(
            db_proxy.removed_resources(),
            vec![("trigger".to_string(), "t1".to_string())]
        );
    }

    #[tokio::test]
    async fn successful_upgrade_archives_dropped_resources_after_every_step() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-up");
        let files = fault_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy =
            FakeDbProxyClient::new().with_installed_version(previous_version_body("fault-mod-up"));
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-up.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect("upgrade should succeed");

        assert_eq!(
            db_proxy.removed_resources(),
            vec![("trigger".to_string(), "t_old".to_string())]
        );
        let calls = db_proxy.calls();
        let archived = calls
            .iter()
            .position(|c| c == "archive_resource_by_manifest_id")
            .expect("t_old was archived");
        let last_step = calls
            .iter()
            .rposition(|c| c == "register_actions")
            .expect("register_actions ran");
        assert!(
            archived > last_step,
            "dropped resources must be archived only after the install succeeded: {calls:?}"
        );
    }

    #[tokio::test]
    async fn a_refused_create_module_compensates_nothing() {
        // The db refuses CreateModule when the manifest's name belongs to
        // another module. That module's row is not this install's to
        // remove, so nothing may be deleted by name or by id.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-taken");
        let files = fault_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["create_module"]);
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-taken.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("install should fail when create_module fails");

        let calls = db_proxy.calls();
        assert_eq!(
            calls.last().map(String::as_str),
            Some("create_module"),
            "nothing may run after a refused CreateModule: {calls:?}"
        );
    }

    #[tokio::test]
    async fn an_install_whose_previous_version_cannot_be_read_writes_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest("fault-mod-lookup");
        let files = fault_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["get_module_by_module_id"]);
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-lookup.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("install should fail when the installed version cannot be read");
        assert!(
            err.to_string().contains("look up installed module"),
            "got: {err}"
        );
        assert!(!db_proxy.calls().iter().any(|c| c == "create_module"));
    }

    fn two_command_manifest(id: &str) -> (ModuleManifest, Vec<u8>) {
        let manifest_json = format!(
            r#"{{
                "id": "{id}",
                "name": "Test Mod",
                "version": "1.0.0",
                "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus" }}],
                "functions": [{{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }}],
                "actions": [{{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }}],
                "workflows": [{{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [{{ "action": "a1" }}] }}],
                "commands": [
                    {{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix", "workflow": "w1" }},
                    {{ "id": "c2", "name": "C2", "pattern": "!c2", "type": "prefix", "workflow": "w1" }}
                ]
            }}"#
        )
        .into_bytes();
        let manifest: ModuleManifest = serde_json::from_slice(&manifest_json).expect("manifest");
        (manifest, manifest_json)
    }

    fn workflow_test_files(manifest_json: &[u8]) -> Vec<ModuleFile> {
        vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "functions/f1.lua".into(),
                ModuleFileKind::PROGRAM(ModuleValidProgramKind::Lua),
                b"return 1".to_vec(),
            ),
        ]
    }

    fn existing_command(id: &str, command: &str) -> ModuleCommandRow {
        ModuleCommandRow {
            id: id.to_string(),
            command: command.to_string(),
        }
    }

    #[tokio::test]
    async fn reinstall_keeps_declared_commands_and_prunes_dropped_ones() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = fault_test_manifest_with_workflow("cmd-mod-1");
        let files = workflow_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new().with_commands([
            existing_command("edited-c1", "c1"),
            existing_command("stale", "dropped"),
        ]);
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/cmd-mod-1.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect("reinstall should succeed");

        assert_eq!(
            db_proxy.commands(),
            vec![existing_command("edited-c1", "c1")]
        );
        assert!(
            !db_proxy
                .calls()
                .contains(&"delete_commands_by_module".to_string())
        );
    }

    #[tokio::test]
    async fn failed_upgrade_keeps_commands_an_earlier_install_left() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = two_command_manifest("cmd-mod-2");
        let files = workflow_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        // c2 fails after c1 is registered, so the rollback has a command of
        // its own to remove next to the one it must keep.
        let db_proxy = FakeDbProxyClient::failing_on_command("c2")
            .with_commands([existing_command("edited-c1", "c1")]);
        let _ = run_install(
            &manifest,
            &files,
            &repo,
            "archives/cmd-mod-2.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await;

        assert_eq!(
            db_proxy.commands(),
            vec![existing_command("edited-c1", "c1")]
        );
    }

    #[tokio::test]
    async fn failed_fresh_install_removes_the_commands_it_created() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let (manifest, manifest_json) = two_command_manifest("cmd-mod-3");
        let files = workflow_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on_command("c2");
        let _ = run_install(
            &manifest,
            &files,
            &repo,
            "archives/cmd-mod-3.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await;

        let registrations = db_proxy
            .calls()
            .iter()
            .filter(|c| *c == "register_command")
            .count();
        assert_eq!(
            registrations, 2,
            "c1 must be registered before c2 fails for this test to mean anything"
        );
        assert_eq!(db_proxy.commands(), vec![]);
    }

    #[tokio::test]
    async fn command_actions_are_registered_as_declared() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "cmd-actions",
            "name": "Test Mod",
            "version": "1.0.0",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [{ "action": "a1" }] }],
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix",
                "actions": [{ "id": "queue", "action": "a1", "parameters": { "deviceId": "" } }] }]
        }"#
        .to_vec();
        let manifest: ModuleManifest = serde_json::from_slice(&manifest_json).expect("manifest");
        let files = workflow_test_files(&manifest_json);
        let mid = manifest.compute_module_key(&manifest_json);

        let db_proxy = FakeDbProxyClient::new();
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/cmd-actions.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect("install should succeed");

        let registered = db_proxy.registered_commands();
        assert_eq!(registered.len(), 1);
        assert_eq!(registered[0].0, "c1");
        let actions: serde_json::Value =
            serde_json::from_str(&registered[0].1).expect("actions_json is JSON");
        // The command runs the action it declared, not the module's workflow
        // that happens to run the same action.
        assert_eq!(
            actions,
            serde_json::json!([{
                "id": "queue",
                "type": "action",
                "action": "function",
                "function": "cmd-actions:function:f1",
                "parameters": { "deviceId": "" },
                "$ref": "cmd-actions:action:a1",
            }])
        );
    }

    #[tokio::test]
    async fn install_failure_before_create_module_does_not_roll_back() {
        // A failure resolving a cross-module reference aborts inside
        // `build_install_plan`, before any db-proxy write — there is
        // nothing to compensate for, so `delete_module` etc. must never
        // be called.
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");

        let manifest_json = br#"{
            "id": "fault-mod-3",
            "name": "Test Mod",
            "version": "1.0.0",
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "other_mod:trigger:missing", "steps": [] }]
        }"#;
        let files = vec![ModuleFile::new(
            "module.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
            manifest_json.to_vec(),
        )];
        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);

        let db_proxy = FakeDbProxyClient::failing_on(["get_trigger_event_by_canonical_id"]);
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/fault-mod-3.zip",
            Some(&db_proxy as &dyn ModuleDbProxy),
            &mid,
            "",
        )
        .await
        .expect_err("unresolvable cross-module trigger must fail install");
        assert!(err.to_string().contains("not installed"), "got: {err}");
        // Only the failing lookup itself ran — no write, and no rollback.
        assert_eq!(
            db_proxy.calls(),
            vec!["get_trigger_event_by_canonical_id".to_string()]
        );
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
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "functions/f1.lua".into(),
                ModuleFileKind::PROGRAM(ModuleValidProgramKind::Lua),
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
            &mid,
            "",
        )
        .await
        .expect("install");

        let stored = repo
            .read_file(&format!(
                "modules/test-mod/{}/functions/f1.lua",
                version_dir_of(&mid)
            ))
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
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
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
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/wm/1.0.0.zip",
            None,
            &mid,
            "",
        )
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
            .read_file(&format!(
                "modules/wm/{version_dir}/widgets/w1/static/theme.css"
            ))
            .await
            .expect("css");
        assert_eq!(css, b"body{}");
    }

    fn neon_pack_files(manifest_json: &[u8], with_css: bool) -> Vec<ModuleFile> {
        let mut files = vec![
            ModuleFile::new(
                "module.json".into(),
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
                manifest_json.to_vec(),
            ),
            ModuleFile::new(
                "assets/grid.webm".into(),
                ModuleFileKind::ASSET("webm".into()),
                b"webm".to_vec(),
            ),
        ];
        if with_css {
            files.push(ModuleFile::new(
                "themes/neon.css".into(),
                ModuleFileKind::ASSET("css".into()),
                b"#text{letter-spacing:2px}".to_vec(),
            ));
        }
        files
    }

    const NEON_PACK: &[u8] = br#"{
        "id": "neonpack",
        "name": "Neon",
        "version": "1.0.0",
        "requires": { "timerpro": "^1.2.0" },
        "themes": [{
            "id": "neon",
            "name": "Neon",
            "target": "timerpro:widget:countdown",
            "contractVersion": 1,
            "assets": { "background": "assets/grid.webm" },
            "stylesheet": "themes/neon.css"
        }]
    }"#;

    #[tokio::test]
    async fn install_stores_theme_files_under_the_theme_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");
        let manifest: ModuleManifest = serde_json::from_slice(NEON_PACK).expect("manifest");
        let mid = manifest.compute_module_key(NEON_PACK);

        run_install(
            &manifest,
            &neon_pack_files(NEON_PACK, true),
            &repo,
            "archives/neonpack/1.0.0.zip",
            None,
            &mid,
            "",
        )
        .await
        .expect("install");

        let version_dir = version_dir_of(&mid);
        let css = repo
            .read_file(&format!(
                "modules/neonpack/{version_dir}/themes/neon/themes/neon.css"
            ))
            .await
            .expect("stylesheet stored");
        assert_eq!(css, b"#text{letter-spacing:2px}");
        repo.read_file(&format!(
            "modules/neonpack/{version_dir}/themes/neon/assets/grid.webm"
        ))
        .await
        .expect("slot asset stored");
    }

    #[tokio::test]
    async fn install_fails_when_a_theme_file_is_missing_from_the_zip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");
        let manifest: ModuleManifest = serde_json::from_slice(NEON_PACK).expect("manifest");
        let mid = manifest.compute_module_key(NEON_PACK);

        let err = run_install(
            &manifest,
            &neon_pack_files(NEON_PACK, false),
            &repo,
            "archives/neonpack/1.0.0.zip",
            None,
            &mid,
            "",
        )
        .await
        .expect_err("a missing stylesheet fails the install")
        .to_string();
        assert!(
            err.contains("theme neon: file 'themes/neon.css' not found"),
            "{err}"
        );
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
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
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
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/am/1.0.0.zip",
            None,
            &mid,
            "",
        )
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
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
            manifest_json.to_vec(),
        )];

        let manifest: ModuleManifest = serde_json::from_slice(manifest_json).expect("manifest");
        let mid = manifest.compute_module_key(manifest_json);
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/wm2/1.0.0.zip",
            None,
            &mid,
            "",
        )
        .await
        .expect_err("entry outside assets must fail validation");
        assert!(
            err.to_string()
                .contains("must live inside the `assets` directory"),
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
                ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
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
        let err = run_install(
            &manifest,
            &files,
            &repo,
            "archives/wm3/1.0.0.zip",
            None,
            &mid,
            "",
        )
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
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
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

#[cfg(test)]
mod link_resource_settings_tests {
    use super::super::db_proxy::ModuleRecord;
    use super::super::db_proxy_client::FakeDbProxyClient;
    use super::*;
    use crate::module_file::{ModuleFileKind, ModuleValidManifestKind};
    use lib_repository::{FileRepository, FileRepositoryConfig};

    const LINKED: &str = "woofx3:timer:hype_board_subathon";

    fn linking_manifest() -> (ModuleManifest, Vec<u8>) {
        let json = serde_json::json!({
            "id": "hype_board",
            "name": "Hype Board",
            "version": "1.0.0",
            "settings": [{
                "id": "timer",
                "label": "Subathon timer",
                "type": "resource_ref",
                "resourceKind": "timer",
                "create": {
                    "instanceId": "hype_board_subathon",
                    "displayName": "Hype Board subathon",
                    "settings": { "duration": 3600 }
                }
            }]
        })
        .to_string()
        .into_bytes();
        let manifest: ModuleManifest = serde_json::from_slice(&json).expect("manifest");
        (manifest, json)
    }

    fn provider(module_id: &str) -> ModuleRecord {
        let manifest = serde_json::json!({
            "id": module_id, "name": module_id, "version": "1.0.0",
            "resources": [{ "kind": "timer", "name": "Timer" }],
        });
        serde_json::from_value(serde_json::json!({
            "id": format!("row-{module_id}"),
            "module_id": module_id,
            "module_key": format!("{module_id}:1.0.0:abc1234"),
            "name": module_id,
            "version": "1.0.0",
            "state": "active",
            "manifest": manifest.to_string(),
        }))
        .expect("module record")
    }

    async fn install(db_proxy: &FakeDbProxyClient) -> Result<InstallOutcome> {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");
        let (manifest, json) = linking_manifest();
        let files = vec![ModuleFile::new(
            "module.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
            json.clone(),
        )];
        let key = manifest.compute_module_key(&json);
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/hype_board.zip",
            Some(db_proxy as &dyn ModuleDbProxy),
            &key,
            "",
        )
        .await
    }

    #[tokio::test]
    async fn install_creates_the_instance_under_the_kinds_module_and_links_it() {
        let db = FakeDbProxyClient::new().with_installed([provider("woofx3")]);
        install(&db).await.expect("install");

        let instances = db.instances();
        assert_eq!(instances.len(), 1);
        assert_eq!(instances[0].canonical_id, LINKED);
        assert_eq!(instances[0].display_name, "Hype Board subathon");
        assert_eq!(instances[0].settings_json, r#"{"duration":3600}"#);
        assert_eq!(db.settings().get("timer").map(String::as_str), Some(LINKED));
    }

    #[tokio::test]
    async fn the_stored_manifest_names_the_kind_with_its_module() {
        let db = FakeDbProxyClient::new().with_installed([provider("woofx3")]);
        install(&db).await.expect("install");

        let stored: serde_json::Value =
            serde_json::from_str(&db.stored_manifest().expect("module created")).expect("json");
        assert_eq!(stored["settings"][0]["resourceKind"], "woofx3:timer");
    }

    #[tokio::test]
    async fn an_instance_that_already_exists_is_linked_not_created_again() {
        let db = FakeDbProxyClient::new()
            .with_installed([provider("woofx3")])
            .with_instance(LINKED);
        install(&db).await.expect("install");

        assert_eq!(db.instances().len(), 1);
        assert!(!db.calls().contains(&"create_resource_instance".to_string()));
        assert_eq!(db.settings().get("timer").map(String::as_str), Some(LINKED));
    }

    #[tokio::test]
    async fn a_setting_the_streamer_already_chose_is_left_alone() {
        let db = FakeDbProxyClient::new()
            .with_installed([provider("woofx3")])
            .with_setting("timer", "woofx3:timer:my_own");
        install(&db).await.expect("install");

        assert!(db.instances().is_empty());
        assert_eq!(
            db.settings().get("timer").map(String::as_str),
            Some("woofx3:timer:my_own")
        );
    }

    #[tokio::test]
    async fn install_fails_when_no_installed_module_provides_the_kind() {
        let db = FakeDbProxyClient::new();
        let err = install(&db).await.expect_err("nothing provides timers");
        assert!(
            err.to_string()
                .contains("no installed module provides `timer`"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn install_fails_when_several_modules_provide_the_kind() {
        let db =
            FakeDbProxyClient::new().with_installed([provider("woofx3"), provider("timerpro")]);
        let err = install(&db).await.expect_err("ambiguous owner");
        assert!(err.to_string().contains("timerpro, woofx3"), "{err}");
    }
}

#[cfg(test)]
mod endpoint_settings_tests {
    use super::super::db_proxy_client::FakeDbProxyClient;
    use super::*;
    use crate::module_file::{ModuleFileKind, ModuleValidManifestKind};
    use lib_repository::{FileRepository, FileRepositoryConfig};

    /// An `obs` manifest at `version` whose endpoint `endpoint_id` reads its
    /// address from `host_setting` and `obs_port`.
    fn obs_manifest(version: &str, endpoint_id: &str, host_setting: &str) -> serde_json::Value {
        serde_json::json!({
            "id": "obs",
            "name": "OBS",
            "version": version,
            "settings": [
                { "id": "obs_host", "label": "Host", "type": "text", "defaultValue": "localhost" },
                { "id": "obs_address", "label": "Address", "type": "text" },
                { "id": "obs_port", "label": "Port", "type": "number", "defaultValue": "4455" }
            ],
            "local": [{
                "id": endpoint_id,
                "name": "OBS",
                "protocol": "websocket",
                "hostSetting": host_setting,
                "portSetting": "obs_port"
            }]
        })
    }

    fn parsed(manifest: serde_json::Value) -> ModuleManifest {
        serde_json::from_value(manifest).expect("manifest")
    }

    /// `obs_manifest` with its endpoint's port read from `obs_alt_port`.
    fn obs_manifest_with_alt_port(version: &str) -> serde_json::Value {
        let mut manifest = obs_manifest(version, "obs", "obs_host");
        manifest["settings"]
            .as_array_mut()
            .expect("settings")
            .push(serde_json::json!({
                "id": "obs_alt_port", "label": "Alt port", "type": "number", "defaultValue": "4456"
            }));
        manifest["local"][0]["portSetting"] = serde_json::json!("obs_alt_port");
        manifest
    }

    /// `obs_manifest` without its `local[]` endpoint.
    fn obs_manifest_without_endpoints(version: &str) -> serde_json::Value {
        let mut manifest = obs_manifest(version, "obs", "obs_host");
        manifest["local"] = serde_json::json!([]);
        manifest
    }

    #[test]
    fn test_relocated_endpoint_address_settings_cases() {
        let installed = parsed(obs_manifest("1.0.0", "obs", "obs_host"));
        let installed_without_endpoints = parsed(obs_manifest_without_endpoints("1.0.0"));
        let cases: [(&str, Option<&ModuleManifest>, ModuleManifest, Vec<&str>); 6] = [
            (
                "fresh install",
                None,
                parsed(obs_manifest("1.0.0", "obs", "obs_host")),
                vec!["obs_host", "obs_port"],
            ),
            (
                "unchanged keys",
                Some(&installed),
                parsed(obs_manifest("1.1.0", "obs", "obs_host")),
                vec![],
            ),
            (
                "renamed host setting",
                Some(&installed),
                parsed(obs_manifest("1.1.0", "obs", "obs_address")),
                vec!["obs_address"],
            ),
            (
                "new endpoint id",
                Some(&installed),
                parsed(obs_manifest("1.1.0", "studio", "obs_host")),
                vec!["obs_host", "obs_port"],
            ),
            (
                "renamed port setting",
                Some(&installed),
                parsed(obs_manifest_with_alt_port("1.1.0")),
                vec!["obs_alt_port"],
            ),
            (
                "endpoint added by the upgrade",
                Some(&installed_without_endpoints),
                parsed(obs_manifest("1.1.0", "obs", "obs_host")),
                vec!["obs_host", "obs_port"],
            ),
        ];
        for (name, previous, new, expected) in cases {
            assert_eq!(
                relocated_endpoint_address_settings(previous, &new),
                expected,
                "{name}"
            );
        }
    }

    fn installed_version_body(manifest: &serde_json::Value) -> String {
        serde_json::json!({ "module": {
            "id": "row-1",
            "name": "OBS",
            "module_id": "obs",
            "module_key": "obs:1.0.0:0000000",
            "version": "1.0.0",
            "manifest": manifest.to_string(),
            "archive_key": "archives/obs-1.0.0.zip",
            "state": "active",
            "created_by_type": "CLIENT",
            "created_by_ref": "client-1",
        }})
        .to_string()
    }

    async fn install(
        db_proxy: &FakeDbProxyClient,
        manifest: serde_json::Value,
    ) -> Result<InstallOutcome> {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = FileRepository::new(FileRepositoryConfig {
            destination: dir.path().to_path_buf(),
        });
        repo.setup().expect("setup");
        let json = manifest.to_string().into_bytes();
        let manifest = parsed(manifest);
        let files = vec![ModuleFile::new(
            "manifest.json".into(),
            ModuleFileKind::MANIFEST(ModuleValidManifestKind::Json),
            json.clone(),
        )];
        let key = manifest.compute_module_key(&json);
        run_install(
            &manifest,
            &files,
            &repo,
            "archives/obs.zip",
            Some(db_proxy as &dyn ModuleDbProxy),
            &key,
            "",
        )
        .await
    }

    #[tokio::test]
    async fn test_upgrade_clears_a_planted_value_under_a_renamed_host_setting() {
        let db = FakeDbProxyClient::new()
            .with_installed_version(installed_version_body(&obs_manifest(
                "1.0.0", "obs", "obs_host",
            )))
            .with_setting("obs_address", "10.0.0.66")
            .with_setting("obs_port", "4455");
        let outcome = install(&db, obs_manifest("1.1.0", "obs", "obs_address"))
            .await
            .expect("upgrade");

        // Named so the caller resets it again once the registry refuses
        // writes to it.
        assert_eq!(outcome.relocated_endpoint_settings, vec!["obs_address"]);
        let settings = db.settings();
        assert_eq!(settings.get("obs_address").map(String::as_str), Some(""));
        assert_eq!(settings.get("obs_port").map(String::as_str), Some("4455"));
    }

    #[tokio::test]
    async fn test_upgrade_keeps_the_value_of_an_unchanged_host_setting() {
        let db = FakeDbProxyClient::new()
            .with_installed_version(installed_version_body(&obs_manifest(
                "1.0.0", "obs", "obs_host",
            )))
            .with_setting("obs_host", "192.168.1.20")
            .with_setting("obs_port", "4456");
        install(&db, obs_manifest("1.1.0", "obs", "obs_host"))
            .await
            .expect("upgrade");

        let settings = db.settings();
        assert_eq!(
            settings.get("obs_host").map(String::as_str),
            Some("192.168.1.20")
        );
        assert_eq!(settings.get("obs_port").map(String::as_str), Some("4456"));
        assert!(!db.calls().contains(&"set_module_setting".to_string()));
    }

    #[tokio::test]
    async fn test_fresh_install_resets_a_new_endpoint_key_to_its_default() {
        let db = FakeDbProxyClient::new()
            .with_setting("obs_host", "10.0.0.66")
            .with_setting("obs_port", "1");
        install(&db, obs_manifest("1.0.0", "obs", "obs_host"))
            .await
            .expect("install");

        let settings = db.settings();
        assert_eq!(
            settings.get("obs_host").map(String::as_str),
            Some("localhost")
        );
        assert_eq!(settings.get("obs_port").map(String::as_str), Some("4455"));
    }

    #[tokio::test]
    async fn test_reset_after_the_install_clears_a_value_planted_before_the_registry_refresh() {
        let db = FakeDbProxyClient::new().with_installed_version(installed_version_body(
            &obs_manifest("1.0.0", "obs", "obs_host"),
        ));
        let upgraded = obs_manifest("1.1.0", "obs", "obs_address");
        let outcome = install(&db, upgraded.clone()).await.expect("upgrade");
        // Code of 1.0.0, where `obs_address` is an ordinary setting, writes it
        // before the sandbox registry holds 1.1.0.
        db.set_module_setting("obs", "obs_address", "10.0.0.66")
            .await
            .expect("planted write");

        reset_endpoint_settings(&db, &parsed(upgraded), &outcome.relocated_endpoint_settings)
            .await
            .expect("reset after refresh");

        assert_eq!(
            db.settings().get("obs_address").map(String::as_str),
            Some("")
        );
    }

    #[tokio::test]
    async fn test_reset_endpoint_settings_succeeds_for_an_absent_key() {
        let db = FakeDbProxyClient::new();
        reset_endpoint_settings(
            &db,
            &parsed(obs_manifest("1.0.0", "obs", "obs_host")),
            &["obs_host".to_string(), "obs_port".to_string()],
        )
        .await
        .expect("an absent key is already clear");

        assert!(db.settings().is_empty());
        assert!(!db.calls().contains(&"set_module_setting".to_string()));
    }
}
