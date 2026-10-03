//! Two-pass manifest validation.
//!
//! Pass 1 builds per-kind symbol tables of canonical ids, enforcing the
//! hard rules of the contract documented in `docs/barkloader/modules.md`:
//!
//!   - top-level `id` is required, non-empty, and a valid id segment
//!   - every resource (`triggers`, `actions`, `functions`, `commands`,
//!     `workflows`, `widgets`) has a non-empty `id` matching
//!     `[A-Za-z0-9._-]+`
//!   - within each kind, canonical ids are unique
//!
//! Pass 2 resolves intra-manifest references — the `function` field of
//! `function`-typed actions, `workflows[].trigger`,
//! `workflows[].steps[].action`, `commands[].workflow`,
//! `commands[].actions[].action` — to canonical
//! ids, either via the local symbol tables or by accepting an
//! already-canonical id verbatim
//! (cross-module references).
//!
//! On success, returns a [`ResolvedManifest`] that the install path can
//! iterate alongside the original manifest. Any failure aborts install
//! before any database or file-system side effect runs.

use anyhow::{Result, anyhow};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

use super::canonical_id::{
    CANONICAL_ID_SEPARATOR, CanonicalId, ResourceKind, looks_like_canonical_id, validate_segment,
};
use super::db_proxy_client::ModuleDbProxy;
use super::module_manifest::{
    COMPARISON_OPERATORS, CONFIG_FIELD_TYPES, DATA_SHAPE_FIELD_TYPES, DEADLINES_MAX_PENDING_CAP,
    LIST_ITEM_FIELD_TYPES, ManifestAction, ManifestActionImpl, ManifestAsset, ManifestCommand,
    ManifestConfigField, ManifestDataShape, ManifestFunction, ManifestResourceKind,
    ManifestSetting, ManifestTheme, ManifestTrigger, ManifestWorkflow, ModuleManifest,
    ModuleWidget, SECRET_SETTING_TYPE, THEME_FIELD_TYPE, URL_SETTING_TYPE, WEBHOOK_EVENT_PREFIX,
    WEBHOOK_TRIGGER_TYPE, WIDGET_SURFACES,
};
use super::theme::{self, InstalledModule};

/// Resolved action implementation. Mirrors `ManifestActionImpl` but
/// carries fully-resolved canonical ids ready for persistence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedActionImpl {
    /// `type: "function"` — function reference resolved to a canonical id.
    Function { canonical_function_id: CanonicalId },
    /// `type: "native"` — an engine handler name. Nothing to resolve: the
    /// handler lives in the workflow engine, not in this manifest.
    Native { handler: String },
}

#[derive(Debug, Clone)]
pub struct ResolvedTrigger {
    pub canonical_id: CanonicalId,
}

#[derive(Debug, Clone)]
pub struct ResolvedAction {
    pub canonical_id: CanonicalId,
    pub implementation: ResolvedActionImpl,
}

#[derive(Debug, Clone)]
pub struct ResolvedFunction {
    pub canonical_id: CanonicalId,
}

#[derive(Debug, Clone)]
pub struct ResolvedCommand {
    pub canonical_id: CanonicalId,
    pub workflow: Option<CanonicalId>,
    /// The action each of the command's `actions` names, index for index.
    pub step_actions: Vec<CanonicalId>,
}

/// What a workflow binds to, and therefore whether it creates a dependency.
///
/// The distinction is the whole reason both forms exist: naming a declaration
/// is a promise that it stays installed, and naming an event is not.
#[derive(Debug, Clone)]
pub enum WorkflowTriggerRef {
    /// A declared trigger, by canonical id. A hard dependency: the owning
    /// module must already be installed, and uninstalling it is refused
    /// while this workflow exists.
    Resource(CanonicalId),
    /// A bare event type (`channel.follow`). No dependency: whichever module
    /// emits it, at whatever version, satisfies this. The emitting module can
    /// be installed, removed and reinstalled without touching the workflow.
    Event(String),
}

impl WorkflowTriggerRef {
    /// The canonical id this binds to, or `None` for an event binding.
    /// `None` is what keeps a soft binding out of the dependency graph.
    pub fn as_resource(&self) -> Option<&CanonicalId> {
        match self {
            Self::Resource(id) => Some(id),
            Self::Event(_) => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedWorkflow {
    pub canonical_id: CanonicalId,
    pub trigger: WorkflowTriggerRef,
    pub step_actions: Vec<CanonicalId>,
}

#[derive(Debug, Clone)]
pub struct ResolvedWidget {
    pub canonical_id: CanonicalId,
}

#[derive(Debug, Clone)]
pub struct ResolvedAsset {
    pub canonical_id: CanonicalId,
}

#[derive(Debug, Clone)]
pub struct ResolvedModuleTheme {
    pub canonical_id: CanonicalId,
}

#[derive(Debug, Clone)]
pub struct ResolvedManifest {
    pub module_id: String,
    pub provenance: InstallProvenance,
    pub triggers: Vec<ResolvedTrigger>,
    pub actions: Vec<ResolvedAction>,
    pub functions: Vec<ResolvedFunction>,
    pub commands: Vec<ResolvedCommand>,
    pub workflows: Vec<ResolvedWorkflow>,
    pub widgets: Vec<ResolvedWidget>,
    pub assets: Vec<ResolvedAsset>,
    pub themes: Vec<ResolvedModuleTheme>,
}

/// The module id every bundled ("built-in") declaration lives under.
///
/// One id, one exact string. Bundled declarations are added by editing this
/// module's manifest, not by minting new ids, so there is no reservation list
/// to keep in step with them.
pub const SYSTEM_MODULE_ID: &str = "woofx3";

/// Who is installing.
///
/// Every install path that exists today is a user upload. The bundled-module
/// reconciler introduced later boots its embedded archives as `System`; this
/// exists now so the reservation below is enforceable the moment it does,
/// rather than being a comment claiming an enforcement that is not there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallProvenance {
    User,
    System,
}

/// Canonical ids of the actions only a system module may put in a workflow or
/// command: declared `systemOnly` by a bundled module.
///
/// Built from the bundled manifests rather than read back from the db, because
/// only a system module may declare the flag (see `validate_with_provenance`),
/// and every system module is embedded in the running binary.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SystemOnlyActions(HashSet<String>);

impl SystemOnlyActions {
    pub fn from_manifests<'a>(
        manifests: impl IntoIterator<Item = &'a ModuleManifest>,
    ) -> Result<Self> {
        let mut ids = HashSet::new();
        for manifest in manifests {
            let module_id = require_module_id(manifest)?;
            for action in manifest.actions.iter().filter(|a| a.system_only) {
                ids.insert(
                    CanonicalId::new(&module_id, ResourceKind::Action, &action.id)?.to_string(),
                );
            }
        }
        Ok(Self(ids))
    }

    pub fn contains(&self, canonical_id: &CanonicalId) -> bool {
        self.0.contains(&canonical_id.to_string())
    }
}

/// Refuse a module that is not a system module when one of its workflow steps
/// or command actions names a `systemOnly` action.
///
/// Such an action does something the engine withholds from module code -- a
/// timeout, a stream title change -- and a workflow a module ships runs with
/// the module's say-so rather than the streamer's. See
/// docs/services/engine-integrity.md.
pub fn refuse_system_only_references(
    resolved: &ResolvedManifest,
    provenance: InstallProvenance,
    system_only: &SystemOnlyActions,
) -> Result<()> {
    if provenance == InstallProvenance::System {
        return Ok(());
    }
    let workflow_refs = resolved.workflows.iter().flat_map(|wf| {
        wf.step_actions.iter().enumerate().map(move |(si, action)| {
            (
                format!("workflow '{}' step #{si}", wf.canonical_id.resource_id()),
                action,
            )
        })
    });
    let command_refs = resolved.commands.iter().flat_map(|cmd| {
        cmd.step_actions
            .iter()
            .enumerate()
            .map(move |(si, action)| {
                (
                    format!("command '{}' action #{si}", cmd.canonical_id.resource_id()),
                    action,
                )
            })
    });
    for (label, action) in workflow_refs.chain(command_refs) {
        if system_only.contains(action) {
            return Err(anyhow!(
                "{label}: action '{action}' is reserved for system modules; an uploaded module cannot use it"
            ));
        }
    }
    Ok(())
}

/// Validate a user-uploaded manifest and resolve all intra-manifest references.
///
/// The provenance-free entry point, because every caller today is a user
/// upload. `validate_with_provenance` is the one to reach for from a system
/// installer.
pub fn validate(manifest: &ModuleManifest) -> Result<ResolvedManifest> {
    validate_with_provenance(manifest, InstallProvenance::User)
}

/// Validate the manifest and resolve all intra-manifest references, enforcing
/// the rules that depend on who is installing.
pub fn validate_with_provenance(
    manifest: &ModuleManifest,
    provenance: InstallProvenance,
) -> Result<ResolvedManifest> {
    let module_id = require_module_id(manifest)?;

    // Exact match, deliberately: `woofx3party` is an ordinary id and installs
    // normally. A prefix or substring test would quietly deny ids nobody
    // reserved.
    if module_id == SYSTEM_MODULE_ID && provenance != InstallProvenance::System {
        return Err(anyhow!(
            "module id {SYSTEM_MODULE_ID:?} is reserved for bundled system modules and cannot be installed from an upload"
        ));
    }

    // A `native` action names a handler compiled into the engine. Letting an
    // upload do that would turn a manifest into a way to bind workflow steps
    // to arbitrary engine internals, so it is system-provenance only.
    if provenance != InstallProvenance::System {
        for (i, action) in manifest.actions.iter().enumerate() {
            if let ManifestActionImpl::Native { .. } = action.implementation {
                return Err(anyhow!(
                    "action #{i} ({}): `native` actions name an engine handler and may only be declared by a bundled system module",
                    action.id
                ));
            }
            if action.system_only {
                return Err(anyhow!(
                    "action #{i} ({}): `systemOnly` may only be declared by a bundled system module",
                    action.id
                ));
            }
        }
    }

    // A background task whose schedule cannot be parsed registers fine and
    // then never fires -- the scheduler declines it with a log line the author
    // has no reason to read. The expression is known here, so reject it here.
    for (i, task) in manifest.background_tasks.iter().enumerate() {
        if !crate::cron_schedule::is_valid_cron(&task.schedule) {
            return Err(anyhow!(
                "backgroundTasks[{i}] ({}): {:?} is not a valid cron schedule. \
                 Five-field (`*/30 * * * *`) and six-field (`0 */30 * * * *`) forms are both accepted.",
                task.id,
                task.schedule
            ));
        }
    }

    validate_deadlines(manifest)?;
    validate_permissions(manifest)?;
    validate_oauth(manifest)?;

    // Step ids are the names an author's own `${id.field}` references and
    // `dependsOn` entries resolve against. A duplicate makes a reference
    // ambiguous and a dangling `dependsOn` makes the graph unsatisfiable --
    // both of which otherwise surface as a step that quietly does nothing.
    for (wi, workflow) in manifest.workflows.iter().enumerate() {
        let mut declared: HashSet<&str> = HashSet::new();
        for (si, step) in workflow.steps.iter().enumerate() {
            let Some(id) = step.id.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
                continue;
            };
            if !declared.insert(id) {
                return Err(anyhow!(
                    "workflow #{wi} ({}) step #{si}: duplicate step id {id:?}",
                    workflow.id
                ));
            }
        }
        for (si, step) in workflow.steps.iter().enumerate() {
            for dep in &step.depends_on {
                let dep = dep.trim();
                if !declared.contains(dep) {
                    return Err(anyhow!(
                        "workflow #{wi} ({}) step #{si}: dependsOn {dep:?} names no step in this workflow. \
                         Only steps with an explicit `id` can be depended on.",
                        workflow.id
                    ));
                }
            }
        }
    }

    // Pass 1: build per-kind canonical id lookup tables.
    let triggers_table = build_kind_table(
        &module_id,
        ResourceKind::Trigger,
        &manifest.triggers,
        |t: &ManifestTrigger| &t.id,
    )?;
    let actions_table = build_kind_table(
        &module_id,
        ResourceKind::Action,
        &manifest.actions,
        |a: &ManifestAction| &a.id,
    )?;
    let functions_table = build_kind_table(
        &module_id,
        ResourceKind::Function,
        &manifest.functions,
        |f: &ManifestFunction| &f.id,
    )?;
    let commands_table = build_kind_table(
        &module_id,
        ResourceKind::Command,
        &manifest.commands,
        |c: &ManifestCommand| &c.id,
    )?;
    let workflows_table = build_kind_table(
        &module_id,
        ResourceKind::Workflow,
        &manifest.workflows,
        |w: &ManifestWorkflow| &w.id,
    )?;
    let widgets_table = build_kind_table(
        &module_id,
        ResourceKind::Widget,
        &manifest.widgets,
        |w: &ModuleWidget| &w.id,
    )?;
    let assets_table = build_kind_table(
        &module_id,
        ResourceKind::Asset,
        &manifest.assets,
        |a: &ManifestAsset| &a.id,
    )?;
    let themes_table = build_kind_table(
        &module_id,
        ResourceKind::Theme,
        &manifest.themes,
        |t: &ManifestTheme| &t.id,
    )?;
    validate_no_overlays(manifest)?;
    validate_no_accepted_events(&manifest.widgets)?;
    validate_asset_paths(&manifest.assets)?;
    validate_widget_entries(&manifest.widgets)?;
    validate_widget_surfaces(&manifest.widgets, provenance)?;
    validate_resource_kinds(&manifest.resources)?;
    validate_data_shapes(&manifest.triggers, &manifest.actions)?;
    validate_field_lists(manifest)?;
    validate_trigger_sentences(&manifest.triggers)?;
    validate_themes(manifest, &module_id)?;

    // Pass 2: resolve references for kinds that have them.
    let triggers = entries_to_resolved(&triggers_table, |e| ResolvedTrigger {
        canonical_id: e.canonical_id.clone(),
    });
    let functions = entries_to_resolved(&functions_table, |e| ResolvedFunction {
        canonical_id: e.canonical_id.clone(),
    });
    let assets = entries_to_resolved(&assets_table, |e| ResolvedAsset {
        canonical_id: e.canonical_id.clone(),
    });
    let themes = entries_to_resolved(&themes_table, |e| ResolvedModuleTheme {
        canonical_id: e.canonical_id.clone(),
    });
    let actions = resolve_actions(&manifest.actions, &actions_table, &functions_table)?;
    let commands = resolve_commands(
        &manifest.commands,
        &commands_table,
        &workflows_table,
        &actions_table,
    )?;
    let workflows = resolve_workflows(
        &manifest.workflows,
        &workflows_table,
        &triggers_table,
        &actions_table,
    )?;
    let widgets = resolve_widgets(&manifest.widgets, &widgets_table)?;
    validate_trigger_transports(manifest, provenance)?;
    validate_internal_requests(manifest, &module_id, provenance)?;
    validate_no_ingress_bindings(manifest, &module_id, &workflows)?;

    Ok(ResolvedManifest {
        module_id,
        provenance,
        triggers,
        actions,
        functions,
        commands,
        workflows,
        widgets,
        assets,
        themes,
    })
}

/// Validate every theme contract, theme and `requires` entry that can be
/// checked from this manifest alone. A theme for one of this module's own
/// widgets is checked against that widget's contract here; one for another
/// module's widget waits for `validate_theme_dependencies`, and must name
/// that module in `requires`, since the theme is useless without it.
fn validate_themes(manifest: &ModuleManifest, module_id: &str) -> Result<()> {
    for (i, w) in manifest.widgets.iter().enumerate() {
        theme::validate_contract(w, &format!("widget #{i} ({})", w.id))?;
    }
    theme::validate_requires_shape(&manifest.requires, module_id)?;
    for (i, t) in manifest.themes.iter().enumerate() {
        let label = format!("theme #{i} ({})", t.id);
        theme::validate_theme_shape(t, &label)?;
        let (target_module, widget_id) = theme::parse_widget_target(&t.target)?;
        if target_module != module_id {
            if !manifest.requires.contains_key(target_module) {
                return Err(anyhow!(
                    "{label}: `target` {:?} belongs to module {target_module:?}, which `requires` must name with a version range",
                    t.target
                ));
            }
            continue;
        }
        let Some(widget) = theme::find_target_widget(manifest, widget_id) else {
            return Err(anyhow!(
                "{label}: `target` {:?} names no widget this module declares",
                t.target
            ));
        };
        let Some(contract) = &widget.theme else {
            return Err(anyhow!(
                "{label}: widget {:?} declares no `theme` contract, so it cannot be themed",
                t.target
            ));
        };
        theme::check_against_contract(t, contract).map_err(|e| anyhow!("{label}: {e}"))?;
    }
    Ok(())
}

/// Check `requires` and every theme for another module's widget against the
/// installed modules. Skipped entirely for a manifest with neither, so an
/// ordinary module's install makes no extra db-proxy call.
async fn validate_theme_dependencies(
    manifest: &ModuleManifest,
    db_proxy: &dyn ModuleDbProxy,
) -> Result<()> {
    if manifest.requires.is_empty() && manifest.themes.is_empty() {
        return Ok(());
    }
    let own_id = manifest.id.trim();
    let installed: Vec<InstalledModule> = db_proxy
        .list_modules()
        .await?
        .into_iter()
        .filter_map(InstalledModule::from_record)
        .filter(|m| m.module_id != own_id)
        .collect();
    let versions: HashMap<String, String> = installed
        .iter()
        .map(|m| (m.module_id.clone(), m.version.clone()))
        .collect();
    theme::check_requires(&manifest.requires, &versions)?;

    for (i, t) in manifest.themes.iter().enumerate() {
        let label = format!("theme #{i} ({})", t.id);
        let (target_module, widget_id) = theme::parse_widget_target(&t.target)?;
        if target_module == own_id {
            continue;
        }
        let widget = installed
            .iter()
            .find(|m| m.module_id == target_module)
            .and_then(|m| theme::find_target_widget(&m.manifest, widget_id))
            .ok_or_else(|| anyhow!("{label}: `target` {:?} names no installed widget", t.target))?;
        let Some(contract) = &widget.theme else {
            return Err(anyhow!(
                "{label}: widget {:?} declares no `theme` contract, so it cannot be themed",
                t.target
            ));
        };
        theme::check_against_contract(t, contract).map_err(|e| anyhow!("{label}: {e}"))?;
    }
    Ok(())
}

/// Event prefixes no bus-fired trigger may claim: the webhook placeholder,
/// and for uploads, every subject the engine or a service treats as a command.
///
/// A webhook handler may publish any event type its module declares as an
/// eventbus trigger, verbatim, so declaring one of these would let an upload
/// drive the engine directly: forge outbox events (`db.`), change OBS
/// (`engine.obs.command`, `slobs`), call the Twitch API (`twitchapi`), speak in
/// chat (`message.send`), play or skip alerts (`ui.notify.`, `ui.alert.`,
/// `widget.queue.`), or run, replay or stop workflows and actions
/// (`workflow.execute`, `workflow.replay`, `workflow.cancel`, `action.execute`).
/// Must match the command prefixes in api/src/workflow/reserved-subjects.ts.
/// See docs/services/engine-integrity.md.
///
/// The outbox stays open to the system module, which owns the `db.workflow.*`
/// triggers and declares no handlers.
const USER_RESERVED_EVENT_PREFIXES: [&str; 13] = [
    WEBHOOK_EVENT_PREFIX,
    "db.",
    "engine.",
    "slobs",
    "twitchapi",
    "message.send",
    "ui.notify.",
    "ui.alert.",
    "widget.queue.",
    "workflow.execute",
    "workflow.replay",
    "workflow.cancel",
    "action.execute",
];

fn reserved_event_prefixes(provenance: InstallProvenance) -> &'static [&'static str] {
    match provenance {
        InstallProvenance::User => &USER_RESERVED_EVENT_PREFIXES,
        InstallProvenance::System => &[WEBHOOK_EVENT_PREFIX],
    }
}

/// The subject barkloader's field-options responder answers. It runs
/// `{payload.moduleId}:function:{payload.functionId}` with that module's
/// permissions, so a form may name only its own module. Must match `SUBJECT`
/// in barkloader/app/src/services/field_options.rs.
const FIELD_OPTIONS_SUBJECT: &str = "barkloader.module.field_options";

/// The Twitch service's request subject. It answers any method of its Twitch
/// client, writes included (a shoutout, adding a moderator), so a form may
/// request only the reads listed in `TWITCHAPI_FORM_READS`.
const TWITCHAPI_SUBJECT: &str = "twitchapi";

/// The `twitchapi` commands an uploaded module's forms may request. Each is a
/// read a picker needs; opening another read to uploads means adding it here.
const TWITCHAPI_FORM_READS: [&str; 1] = ["listChannelPointRewards"];

/// Keep an uploaded module's forms to the requests they need.
///
/// A field's `source` and a button's `action` name a subject and a payload,
/// and the api sends that request verbatim when the form renders or the
/// button is pressed. Without this, a field could switch OBS scenes or add a
/// moderator just by being looked at, or run another module's function with
/// that module's permissions. An upload's forms may therefore request only
/// `FIELD_OPTIONS_SUBJECT` for its own functions and the `twitchapi` reads in
/// `TWITCHAPI_FORM_READS`: an allowlist, because a new command subject should
/// stay closed to forms until someone decides otherwise. The system module's
/// forms are the engine's own and may read its subjects. A module that lists
/// engine-held names, such as OBS's scenes, does it from its own function
/// through a host extension (`ctx.obs.listScenes`), not from a form.
///
/// For every provenance, a request inside a `list` row is refused: the api
/// and the UI resolve sources only on top-level fields, so a nested one would
/// install and then never load.
fn validate_internal_requests(
    manifest: &ModuleManifest,
    module_id: &str,
    provenance: InstallProvenance,
) -> Result<()> {
    let forms = FormRequests {
        manifest,
        module_id,
        provenance,
    };
    for (i, t) in manifest.triggers.iter().enumerate() {
        if let Some(fields) = &t.schema {
            forms.check_fields(fields, &format!("trigger #{i} ({}): `schema`", t.id))?;
        }
    }
    for (i, a) in manifest.actions.iter().enumerate() {
        forms.check_fields(&a.schema, &format!("action #{i} ({}): `schema`", a.id))?;
    }
    for (i, w) in manifest.widgets.iter().enumerate() {
        if let Some(fields) = &w.settings_schema {
            forms.check_fields(fields, &format!("widget #{i} ({}): `settingsSchema`", w.id))?;
        }
    }
    for (i, r) in manifest.resources.iter().enumerate() {
        forms.check_fields(&r.schema, &format!("resource #{i} ({}): `schema`", r.kind))?;
    }
    for (i, setting) in manifest.settings.iter().enumerate() {
        forms.check_request(
            &setting.action,
            &format!("setting #{i} ({}): `action`", setting.id),
        )?;
    }
    Ok(())
}

struct FormRequests<'a> {
    manifest: &'a ModuleManifest,
    module_id: &'a str,
    provenance: InstallProvenance,
}

impl FormRequests<'_> {
    fn check_fields(&self, fields: &[ManifestConfigField], context: &str) -> Result<()> {
        for (i, field) in fields.iter().enumerate() {
            let label = format!("{context} field #{i} ({})", field.id);
            if let Some(source) = &field.source {
                self.check_request(source, &format!("{label}: `source`"))?;
            }
            if let Some(action) = &field.action {
                self.check_request(action, &format!("{label}: `action`"))?;
            }
            if let Some(item_fields) = &field.item_fields {
                reject_nested_requests(item_fields, &format!("{label}: `itemFields`"))?;
            }
        }
        Ok(())
    }

    fn check_request(&self, descriptor: &serde_json::Value, context: &str) -> Result<()> {
        if self.provenance == InstallProvenance::System || !is_internal_request(descriptor) {
            return Ok(());
        }
        let Some(event) = descriptor
            .pointer("/request/event")
            .and_then(serde_json::Value::as_str)
        else {
            return Err(anyhow!(
                "{context}: an `internal` request needs a `request.event` subject"
            ));
        };
        match event {
            FIELD_OPTIONS_SUBJECT => self.check_field_options_request(descriptor, context),
            TWITCHAPI_SUBJECT => check_twitchapi_request(descriptor, context),
            _ => Err(anyhow!(
                "{context}: requests {event:?}; an uploaded module's forms may request only \
                 {FIELD_OPTIONS_SUBJECT} (its own functions) or {TWITCHAPI_SUBJECT} (the reads {TWITCHAPI_FORM_READS:?})"
            )),
        }
    }

    fn check_field_options_request(
        &self,
        descriptor: &serde_json::Value,
        context: &str,
    ) -> Result<()> {
        let module_id = self.module_id;
        let requested_module = descriptor
            .pointer("/request/payload/moduleId")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if requested_module != module_id {
            return Err(anyhow!(
                "{context}: requests {FIELD_OPTIONS_SUBJECT} for module {requested_module:?}; \
                 a form may run only its own module's functions, so `payload.moduleId` must be {module_id:?}"
            ));
        }
        let function_id = descriptor
            .pointer("/request/payload/functionId")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if !self.manifest.functions.iter().any(|f| f.id == function_id) {
            return Err(anyhow!(
                "{context}: requests {FIELD_OPTIONS_SUBJECT} for function {function_id:?}, \
                 which this module does not declare"
            ));
        }
        Ok(())
    }
}

fn check_twitchapi_request(descriptor: &serde_json::Value, context: &str) -> Result<()> {
    let command = descriptor
        .pointer("/request/payload/command")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if TWITCHAPI_FORM_READS.contains(&command) {
        return Ok(());
    }
    Err(anyhow!(
        "{context}: requests {TWITCHAPI_SUBJECT} command {command:?}; a form may request only {TWITCHAPI_FORM_READS:?}"
    ))
}

fn reject_nested_requests(fields: &[ManifestConfigField], context: &str) -> Result<()> {
    for (i, field) in fields.iter().enumerate() {
        let label = format!("{context} field #{i} ({})", field.id);
        for (key, descriptor) in [("source", &field.source), ("action", &field.action)] {
            if descriptor.as_ref().is_some_and(is_internal_request) {
                return Err(anyhow!(
                    "{label}: `{key}`: internal sources are only supported on top-level fields"
                ));
            }
        }
        if let Some(item_fields) = &field.item_fields {
            reject_nested_requests(item_fields, &format!("{label}: `itemFields`"))?;
        }
    }
    Ok(())
}

/// A descriptor the api sends as a bus request. Must match the `kind` check
/// in api/src/routes/field-options.ts.
fn is_internal_request(descriptor: &serde_json::Value) -> bool {
    descriptor.get("kind").and_then(serde_json::Value::as_str) == Some("internal")
}

/// Enforce what each trigger transport may declare.
///
/// A webhook trigger is fired by its handler, never by the bus, and nothing
/// binds to it, so the fields that describe a bus event or a builder binding
/// mean nothing on it. They are rejected rather than silently ignored.
fn validate_trigger_transports(
    manifest: &ModuleManifest,
    provenance: InstallProvenance,
) -> Result<()> {
    for (i, trigger) in manifest.triggers.iter().enumerate() {
        let label = format!("trigger #{i} ({})", trigger.id);
        if trigger.trigger_type != WEBHOOK_TRIGGER_TYPE {
            if !trigger.handler.is_empty() {
                return Err(anyhow!(
                    "{label}: `handler` is only valid on `type: \"webhook\"` triggers"
                ));
            }
            let event = if trigger.event.is_empty() {
                &trigger.id
            } else {
                &trigger.event
            };
            if let Some(prefix) = reserved_event_prefixes(provenance)
                .iter()
                .find(|p| event.starts_with(**p))
            {
                return Err(anyhow!(
                    "{label}: event {event:?} uses the reserved prefix {prefix:?}"
                ));
            }
            continue;
        }

        let handler = trigger.handler.trim();
        if handler.is_empty() {
            return Err(anyhow!(
                "{label}: a webhook trigger must name its `handler` function"
            ));
        }
        if !manifest.functions.iter().any(|f| f.id.trim() == handler) {
            return Err(anyhow!(
                "{label}: handler {handler:?} names no function in this manifest"
            ));
        }
        if !trigger.event.is_empty() {
            return Err(anyhow!(
                "{label}: a webhook trigger cannot set `event`; the engine assigns it a reserved one"
            ));
        }
        if trigger.schema.is_some() {
            return Err(anyhow!(
                "{label}: a webhook trigger cannot declare `schema`; nothing binds to it"
            ));
        }
        if trigger.emits.is_some() {
            return Err(anyhow!(
                "{label}: a webhook trigger cannot declare `emits`; declare it on the eventbus trigger its handler returns"
            ));
        }
        if trigger.sentence.is_some() {
            return Err(anyhow!(
                "{label}: a webhook trigger cannot declare `sentence`; nothing configures it"
            ));
        }
        if trigger.allow_variants {
            return Err(anyhow!(
                "{label}: a webhook trigger cannot set `allowVariants`; nothing binds to it"
            ));
        }
    }
    Ok(())
}

/// Reject author workflows bound to ingress. A webhook trigger's
/// only consumer is its handler, so a binding would wait on an event nothing
/// publishes. A cross-module reference can only be resolved at install time,
/// where `execute_register_workflow` checks it.
fn validate_no_ingress_bindings(
    manifest: &ModuleManifest,
    module_id: &str,
    workflows: &[ResolvedWorkflow],
) -> Result<()> {
    for (workflow, resolved) in manifest.workflows.iter().zip(workflows) {
        let bound_to_ingress = match &resolved.trigger {
            WorkflowTriggerRef::Event(event) => event.starts_with(WEBHOOK_EVENT_PREFIX),
            WorkflowTriggerRef::Resource(canonical) => {
                canonical.module_id() == module_id
                    && manifest.triggers.iter().any(|t| {
                        t.id == canonical.resource_id() && t.trigger_type == WEBHOOK_TRIGGER_TYPE
                    })
            }
        };
        if bound_to_ingress {
            return Err(anyhow!(
                "workflow {:?}: cannot bind to a webhook trigger; bind to an event its handler returns",
                workflow.id
            ));
        }
    }
    Ok(())
}

/// A deadline is scheduled by id and invokes a function of this same module,
/// so a bad declaration can only surface when a module first calls
/// `ctx.schedule.at` -- or never, for a function that does not exist. All of
/// it is known here, so it fails the install instead.
fn validate_deadlines(manifest: &ModuleManifest) -> Result<()> {
    let functions: HashSet<&str> = manifest.functions.iter().map(|f| f.id.as_str()).collect();
    let mut seen: HashSet<&str> = HashSet::new();
    for (i, deadline) in manifest.deadlines.iter().enumerate() {
        if deadline.id.trim().is_empty() {
            return Err(anyhow!("deadlines[{i}]: id is required"));
        }
        if !seen.insert(deadline.id.as_str()) {
            return Err(anyhow!(
                "deadlines[{i}] ({}): duplicate deadline id",
                deadline.id
            ));
        }
        if !functions.contains(deadline.function.as_str()) {
            return Err(anyhow!(
                "deadlines[{i}] ({}): function {:?} is not declared in this manifest's `functions`",
                deadline.id,
                deadline.function
            ));
        }
        if !(1..=DEADLINES_MAX_PENDING_CAP).contains(&deadline.max_pending) {
            return Err(anyhow!(
                "deadlines[{i}] ({}): maxPending is required and must be between 1 and {DEADLINES_MAX_PENDING_CAP}, got {}",
                deadline.id,
                deadline.max_pending
            ));
        }
    }
    Ok(())
}

/// A permission opens privileged host functions to the module's code, so an
/// id the sandbox does not know is a typo or a request for something that
/// does not exist, and either way it should not install silently.
fn validate_permissions(manifest: &ModuleManifest) -> Result<()> {
    let mut seen: HashSet<&str> = HashSet::new();
    for (i, permission) in manifest.permissions.iter().enumerate() {
        if !lib_sandbox::permissions::is_known_permission(permission) {
            return Err(anyhow!(
                "permissions[{i}]: unknown permission {permission:?}; known permissions are {}",
                lib_sandbox::permissions::KNOWN_PERMISSIONS.join(", ")
            ));
        }
        if !seen.insert(permission.as_str()) {
            return Err(anyhow!("permissions[{i}]: {permission:?} is listed twice"));
        }
    }
    Ok(())
}

/// `oauth[]`: each integration names its OAuth endpoints, the settings that
/// hold its client credentials, and the hosts its token may go to.
fn validate_oauth(manifest: &ModuleManifest) -> Result<()> {
    let mut seen: HashSet<&str> = HashSet::new();
    for (i, integration) in manifest.oauth.iter().enumerate() {
        let id = integration.id.as_str();
        let context = format!("oauth[{i}] ({id})");
        let id_ok = !id.is_empty()
            && id.len() <= 40
            && id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-');
        if !id_ok {
            return Err(anyhow!(
                "{context}: `id` must be 1-40 lowercase letters, digits, `_` or `-`"
            ));
        }
        if !seen.insert(id) {
            return Err(anyhow!("{context}: `id` is listed twice"));
        }
        for (field, url) in [
            ("authorizeUrl", &integration.authorize_url),
            ("tokenUrl", &integration.token_url),
        ] {
            let parsed = url::Url::parse(url)
                .map_err(|e| anyhow!("{context}: `{field}` is not a URL: {e}"))?;
            if parsed.scheme() != "https" {
                return Err(anyhow!("{context}: `{field}` must be https"));
            }
        }
        if integration.hosts.is_empty() {
            return Err(anyhow!(
                "{context}: `hosts` must name at least one host its token may go to"
            ));
        }
        for host in &integration.hosts {
            if !lib_sandbox::net::is_valid_net_host(host) {
                return Err(anyhow!(
                    "{context}: host {host:?} must be an exact lowercase DNS name, with no IP address, port or wildcard"
                ));
            }
        }
        let setting_type = |setting_id: &str| {
            manifest
                .settings
                .iter()
                .find(|s| s.id == setting_id)
                .map(|s| s.setting_type.as_str())
        };
        match setting_type(&integration.client_id_setting) {
            Some("text") => {}
            Some(other) => {
                return Err(anyhow!(
                    "{context}: `clientIdSetting` {:?} must be a `text` setting, not `{other}`",
                    integration.client_id_setting
                ));
            }
            None => {
                return Err(anyhow!(
                    "{context}: `clientIdSetting` {:?} is not a setting this module declares",
                    integration.client_id_setting
                ));
            }
        }
        if let Some(secret_setting) = &integration.client_secret_setting {
            if setting_type(secret_setting) != Some(SECRET_SETTING_TYPE) {
                return Err(anyhow!(
                    "{context}: `clientSecretSetting` {secret_setting:?} must be a `secret` setting this module declares"
                ));
            }
        }
    }
    Ok(())
}

/// One unit of work in an install plan. Each variant names exactly one
/// thing `module_install.rs`'s executor does against the repository or
/// db-proxy — see its `SagaState::execute` for what each one runs.
///
/// The two bulk-registered kinds this crate doesn't resolve to canonical
/// ids — `backgroundTasks` and `settings` — have no `ResourceKind`
/// variant (nothing else in the system references either by canonical
/// id: a background task's `function` field is a raw manifest-local
/// string, never resolved, and settings have no reference fields at
/// all), so their steps carry no per-item identity, matching their
/// single-bulk-call registration today.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum InstallStep {
    UploadFunctionFiles,
    UploadWidgetAssets,
    UploadOverlayEntries,
    UploadAssets,
    CreateModule,
    RegisterTriggers,
    RegisterActions,
    RegisterWidgets,
    RegisterBackgroundTasks,
    RegisterSettings,
    /// Links each empty `resource_ref` setting that declares `create` to its
    /// instance, creating the instance when it does not exist yet.
    LinkResourceSettings,
    RegisterAssets,
    RegisterWorkflow(CanonicalId),
    RegisterCommand(CanonicalId),
}

/// A node in the install dependency graph, before topological sort.
struct StepNode {
    step: InstallStep,
    /// Tie-break key for otherwise-independent steps, reproducing
    /// `run_install`'s current fixed statement order (uploads, then
    /// `CreateModule`, then the kind-level bulk registrations in their
    /// current order, then every workflow in manifest order, then every
    /// command in manifest order) — real data dependencies are expressed
    /// as edges (`deps`) below; this only orders steps the edges leave
    /// unconstrained, deterministically, matching today's behavior
    /// rather than introducing new parallelism the db-proxy backend
    /// hasn't been verified to tolerate.
    phase: (u8, u8, u32),
    deps: Vec<usize>,
}

fn add_step(
    nodes: &mut Vec<StepNode>,
    index_of: &mut HashMap<InstallStep, usize>,
    step: InstallStep,
    phase: (u8, u8, u32),
    deps: &[&InstallStep],
) -> usize {
    let dep_indices = deps.iter().map(|d| index_of[*d]).collect();
    let idx = nodes.len();
    index_of.insert(step.clone(), idx);
    nodes.push(StepNode {
        step,
        phase,
        deps: dep_indices,
    });
    idx
}

/// Build the ordered list of install operations for `manifest`: a
/// dependency graph over [`InstallStep`]s — nodes are the resources
/// `resolved` carries, edges are the data dependencies traced through
/// `run_install`'s current body (see the design notes in the
/// `barkloader` implementation plan) — validated (including every
/// cross-module reference, via `db_proxy`) and topologically sorted.
/// Replaces `run_install`'s previously hand-ordered ~500-line sequence
/// with an explicit, independently testable value.
pub async fn build_install_plan(
    manifest: &ModuleManifest,
    resolved: &ResolvedManifest,
    db_proxy: &dyn ModuleDbProxy,
) -> Result<Vec<InstallStep>> {
    validate_cross_module_refs(resolved, db_proxy).await?;
    validate_cross_module_permissions(manifest, resolved, db_proxy).await?;
    validate_theme_dependencies(manifest, db_proxy).await?;

    let mut nodes: Vec<StepNode> = Vec::new();
    let mut index_of: HashMap<InstallStep, usize> = HashMap::new();

    add_step(
        &mut nodes,
        &mut index_of,
        InstallStep::UploadFunctionFiles,
        (0, 0, 0),
        &[],
    );
    add_step(
        &mut nodes,
        &mut index_of,
        InstallStep::UploadWidgetAssets,
        (0, 1, 0),
        &[],
    );
    add_step(
        &mut nodes,
        &mut index_of,
        InstallStep::UploadOverlayEntries,
        (0, 2, 0),
        &[],
    );
    add_step(
        &mut nodes,
        &mut index_of,
        InstallStep::UploadAssets,
        (0, 3, 0),
        &[],
    );

    add_step(
        &mut nodes,
        &mut index_of,
        InstallStep::CreateModule,
        (1, 0, 0),
        &[&InstallStep::UploadFunctionFiles],
    );

    // Triggers and actions register unconditionally today (even with an
    // empty list) — functions have no bulk-registration
    // call of their own, only the upload + (for functions) the ledger
    // entries `CreateModule` writes.
    add_step(
        &mut nodes,
        &mut index_of,
        InstallStep::RegisterTriggers,
        (2, 0, 0),
        &[&InstallStep::CreateModule],
    );
    add_step(
        &mut nodes,
        &mut index_of,
        InstallStep::RegisterActions,
        (2, 1, 0),
        &[&InstallStep::CreateModule],
    );

    if !resolved.widgets.is_empty() {
        add_step(
            &mut nodes,
            &mut index_of,
            InstallStep::RegisterWidgets,
            (2, 2, 0),
            &[&InstallStep::CreateModule],
        );
    }
    if !manifest.background_tasks.is_empty() {
        add_step(
            &mut nodes,
            &mut index_of,
            InstallStep::RegisterBackgroundTasks,
            (2, 3, 0),
            &[&InstallStep::CreateModule],
        );
    }
    // "button" settings are UI-only triggers, not stored values — same
    // filter `run_install` applies before deciding whether there's
    // anything to register.
    if manifest.settings.iter().any(|s| s.setting_type != "button") {
        add_step(
            &mut nodes,
            &mut index_of,
            InstallStep::RegisterSettings,
            (2, 4, 0),
            &[&InstallStep::CreateModule],
        );
    }
    if manifest.settings.iter().any(|s| s.create.is_some()) {
        add_step(
            &mut nodes,
            &mut index_of,
            InstallStep::LinkResourceSettings,
            (2, 4, 1),
            &[&InstallStep::RegisterSettings],
        );
    }
    if !resolved.assets.is_empty() {
        add_step(
            &mut nodes,
            &mut index_of,
            InstallStep::RegisterAssets,
            (2, 5, 0),
            &[&InstallStep::CreateModule, &InstallStep::UploadAssets],
        );
    }

    for (i, wf) in resolved.workflows.iter().enumerate() {
        add_step(
            &mut nodes,
            &mut index_of,
            InstallStep::RegisterWorkflow(wf.canonical_id.clone()),
            (3, 0, i as u32),
            // `asset_repo_keys`, built during `UploadAssets`, is threaded
            // into every workflow's registration for `${asset:...}`
            // marker substitution regardless of whether that particular
            // workflow uses one.
            &[&InstallStep::CreateModule, &InstallStep::UploadAssets],
        );
    }

    for (i, cmd) in resolved.commands.iter().enumerate() {
        let step = InstallStep::RegisterCommand(cmd.canonical_id.clone());
        // `UploadAssets` builds the `asset_repo_keys` a command's actions
        // resolve `${asset:...}` markers against, as a workflow's steps do.
        let mut deps = vec![InstallStep::CreateModule, InstallStep::UploadAssets];
        // A command referencing a workflow declared in *this* manifest
        // must run after that workflow registers. A cross-module
        // workflow reference has no node in this plan — it was already
        // validated above and is (by definition) already installed.
        if let Some(wf_id) = &cmd.workflow {
            if resolved.workflows.iter().any(|w| &w.canonical_id == wf_id) {
                deps.push(InstallStep::RegisterWorkflow(wf_id.clone()));
            }
        }
        let dep_refs: Vec<&InstallStep> = deps.iter().collect();
        add_step(&mut nodes, &mut index_of, step, (4, 0, i as u32), &dep_refs);
    }

    Ok(topo_sort(nodes))
}

/// Kahn's algorithm with a priority tie-break (`StepNode::phase`) so the
/// output is deterministic even among steps with no edge forcing an
/// order between them.
fn topo_sort(nodes: Vec<StepNode>) -> Vec<InstallStep> {
    let n = nodes.len();
    let mut indegree = vec![0usize; n];
    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, node) in nodes.iter().enumerate() {
        indegree[i] = node.deps.len();
        for &d in &node.deps {
            dependents[d].push(i);
        }
    }

    let mut ready: BinaryHeap<Reverse<((u8, u8, u32), usize)>> = BinaryHeap::new();
    for (i, node) in nodes.iter().enumerate() {
        if indegree[i] == 0 {
            ready.push(Reverse((node.phase, i)));
        }
    }

    let mut order = Vec::with_capacity(n);
    while let Some(Reverse((_, i))) = ready.pop() {
        order.push(i);
        for &dep in &dependents[i] {
            indegree[dep] -= 1;
            if indegree[dep] == 0 {
                ready.push(Reverse((nodes[dep].phase, dep)));
            }
        }
    }

    debug_assert_eq!(
        order.len(),
        n,
        "install step graph must be acyclic by construction"
    );

    let mut steps: Vec<Option<InstallStep>> =
        nodes.into_iter().map(|node| Some(node.step)).collect();
    order
        .into_iter()
        .map(|i| steps[i].take().expect("each index visited exactly once"))
        .collect()
}

/// Check every cross-module reference this manifest declares (a workflow's
/// trigger, a workflow step's action) resolves against an already-installed
/// module, via `db_proxy`.
///
/// No namespace is exempt. Bundled declarations used to be, because whichever
/// service owned them wrote their rows on its own startup schedule and they
/// might genuinely not exist yet at validation time. They are installed by
/// barkloader's boot reconciler before any user module can be uploaded now,
/// so they are ordinary rows resolvable by the same query as anything else --
/// and the namespace that was most prone to drift stops being the one with
/// the least validation.
async fn validate_cross_module_refs(
    resolved: &ResolvedManifest,
    db_proxy: &dyn ModuleDbProxy,
) -> Result<()> {
    let is_external = |id: &CanonicalId| id.module_id() != resolved.module_id.as_str();

    let mut missing: Vec<String> = Vec::new();
    let mut checked: HashSet<String> = HashSet::new();

    for wf in &resolved.workflows {
        // Event bindings name no declaration, so there is nothing to depend on.
        let Some(canonical) = wf.trigger.as_resource() else {
            continue;
        };
        if !is_external(canonical) || !checked.insert(canonical.to_string()) {
            continue;
        }
        if let Err(e) = db_proxy
            .get_trigger_event_by_canonical_id(&canonical.to_string())
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

    for wf in &resolved.workflows {
        for (si, action_canonical) in wf.step_actions.iter().enumerate() {
            if !is_external(action_canonical) || !checked.insert(action_canonical.to_string()) {
                continue;
            }
            if let Err(e) = db_proxy
                .get_action_ref_by_canonical_id(&action_canonical.to_string())
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

    for cmd in &resolved.commands {
        for (si, action_canonical) in cmd.step_actions.iter().enumerate() {
            if !is_external(action_canonical) || !checked.insert(action_canonical.to_string()) {
                continue;
            }
            if let Err(e) = db_proxy
                .get_action_ref_by_canonical_id(&action_canonical.to_string())
                .await
            {
                missing.push(format!(
                    "command '{}' action #{} → action '{}' ({})",
                    cmd.canonical_id.resource_id(),
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

/// Refuse an upload whose workflow steps or command actions call another
/// module's action unless this manifest declares every permission that
/// module declares.
///
/// The sandbox checks a call against the permissions of the module that owns
/// the running function, so a step naming another module's action runs with
/// that module's permissions. Without this check an upload holding no
/// `twitch.moderation` could time out chatters by naming the Twitch module's
/// timeout action in a workflow step. Requiring the target's whole permission
/// set, rather than what the one action uses, is coarser than necessary but
/// needs nothing the manifest does not already state.
///
/// Bundled system modules are exempt: they ship with the engine, and their
/// references are the engine's own wiring. References within this module are
/// covered by its own `permissions`.
async fn validate_cross_module_permissions(
    manifest: &ModuleManifest,
    resolved: &ResolvedManifest,
    db_proxy: &dyn ModuleDbProxy,
) -> Result<()> {
    if resolved.provenance == InstallProvenance::System {
        return Ok(());
    }

    let mut references: Vec<(String, &CanonicalId)> = Vec::new();
    for wf in &resolved.workflows {
        for (si, action) in wf.step_actions.iter().enumerate() {
            references.push((
                format!("workflow '{}' step #{si}", wf.canonical_id.resource_id()),
                action,
            ));
        }
    }
    for cmd in &resolved.commands {
        for (si, action) in cmd.step_actions.iter().enumerate() {
            references.push((
                format!("command '{}' action #{si}", cmd.canonical_id.resource_id()),
                action,
            ));
        }
    }
    references.retain(|(_, action)| action.module_id() != resolved.module_id.as_str());
    if references.is_empty() {
        return Ok(());
    }

    let installed: Vec<InstalledModule> = db_proxy
        .list_modules()
        .await?
        .into_iter()
        .filter_map(InstalledModule::from_record)
        .collect();
    let declared: HashSet<&str> = manifest.permissions.iter().map(String::as_str).collect();

    let mut refused: Vec<String> = Vec::new();
    let mut checked: HashSet<String> = HashSet::new();
    for (site, action) in references {
        if !checked.insert(action.to_string()) {
            continue;
        }
        let target = action.module_id();
        let Some(owner) = installed.iter().find(|m| m.module_id == target) else {
            refused.push(format!(
                "{site} → action '{action}': module '{target}' has no readable installed manifest, so the permissions its actions run with are unknown"
            ));
            continue;
        };
        let missing: Vec<&str> = owner
            .manifest
            .permissions
            .iter()
            .map(String::as_str)
            .filter(|p| !declared.contains(p))
            .collect();
        if !missing.is_empty() {
            refused.push(format!(
                "{site} → action '{action}' runs with module '{target}' permissions; add {} to this module's `permissions`",
                missing.join(", ")
            ));
        }
    }

    if !refused.is_empty() {
        return Err(anyhow!(
            "Module calls actions of other modules without declaring the permissions they run with:\n  - {}",
            refused.join("\n  - ")
        ));
    }
    Ok(())
}

/// Validate `manifest.resources[]`: every kind must be non-empty,
/// well-formed per [`validate_segment`], and unique within this manifest.
/// Resource kinds are not canonical-id'd themselves (instances are), so
/// this is intentionally a flat check rather than a [`build_kind_table`]
/// call.
fn validate_resource_kinds(items: &[ManifestResourceKind]) -> Result<()> {
    let mut seen: HashMap<String, usize> = HashMap::with_capacity(items.len());
    for (i, r) in items.iter().enumerate() {
        let kind = r.kind.trim();
        if kind.is_empty() {
            return Err(anyhow!(
                "resource #{i}: `kind` is required and must be non-empty"
            ));
        }
        validate_segment(kind, &format!("resource #{i} kind"))?;
        if let Some(prior) = seen.insert(kind.to_string(), i) {
            return Err(anyhow!(
                "resource #{i}: duplicate kind {kind:?} (already declared at resource #{prior})"
            ));
        }
    }
    Ok(())
}

/// Reject a manifest-declared relative path that escapes the module root:
/// a leading `/`/`\`, or any `..` path segment. Shared by asset-path and
/// widget-entry/assets validation — `ctx` is prepended to the error message
/// (e.g. `"widget #0: \`entry\`"`).
fn reject_traversal(path: &str, ctx: &str) -> Result<()> {
    let trimmed = path.trim();
    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(anyhow!(
            "{ctx} must be relative to the module root, got {:?}",
            path
        ));
    }
    for segment in trimmed.split(['/', '\\']) {
        if segment == ".." {
            return Err(anyhow!(
                "{ctx} must not contain `..` segments, got {:?}",
                path
            ));
        }
    }
    Ok(())
}

/// Authoring constraint (design 5.2.5): a widget `entry` must live
/// inside the widget's `assets` directory, because the registered
/// entry is normalized assets-relative and resolved against the
/// prefix-stripped repository keys
/// (`modules/{module_key}/widgets/{id}/{entry}`).
///
/// Validates the declared `entry`/`assets` strings directly (so a bad
/// path fails fast with a clear, field-scoped error) in addition to
/// calling `entry_relative_to_assets()`, which independently enforces
/// the same rule (via `normalize_rel_path`) for every install-time
/// caller — this is a second, earlier checkpoint, not a replacement.
/// `entry_relative_to_assets()` alone would miss a `..`-containing
/// `assets` directory when no `entry` is declared, since it returns
/// `Ok(None)` before ever inspecting `assets` in that case.
fn validate_widget_entries(widgets: &[ModuleWidget]) -> Result<()> {
    for (i, w) in widgets.iter().enumerate() {
        if let Some(entry) = &w.entry {
            reject_traversal(entry, &format!("widget #{i}: `entry`"))?;
        }
        if let Some(assets) = &w.assets {
            reject_traversal(assets, &format!("widget #{i}: `assets`"))?;
        }
        w.entry_relative_to_assets()
            .map_err(|e| anyhow!("widget #{i}: {e}"))?;
    }
    Ok(())
}

/// Enforce where each widget may be placed and what it may host.
///
/// Hosting is system-provenance only: the scene manager draws a hosting
/// widget itself, so declaring one binds engine behavior the same way a
/// `native` action does.
fn validate_widget_surfaces(widgets: &[ModuleWidget], provenance: InstallProvenance) -> Result<()> {
    for (i, w) in widgets.iter().enumerate() {
        let label = format!("widget #{i} ({})", w.id);
        if w.surfaces.is_empty() {
            return Err(anyhow!(
                "{label}: `surfaces` must name at least one of {}",
                WIDGET_SURFACES.join(", ")
            ));
        }
        let mut placed_on: HashSet<&str> = HashSet::with_capacity(w.surfaces.len());
        for surface in &w.surfaces {
            validate_surface(surface, &format!("{label}: `surfaces`"))?;
            if !placed_on.insert(surface.as_str()) {
                return Err(anyhow!("{label}: `surfaces` lists {surface:?} twice"));
            }
        }

        let Some(hosted) = w.hosts_surface.as_deref() else {
            continue;
        };
        if provenance != InstallProvenance::System {
            return Err(anyhow!(
                "{label}: `hostsSurface` may only be declared by a bundled system module"
            ));
        }
        validate_surface(hosted, &format!("{label}: `hostsSurface`"))?;
        if placed_on.contains(hosted) {
            return Err(anyhow!(
                "{label}: a widget cannot be placed on the surface it hosts ({hosted:?})"
            ));
        }
        if w.entry.is_some() {
            return Err(anyhow!(
                "{label}: a widget that hosts a surface is drawn by the scene manager, so it declares no `entry`"
            ));
        }
    }
    Ok(())
}

fn validate_surface(surface: &str, context: &str) -> Result<()> {
    if !WIDGET_SURFACES.contains(&surface) {
        return Err(anyhow!(
            "{context}: unknown surface {surface:?}; expected one of {}",
            WIDGET_SURFACES.join(", ")
        ));
    }
    Ok(())
}

/// Validate every field declaration on the manifest — a trigger's `schema`,
/// an action's `schema`, a widget's `settingsSchema`, and `settings`.
///
/// All four are the same vocabulary, so they are checked by the same rules.
/// Serde has already done the structural half by the time this runs: the
/// container must be a bare array, `id`/`label`/`type` must be present, and
/// `deny_unknown_fields` rejects `key`, `fieldType`, `name`, `default` and
/// plain typos. What is left are the rules serde cannot express.
///
/// This is what makes the contract single-shaped rather than merely
/// documented as such. The previous arrangement — four accepted container
/// shapes, no validation, and a consumer that silently dropped what it did not
/// recognise — is how a widget came to declare five settings and render none.
fn validate_field_lists(manifest: &ModuleManifest) -> Result<()> {
    for (i, t) in manifest.triggers.iter().enumerate() {
        if let Some(fields) = &t.schema {
            validate_field_list(fields, &format!("trigger #{i} ({}): `schema`", t.id))?;
        }
    }
    for (i, a) in manifest.actions.iter().enumerate() {
        validate_field_list(&a.schema, &format!("action #{i} ({}): `schema`", a.id))?;
    }
    for (i, w) in manifest.widgets.iter().enumerate() {
        if let Some(fields) = &w.settings_schema {
            validate_field_list(fields, &format!("widget #{i} ({}): `settingsSchema`", w.id))?;
        }
    }
    for (i, r) in manifest.resources.iter().enumerate() {
        validate_field_list(&r.schema, &format!("resource #{i} ({}): `schema`", r.kind))?;
    }
    validate_settings(&manifest.settings)
}

fn validate_field_list(fields: &[ManifestConfigField], context: &str) -> Result<()> {
    let mut seen: HashSet<&str> = HashSet::with_capacity(fields.len());
    for (i, field) in fields.iter().enumerate() {
        let id = field.id.trim();
        if id.is_empty() {
            return Err(anyhow!(
                "{context} field #{i}: `id` is required and must be non-empty"
            ));
        }
        if field.label.trim().is_empty() {
            return Err(anyhow!(
                "{context} field #{i} ({id}): `label` must be non-empty"
            ));
        }
        validate_field_type(&field.field_type, &format!("{context} field #{i} ({id})"))?;
        reject_theme_field(&field.field_type, &format!("{context} field #{i} ({id})"))?;
        // A select with nothing to select, or a resource picker that does not
        // say what to pick, renders a dead control. Both are cheap to catch
        // here and confusing to debug in a form.
        if field.field_type == "select"
            && field.source.is_none()
            && field.options.as_ref().is_none_or(|o| o.is_empty())
        {
            return Err(anyhow!(
                "{context} field #{i} ({id}): `select` needs `options` or a `source`"
            ));
        }
        if field.field_type == "resource_ref" && field.resource_kind.is_none() {
            return Err(anyhow!(
                "{context} field #{i} ({id}): `resource_ref` needs `resourceKind`"
            ));
        }
        if field.field_type == "button" && field.action.is_none() {
            return Err(anyhow!(
                "{context} field #{i} ({id}): `button` needs an `action`"
            ));
        }
        if field.field_type == "layout" {
            validate_surface(
                field.surface.as_deref().unwrap_or_default(),
                &format!("{context} field #{i} ({id}): `layout` needs a `surface`"),
            )?;
        }
        validate_item_fields(field, &format!("{context} field #{i} ({id})"))?;
        validate_operators(field, &format!("{context} field #{i} ({id})"))?;
        // An empty `anyText` is meaningful - it drops the part of the sentence -
        // but whitespace alone is neither that nor words, so it is a slip.
        if let Some(any_text) = &field.any_text
            && !any_text.is_empty()
            && any_text.trim().is_empty()
        {
            return Err(anyhow!(
                "{context} field #{i} ({id}): `anyText` must be words or exactly \"\" to drop the phrase"
            ));
        }
        if let Some(missing_text) = &field.missing_text
            && missing_text.trim().is_empty()
        {
            return Err(anyhow!(
                "{context} field #{i} ({id}): `missingText` must be non-empty"
            ));
        }
        if !seen.insert(id) {
            return Err(anyhow!("{context}: duplicate field `id` {id:?}"));
        }
    }
    Ok(())
}

/// `operators` offers the user a choice of comparison for a number, so it
/// needs a number to compare, a real choice, and a default (`operator`) that
/// is one of the choices.
fn validate_operators(field: &ManifestConfigField, context: &str) -> Result<()> {
    let Some(operators) = &field.operators else {
        return Ok(());
    };
    if field.field_type != "number" {
        return Err(anyhow!(
            "{context}: `operators` is only allowed on a `number` field"
        ));
    }
    if operators.len() < 2 {
        return Err(anyhow!(
            "{context}: `operators` must offer at least two comparisons; for one, use `operator` alone"
        ));
    }
    let mut seen: HashSet<&str> = HashSet::with_capacity(operators.len());
    for operator in operators {
        if !COMPARISON_OPERATORS.contains(&operator.as_str()) {
            return Err(anyhow!(
                "{context}: unknown comparison {operator:?} in `operators`; expected one of {}",
                COMPARISON_OPERATORS.join(", ")
            ));
        }
        if !seen.insert(operator) {
            return Err(anyhow!("{context}: `operators` lists {operator:?} twice"));
        }
    }
    match &field.operator {
        Some(default) if operators.contains(default) => Ok(()),
        Some(default) => Err(anyhow!(
            "{context}: `operator` {default:?} must be one of `operators`, as it is the default choice"
        )),
        None => Err(anyhow!(
            "{context}: `operators` needs an `operator` naming the default choice"
        )),
    }
}

/// A `list` field declares the fields of one row, and only a `list` does.
fn validate_item_fields(field: &ManifestConfigField, context: &str) -> Result<()> {
    let Some(item_fields) = &field.item_fields else {
        if field.field_type == "list" {
            return Err(anyhow!("{context}: `list` needs `itemFields`"));
        }
        return Ok(());
    };
    if field.field_type != "list" {
        return Err(anyhow!("{context}: only a `list` field takes `itemFields`"));
    }
    if item_fields.is_empty() {
        return Err(anyhow!(
            "{context}: `itemFields` must name at least one field"
        ));
    }
    for (i, item) in item_fields.iter().enumerate() {
        if !LIST_ITEM_FIELD_TYPES.contains(&item.field_type.as_str()) {
            return Err(anyhow!(
                "{context}: item field #{i} ({}) has type {:?}; a list row takes only: {}",
                item.id,
                item.field_type,
                LIST_ITEM_FIELD_TYPES.join(", ")
            ));
        }
    }
    validate_field_list(item_fields, &format!("{context}: `itemFields`"))
}

/// Validate every declared trigger `sentence` against its trigger's `schema`.
///
/// The UI renders the sentence by substituting each `{fieldId}`, so anything
/// it cannot substitute would show a raw brace to the end user. Rejected at
/// install, naming the trigger:
///
///   - a sentence that is empty or only whitespace
///   - an unbalanced `{` or `}`, or a `{` inside a placeholder - there is no
///     escape syntax, so literal braces are not expressible
///   - a placeholder that is not the `id` of a field in the trigger's `schema`
///
/// Runs after `validate_field_lists`, so field ids are already known to be
/// non-empty and unique.
fn validate_trigger_sentences(triggers: &[ManifestTrigger]) -> Result<()> {
    for (i, t) in triggers.iter().enumerate() {
        let Some(sentence) = &t.sentence else {
            continue;
        };
        let label = format!("trigger #{i} ({}): `sentence`", t.id);
        if sentence.trim().is_empty() {
            return Err(anyhow!("{label} must be non-empty"));
        }
        let field_ids: HashSet<&str> = t.schema.iter().flatten().map(|f| f.id.trim()).collect();
        for placeholder in sentence_placeholders(sentence).map_err(|e| anyhow!("{label}: {e}"))? {
            if !field_ids.contains(placeholder) {
                return Err(anyhow!(
                    "{label}: placeholder {{{placeholder}}} names no field in this trigger's `schema`"
                ));
            }
        }
    }
    Ok(())
}

/// The `{placeholder}` names in a sentence template, in order, or why the
/// template's braces are malformed.
fn sentence_placeholders(sentence: &str) -> Result<Vec<&str>, String> {
    let mut placeholders = Vec::new();
    let mut open: Option<usize> = None;
    for (at, c) in sentence.char_indices() {
        match (c, open) {
            ('{', Some(_)) => {
                return Err(format!("nested `{{` at byte {at}"));
            }
            ('{', None) => {
                open = Some(at);
            }
            ('}', None) => {
                return Err(format!("unmatched `}}` at byte {at}"));
            }
            ('}', Some(start)) => {
                let name = &sentence[start + 1..at];
                if name.is_empty() {
                    return Err(format!("empty placeholder `{{}}` at byte {start}"));
                }
                placeholders.push(name);
                open = None;
            }
            _ => {}
        }
    }
    if let Some(start) = open {
        return Err(format!("unclosed `{{` at byte {start}"));
    }
    Ok(placeholders)
}

fn validate_settings(settings: &[ManifestSetting]) -> Result<()> {
    let mut seen: HashSet<&str> = HashSet::with_capacity(settings.len());
    for (i, setting) in settings.iter().enumerate() {
        let id = setting.id.trim();
        if id.is_empty() {
            return Err(anyhow!(
                "setting #{i}: `id` is required and must be non-empty"
            ));
        }
        if setting.label.trim().is_empty() {
            return Err(anyhow!("setting #{i} ({id}): `label` must be non-empty"));
        }
        if lib_sandbox::oauth::is_reserved_setting_key(id) {
            return Err(anyhow!(
                "setting #{i} ({id}): ids starting with `oauth.` are reserved for the tokens the engine keeps"
            ));
        }
        // `secret` and `url` are settings-only types: no trigger, action or
        // widget field holds one, so they stay out of CONFIG_FIELD_TYPES.
        if setting.setting_type == SECRET_SETTING_TYPE {
            if setting.default_value.is_some() {
                return Err(anyhow!(
                    "setting #{i} ({id}): a `secret` setting cannot declare `defaultValue`; the manifest would ship the secret"
                ));
            }
        } else if setting.setting_type == URL_SETTING_TYPE {
            if setting.default_value.is_some() {
                return Err(anyhow!(
                    "setting #{i} ({id}): a `url` setting cannot declare `defaultValue`; its origin is a destination the streamer chooses, and a manifest destination goes in `permissions` as `net:<host>`"
                ));
            }
        } else {
            validate_field_type(&setting.setting_type, &format!("setting #{i} ({id})"))?;
            reject_theme_field(&setting.setting_type, &format!("setting #{i} ({id})"))?;
        }
        // A module setting declares no `itemFields`, so a list would render
        // rows with nothing in them.
        if setting.setting_type == "list" {
            return Err(anyhow!(
                "setting #{i} ({id}): a module setting cannot be a `list`"
            ));
        }
        if setting.setting_type == "button" && setting.action.is_null() {
            return Err(anyhow!("setting #{i} ({id}): `button` needs an `action`"));
        }
        validate_resource_ref_setting(setting, &format!("setting #{i} ({id})"))?;
        if !seen.insert(id) {
            return Err(anyhow!("duplicate setting `id` {id:?}"));
        }
    }
    Ok(())
}

/// A `resource_ref` setting names the kind it links to, and may say what
/// install creates when it is empty. Neither field means anything elsewhere.
fn validate_resource_ref_setting(setting: &ManifestSetting, context: &str) -> Result<()> {
    if setting.setting_type != "resource_ref" {
        if setting.resource_kind.is_some() {
            return Err(anyhow!("{context}: `resourceKind` is only for a `resource_ref` setting"));
        }
        if setting.create.is_some() {
            return Err(anyhow!("{context}: `create` is only for a `resource_ref` setting"));
        }
        return Ok(());
    }
    let Some(kind) = setting.resource_kind.as_deref() else {
        return Err(anyhow!("{context}: `resource_ref` needs `resourceKind`"));
    };
    validate_segment(kind, &format!("{context}: `resourceKind`"))?;
    // The value is an instance's canonical id, which only an existing
    // instance has; a manifest cannot know it ahead of install.
    if setting.default_value.is_some() {
        return Err(anyhow!(
            "{context}: a `resource_ref` setting cannot declare `defaultValue`; use `create` to link an instance at install"
        ));
    }
    if let Some(create) = &setting.create {
        validate_segment(&create.instance_id, &format!("{context}: `create.instanceId`"))?;
        if create.display_name.trim().is_empty() {
            return Err(anyhow!("{context}: `create.displayName` must be non-empty"));
        }
        if create.settings.as_ref().is_some_and(|s| !s.is_object()) {
            return Err(anyhow!("{context}: `create.settings` must be an object"));
        }
    }
    Ok(())
}

fn validate_field_type(field_type: &str, context: &str) -> Result<()> {
    if !CONFIG_FIELD_TYPES.contains(&field_type) {
        return Err(anyhow!(
            "{context}: unknown `type` {field_type:?}; expected one of {}",
            CONFIG_FIELD_TYPES.join(", ")
        ));
    }
    Ok(())
}

/// A `theme` field is the engine's to add, to a widget that declares a
/// contract; declared by hand it would have no contract to list themes for.
fn reject_theme_field(field_type: &str, context: &str) -> Result<()> {
    if field_type == THEME_FIELD_TYPE {
        return Err(anyhow!(
            "{context}: a `theme` field cannot be declared; declare a `theme` contract on the widget and the engine adds the picker"
        ));
    }
    Ok(())
}

/// Validate every declared `emits` / `returns` shape.
///
/// Serde has already enforced the structure by the time this runs — a `fields`
/// that is not a list, or an entry missing `path` or `type`, fails at parse.
/// What is left are the rules serde cannot express, and each one is reported
/// with the offending module resource named so the author can find it:
///
///   - a `path` must be non-empty
///   - a `type` must be one of the accepted tokens
///   - paths must be unique within one shape
///
/// A duplicate path is rejected rather than deduplicated. A path is a
/// variable's identity, so two entries under one path are either redundant or
/// contradictory, and nothing here can tell which the author meant.
/// Deduplicating would mean silently picking one — harmless if they match,
/// arbitrary if they do not. Rejecting covers both without guessing, and a
/// duplicate is an author slip that should not reach a manifest anyway.
///
/// This runs before any database or file-system side effect, so a bad
/// declaration aborts the install rather than landing a shape that renders
/// wrong variables forever.
fn validate_data_shapes(triggers: &[ManifestTrigger], actions: &[ManifestAction]) -> Result<()> {
    for (i, t) in triggers.iter().enumerate() {
        if let Some(shape) = &t.emits {
            validate_data_shape(shape, &format!("trigger #{i} ({}): `emits`", t.id))?;
        }
    }
    for (i, a) in actions.iter().enumerate() {
        if let Some(shape) = &a.returns {
            validate_data_shape(shape, &format!("action #{i} ({}): `returns`", a.id))?;
        }
    }
    Ok(())
}

fn validate_data_shape(shape: &ManifestDataShape, context: &str) -> Result<()> {
    let mut seen: HashSet<&str> = HashSet::with_capacity(shape.fields.len());
    for (i, field) in shape.fields.iter().enumerate() {
        let path = field.path.trim();
        if path.is_empty() {
            return Err(anyhow!(
                "{context} field #{i}: `path` is required and must be non-empty"
            ));
        }
        if !DATA_SHAPE_FIELD_TYPES.contains(&field.field_type.as_str()) {
            return Err(anyhow!(
                "{context} field #{i} ({path}): unknown `type` {:?}; expected one of {}",
                field.field_type,
                DATA_SHAPE_FIELD_TYPES.join(", ")
            ));
        }
        if !seen.insert(path) {
            return Err(anyhow!("{context}: duplicate `path` {path:?}"));
        }
    }
    Ok(())
}

/// Cheap manifest-time validation for `assets[]`: each entry must have
/// a non-empty `path` that doesn't try to escape the module root.
/// Existence inside the zip is checked at install time by the upload
/// path (via `resolve_zip_file`) so this stays pure / IO-free.
/// Reject a non-empty `acceptedEvents` on a widget.
///
/// Scenes are only ever sent alerts, and alerts reach alert widgets by name,
/// so an event type here would route nothing. Rejecting it by name tells the
/// author why, where serde dropping the field would leave a widget silently
/// waiting on events that never come. An empty list asks for nothing and
/// stays installable.
fn validate_no_accepted_events(widgets: &[ModuleWidget]) -> Result<()> {
    for (i, w) in widgets.iter().enumerate() {
        if !w.accepted_events.is_empty() {
            return Err(anyhow!(
                "widget #{i} ({}): `acceptedEvents` is no longer supported. Scenes receive alerts \
                 through alert widgets, by name; remove the field.",
                w.id
            ));
        }
    }
    Ok(())
}

/// Reject the retired `overlays[]` surface.
///
/// It never had a catalog registration or a serving route, so a declared
/// overlay uploaded a file and then resolved to nothing -- and an author had
/// no way to find that out except by noticing their overlay never appeared.
/// Scenes replaced it: a module contributes widgets, and the operator composes
/// them into a scene addressed by an overlay token minted in the UI.
///
/// An error rather than a warning, because a warning is what this already was
/// and it did not stop anyone from depending on the field.
fn validate_no_overlays(manifest: &ModuleManifest) -> Result<()> {
    if manifest.overlays.is_empty() {
        return Ok(());
    }
    let ids: Vec<&str> = manifest
        .overlays
        .iter()
        .map(|o| {
            if o.id.is_empty() {
                "<unnamed>"
            } else {
                o.id.as_str()
            }
        })
        .collect();
    Err(anyhow!(
        "`overlays` is no longer supported (declared: {}). Overlays are composed in the UI: \
         publish the visual as a widget under `widgets[]`, then place it on a scene and point \
         a browser source at that scene's overlay token.",
        ids.join(", ")
    ))
}

fn validate_asset_paths(assets: &[ManifestAsset]) -> Result<()> {
    for (i, a) in assets.iter().enumerate() {
        let trimmed = a.path.trim();
        if trimmed.is_empty() {
            return Err(anyhow!(
                "asset #{i} ({}): `path` is required and must be non-empty",
                a.id
            ));
        }
        reject_traversal(&a.path, &format!("asset #{i} ({}): `path`", a.id))?;
    }
    Ok(())
}

/// Validate and return the manifest's top-level id.
fn require_module_id(manifest: &ModuleManifest) -> Result<String> {
    let trimmed = manifest.id.trim();
    if trimmed.is_empty() {
        return Err(anyhow!(
            "manifest top-level `id` is required and must be non-empty"
        ));
    }
    validate_segment(trimmed, "manifest top-level id")?;
    Ok(trimmed.to_string())
}

/// Per-kind lookup table built during Pass 1. Maps the manifest-local id
/// to its canonical id and its index in the source vector. Order is
/// preserved via `manifest_index` so callers can produce
/// manifest-order-stable Vec outputs.
struct KindTable {
    entries: HashMap<String, KindEntry>,
}

struct KindEntry {
    canonical_id: CanonicalId,
    manifest_index: usize,
}

fn build_kind_table<T>(
    module_id: &str,
    kind: ResourceKind,
    items: &[T],
    id_of: impl Fn(&T) -> &str,
) -> Result<KindTable> {
    let mut table = HashMap::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let id_raw = id_of(item).trim();
        if id_raw.is_empty() {
            return Err(anyhow!(
                "{kind} #{i}: `id` is required and must be non-empty"
            ));
        }
        validate_segment(id_raw, &format!("{kind} #{i} id"))?;
        let canonical = CanonicalId::new(module_id, kind, id_raw)?;
        let prior = table.insert(
            id_raw.to_string(),
            KindEntry {
                canonical_id: canonical,
                manifest_index: i,
            },
        );
        if prior.is_some() {
            return Err(anyhow!(
                "{kind} #{i}: duplicate id {id_raw:?} (each {kind} id must be unique within this manifest)"
            ));
        }
    }
    Ok(KindTable { entries: table })
}

/// Project a KindTable into a manifest-ordered Vec via a per-entry
/// constructor. Used for kinds that have no references to resolve
/// (triggers, functions).
fn entries_to_resolved<R>(table: &KindTable, build: impl Fn(&KindEntry) -> R) -> Vec<R> {
    let mut entries: Vec<&KindEntry> = table.entries.values().collect();
    entries.sort_by_key(|e| e.manifest_index);
    entries.into_iter().map(build).collect()
}

fn resolve_actions(
    items: &[ManifestAction],
    actions_table: &KindTable,
    functions_table: &KindTable,
) -> Result<Vec<ResolvedAction>> {
    let mut out = Vec::with_capacity(items.len());
    for (i, action) in items.iter().enumerate() {
        let entry = actions_table
            .entries
            .get(action.id.trim())
            .ok_or_else(|| anyhow!("internal: action #{i} missing from action table"))?;
        let implementation = resolve_action_impl(
            &action.implementation,
            functions_table,
            &format!("action #{i} ({})", action.id),
        )?;
        out.push(ResolvedAction {
            canonical_id: entry.canonical_id.clone(),
            implementation,
        });
    }
    Ok(out)
}

fn resolve_action_impl(
    impl_: &ManifestActionImpl,
    functions_table: &KindTable,
    field_label: &str,
) -> Result<ResolvedActionImpl> {
    match impl_ {
        ManifestActionImpl::Native { handler } => {
            let handler = handler.trim();
            if handler.is_empty() {
                return Err(anyhow!(
                    "{field_label}: `native` needs a non-empty `handler`"
                ));
            }
            Ok(ResolvedActionImpl::Native {
                handler: handler.to_string(),
            })
        }
        ManifestActionImpl::Function { function } => {
            let target = function.trim();
            if target.is_empty() {
                return Err(anyhow!(
                    "{field_label}: `function` field is empty for type=function action"
                ));
            }
            let canonical = resolve_local_or_canonical(
                target,
                ResourceKind::Function,
                functions_table,
                &format!("{field_label} function"),
            )?;
            Ok(ResolvedActionImpl::Function {
                canonical_function_id: canonical,
            })
        }
    }
}

fn resolve_commands(
    items: &[ManifestCommand],
    commands_table: &KindTable,
    workflows_table: &KindTable,
    actions_table: &KindTable,
) -> Result<Vec<ResolvedCommand>> {
    let mut out = Vec::with_capacity(items.len());
    for (i, command) in items.iter().enumerate() {
        let entry = commands_table
            .entries
            .get(command.id.trim())
            .ok_or_else(|| anyhow!("internal: command #{i} missing from command table"))?;
        let workflow = match command.workflow.as_deref() {
            Some(raw) if !raw.trim().is_empty() => Some(resolve_local_or_canonical(
                raw.trim(),
                ResourceKind::Workflow,
                workflows_table,
                &format!("command #{i} ({}) workflow", command.id),
            )?),
            _ => None,
        };
        if workflow.is_some() && !command.actions.is_empty() {
            return Err(anyhow!(
                "command #{i} ({}): declare either `workflow` or `actions`, not both",
                command.id
            ));
        }
        let mut step_actions = Vec::with_capacity(command.actions.len());
        for (si, step) in command.actions.iter().enumerate() {
            step_actions.push(resolve_local_or_canonical(
                step.action.trim(),
                ResourceKind::Action,
                actions_table,
                &format!("command #{i} ({}) action #{si}", command.id),
            )?);
        }
        out.push(ResolvedCommand {
            canonical_id: entry.canonical_id.clone(),
            workflow,
            step_actions,
        });
    }
    Ok(out)
}

fn resolve_workflows(
    items: &[ManifestWorkflow],
    workflows_table: &KindTable,
    triggers_table: &KindTable,
    actions_table: &KindTable,
) -> Result<Vec<ResolvedWorkflow>> {
    let mut out = Vec::with_capacity(items.len());
    for (i, workflow) in items.iter().enumerate() {
        let entry = workflows_table
            .entries
            .get(workflow.id.trim())
            .ok_or_else(|| anyhow!("internal: workflow #{i} missing from workflow table"))?;
        let trigger = resolve_workflow_trigger(
            workflow.trigger.trim(),
            triggers_table,
            &format!("workflow #{i} ({}) trigger", workflow.id),
        )?;
        let mut step_actions = Vec::with_capacity(workflow.steps.len());
        for (si, step) in workflow.steps.iter().enumerate() {
            let action_canonical = resolve_local_or_canonical(
                step.action.trim(),
                ResourceKind::Action,
                actions_table,
                &format!("workflow #{i} ({}) step #{si} action", workflow.id),
            )?;
            step_actions.push(action_canonical);
        }
        out.push(ResolvedWorkflow {
            canonical_id: entry.canonical_id.clone(),
            trigger,
            step_actions,
        });
    }
    Ok(out)
}

fn resolve_widgets(
    items: &[ModuleWidget],
    widgets_table: &KindTable,
) -> Result<Vec<ResolvedWidget>> {
    let mut out = Vec::with_capacity(items.len());
    for (i, widget) in items.iter().enumerate() {
        let entry = widgets_table
            .entries
            .get(widget.id.trim())
            .ok_or_else(|| anyhow!("internal: widget #{i} missing from widget table"))?;
        out.push(ResolvedWidget {
            canonical_id: entry.canonical_id.clone(),
        });
    }
    Ok(out)
}

/// Decide whether a workflow's `trigger` names a declaration or an event.
///
/// The form is inferred rather than tagged: a canonical id is recognisable on
/// sight, and requiring a discriminator key for something already unambiguous
/// is noise in every manifest.
///
/// The one genuinely ambiguous case is a bare word. `t1` could be a local
/// trigger id or an event type, and guessing wrong on a typo would produce a
/// workflow that installs cleanly and never fires. Event types in this system
/// are always dotted, so a dotless value that matches no local trigger is
/// treated as a mistyped reference and rejected.
fn resolve_workflow_trigger(
    raw: &str,
    triggers_table: &KindTable,
    label: &str,
) -> Result<WorkflowTriggerRef> {
    if raw.is_empty() {
        return Err(anyhow!("{label}: must name a trigger or an event type"));
    }

    if raw.contains(CANONICAL_ID_SEPARATOR) {
        let canonical =
            resolve_local_or_canonical(raw, ResourceKind::Trigger, triggers_table, label)?;
        return Ok(WorkflowTriggerRef::Resource(canonical));
    }

    if triggers_table.entries.contains_key(raw) {
        let canonical =
            resolve_local_or_canonical(raw, ResourceKind::Trigger, triggers_table, label)?;
        return Ok(WorkflowTriggerRef::Resource(canonical));
    }

    if !raw.contains('.') {
        return Err(anyhow!(
            "{label}: {raw:?} matches no trigger in this manifest, and is not an event type \
             (event types are dotted, e.g. \"channel.follow\")"
        ));
    }

    Ok(WorkflowTriggerRef::Event(raw.to_string()))
}

/// Resolve a reference field that's either a manifest-local id or a full
/// canonical id pointing at any module. Validates the kind matches in the
/// canonical case and returns a clear error message in all failure modes.
fn resolve_local_or_canonical(
    raw: &str,
    expected_kind: ResourceKind,
    local_table: &KindTable,
    field_label: &str,
) -> Result<CanonicalId> {
    if raw.is_empty() {
        return Err(anyhow!("{field_label}: empty reference"));
    }
    if looks_like_canonical_id(raw) {
        let parts: Vec<&str> = raw.split(CANONICAL_ID_SEPARATOR).collect();
        // looks_like_canonical_id guarantees parts.len() == 3 and non-empty parts.
        let parsed_kind = parts[1];
        if parsed_kind != expected_kind.as_str() {
            return Err(anyhow!(
                "{field_label}: canonical id {raw:?} kind {parsed_kind:?} does not match expected kind {expected_kind}"
            ));
        }
        return CanonicalId::new(parts[0], expected_kind, parts[2]);
    }
    if let Some(entry) = local_table.entries.get(raw) {
        Ok(entry.canonical_id.clone())
    } else {
        Err(anyhow!(
            "{field_label}: reference {raw:?} does not match any {expected_kind} declared in this manifest"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bundled system module installs at every boot, so a manifest it cannot
    /// validate fails there rather than here. Checked against the real file.
    #[test]
    fn the_bundled_woofx3_manifest_validates() {
        let raw = include_str!("../../../modules/woofx3/manifest.json");
        let manifest: ModuleManifest =
            serde_json::from_str(raw).expect("bundled woofx3 manifest parses");
        validate_with_provenance(&manifest, InstallProvenance::System)
            .expect("bundled woofx3 manifest validates as a system module");

        for (kind, expected) in [
            (
                "counter",
                &[
                    "lifetime",
                    "initialValue",
                    "step",
                    "goals",
                    "announceEveryTime",
                ][..],
            ),
            ("timer", &["lifetime", "duration"][..]),
            ("queue", &["lifetime", "capacity", "allowDuplicates"][..]),
        ] {
            let declared = manifest
                .resources
                .iter()
                .find(|resource| resource.kind == kind)
                .unwrap_or_else(|| panic!("woofx3 declares the {kind} resource kind"));
            let fields: Vec<&str> = declared
                .schema
                .iter()
                .map(|field| field.id.as_str())
                .collect();
            assert_eq!(fields, expected, "{kind}");
        }
    }

    /// The sample theme pack is the reference for authors, so it has to fit
    /// the bundled Timer widget's contract as that contract stands.
    #[test]
    fn the_sample_theme_pack_fits_the_bundled_timer_contract() {
        let bundled: ModuleManifest =
            serde_json::from_str(include_str!("../../../modules/woofx3/manifest.json"))
                .expect("bundled woofx3 manifest parses");
        let pack: ModuleManifest = serde_json::from_str(include_str!(
            "../../../examples/theme-packs/timer-neon/manifest.json"
        ))
        .expect("sample theme pack parses");
        validate(&pack).expect("sample theme pack validates");

        let timer = bundled
            .widgets
            .iter()
            .find(|w| w.id == "timer")
            .expect("woofx3 declares the timer widget");
        let contract = timer
            .theme
            .as_ref()
            .expect("the timer widget declares a theme contract");
        for t in &pack.themes {
            assert_eq!(t.target, "woofx3:widget:timer");
            theme::check_against_contract(t, contract).expect("sample theme fits the contract");
        }
        let mut installed = HashMap::new();
        installed.insert("woofx3".to_string(), bundled.version.clone());
        theme::check_requires(&pack.requires, &installed)
            .expect("the bundled version satisfies the sample pack's requires");
    }

    fn parse(json: &str) -> ModuleManifest {
        serde_json::from_str(json).expect("manifest parse")
    }

    fn minimal(extra: &str) -> ModuleManifest {
        let json = format!(
            r#"{{
                "id": "test_mod",
                "name": "Test Mod",
                "version": "1.0.0"
                {extra}
            }}"#
        );
        parse(&json)
    }

    // ---------------------------------------------------------------
    // `native` actions
    // ---------------------------------------------------------------

    #[test]
    fn a_system_module_may_declare_a_native_action() {
        let m = parse(&format!(
            r#"{{"id": "{SYSTEM_MODULE_ID}", "name": "woofx3", "version": "1.0.0",
                 "actions": [{{"id": "alert", "name": "Alert", "type": "native", "handler": "alert"}}]}}"#
        ));
        let resolved = validate_with_provenance(&m, InstallProvenance::System).expect("system ok");
        assert_eq!(
            resolved.actions[0].implementation,
            ResolvedActionImpl::Native {
                handler: "alert".to_string()
            }
        );
    }

    // Otherwise a manifest becomes a way to bind a workflow step to whatever
    // engine internals happen to be registered.
    #[test]
    fn a_user_upload_may_not_declare_a_native_action() {
        let m = minimal(
            r#",
            "actions": [{ "id": "alert", "name": "Alert", "type": "native", "handler": "alert" }]"#,
        );
        let err = validate(&m)
            .expect_err("uploads may not name engine handlers")
            .to_string();
        assert!(err.contains("action #0 (alert)"), "names the action: {err}");
        assert!(err.contains("native"), "{err}");
    }

    #[test]
    fn a_native_action_needs_a_handler() {
        let m = parse(&format!(
            r#"{{"id": "{SYSTEM_MODULE_ID}", "name": "woofx3", "version": "1.0.0",
                 "actions": [{{"id": "alert", "name": "Alert", "type": "native", "handler": "  "}}]}}"#
        ));
        let err = validate_with_provenance(&m, InstallProvenance::System)
            .expect_err("an empty handler dispatches nowhere")
            .to_string();
        assert!(err.contains("handler"), "{err}");
    }

    // A native action resolves nothing, so it must not be made to look like a
    // function reference that failed to resolve.
    #[test]
    fn a_native_action_does_not_need_a_function_to_exist() {
        let m = parse(&format!(
            r#"{{"id": "{SYSTEM_MODULE_ID}", "name": "woofx3", "version": "1.0.0",
                 "actions": [{{"id": "print", "name": "Print", "type": "native", "handler": "print"}}]}}"#
        ));
        validate_with_provenance(&m, InstallProvenance::System)
            .expect("no functions declared, and none needed");
    }

    // ---------------------------------------------------------------
    // Reserved system module id
    // ---------------------------------------------------------------

    #[test]
    fn rejects_a_user_upload_claiming_the_system_module_id() {
        let json =
            format!(r#"{{"id": "{SYSTEM_MODULE_ID}", "name": "Impostor", "version": "1.0.0"}}"#);
        let m = parse(&json);
        let err = validate(&m)
            .expect_err("a user upload must not claim it")
            .to_string();
        assert!(
            err.contains(SYSTEM_MODULE_ID),
            "names the reserved id: {err}"
        );
        assert!(err.contains("reserved"), "{err}");
    }

    #[test]
    fn accepts_a_system_install_of_the_reserved_id() {
        let json =
            format!(r#"{{"id": "{SYSTEM_MODULE_ID}", "name": "woofx3", "version": "1.0.0"}}"#);
        let m = parse(&json);
        validate_with_provenance(&m, InstallProvenance::System).expect("system install is allowed");
    }

    // The match is exact. A prefix or substring test would deny ids nobody
    // reserved and that no bundled declaration will ever use.
    #[test]
    fn accepts_ordinary_ids_that_merely_contain_the_reserved_one() {
        for id in ["woofx3party", "my_woofx3", "woofx3_extras"] {
            let m = parse(&format!(
                r#"{{"id": "{id}", "name": "M", "version": "1.0.0"}}"#
            ));
            validate(&m).unwrap_or_else(|e| panic!("{id} should install: {e}"));
        }
    }

    // ---------------------------------------------------------------
    // Webhook triggers
    // ---------------------------------------------------------------

    const WEBHOOK_TRIGGER: &str =
        r#"{ "id": "orders", "name": "Orders", "type": "webhook", "handler": "handle_order" }"#;

    fn with_webhook_function(trigger: &str, extra: &str) -> ModuleManifest {
        minimal(&format!(
            r#", "triggers": [{trigger}],
            "functions": [{{ "id": "handle_order", "name": "Handle", "runtime": "js", "path": "h.js" }}]{extra}"#
        ))
    }

    fn rejection(trigger: &str, extra: &str) -> String {
        validate(&with_webhook_function(trigger, extra))
            .expect_err("manifest must be rejected")
            .to_string()
    }

    #[test]
    fn accepts_a_webhook_trigger_with_a_handler() {
        validate(&with_webhook_function(WEBHOOK_TRIGGER, "")).expect("validate ok");
    }

    #[test]
    fn rejects_a_webhook_trigger_without_a_handler() {
        let err = rejection(
            r#"{ "id": "orders", "name": "Orders", "type": "webhook" }"#,
            "",
        );
        assert!(err.contains("must name its `handler`"), "{err}");
    }

    #[test]
    fn rejects_a_handler_that_names_no_function() {
        let err = rejection(
            r#"{ "id": "orders", "name": "Orders", "type": "webhook", "handler": "missing" }"#,
            "",
        );
        assert!(err.contains(r#""missing""#), "names the handler: {err}");
    }

    #[test]
    fn rejects_a_handler_on_an_eventbus_trigger() {
        let err = rejection(
            r#"{ "id": "t1", "name": "T1", "type": "eventbus", "event": "store.order.created", "handler": "handle_order" }"#,
            "",
        );
        assert!(err.contains("only valid on"), "{err}");
    }

    #[test]
    fn rejects_bus_and_builder_fields_on_a_webhook_trigger() {
        for (field, json) in [
            ("`event`", r#""event": "store.order.created""#),
            (
                "`schema`",
                r#""schema": [{ "id": "a", "label": "A", "type": "text" }]"#,
            ),
            (
                "`emits`",
                r#""emits": { "fields": [{ "path": "a", "type": "string" }] }"#,
            ),
            ("`sentence`", r#""sentence": "An order arrives""#),
            ("`allowVariants`", r#""allowVariants": true"#),
        ] {
            let trigger = format!(
                r#"{{ "id": "orders", "name": "Orders", "type": "webhook", "handler": "handle_order", {json} }}"#
            );
            let err = rejection(&trigger, "");
            assert!(err.contains(field), "{field}: {err}");
        }
    }

    #[test]
    fn rejects_reserved_prefixes_on_bus_triggers() {
        for event in [
            "webhook.other_mod.orders",
            "db.module.trigger.registered",
            "engine.obs.command",
            "slobs",
            "twitchapi",
            "message.send",
            "ui.notify.alert",
            "ui.alert.broadcast",
            "widget.queue.skip",
            "workflow.execute",
            "workflow.replay",
            "workflow.cancel",
            "action.execute",
        ] {
            let trigger = format!(
                r#"{{ "id": "t1", "name": "T1", "type": "eventbus", "event": "{event}" }}"#
            );
            let err = rejection(&trigger, "");
            assert!(err.contains("reserved prefix"), "{event}: {err}");
        }
    }

    // A trigger with no `event` fires on its id, so the id is checked too.
    #[test]
    fn rejects_a_reserved_prefix_reached_through_the_id_fallback() {
        let err = rejection(
            r#"{ "id": "webhook.sneaky", "name": "T1", "type": "eventbus" }"#,
            "",
        );
        assert!(err.contains("reserved prefix"), "{err}");
    }

    fn action_with_field_source(event: &str, payload: &str) -> ModuleManifest {
        parse(&format!(
            r#"{{"id": "mod", "name": "Mod", "version": "1.0.0",
            "functions": [{{ "id": "f", "name": "F", "runtime": "js", "path": "f.js" }}],
            "actions": [{{ "id": "a", "name": "A", "type": "function", "function": "f",
                "schema": [{{ "id": "pick", "label": "Pick", "type": "select",
                    "source": {{ "kind": "internal", "request": {{ "event": "{event}", "payload": {payload} }} }} }}] }}]}}"#
        ))
    }

    #[test]
    fn rejects_an_upload_field_source_outside_the_form_allowlist() {
        for event in [
            "engine.obs.command",
            "engine.obs.options",
            "slobs",
            "message.send",
            "workflow.execute",
            "some.service.command",
        ] {
            let err = validate(&action_with_field_source(event, "{}"))
                .expect_err("an upload's forms may request only allowlisted subjects")
                .to_string();
            assert!(err.contains("may request only"), "{event}: {err}");
            assert!(err.contains("`source`"), "{event}: {err}");
        }
    }

    #[test]
    fn limits_an_upload_field_source_on_twitchapi_to_allowlisted_reads() {
        validate(&action_with_field_source(
            "twitchapi",
            r#"{ "command": "listChannelPointRewards" }"#,
        ))
        .expect("the twitch platform module's reward picker asks for this read");
        for payload in [
            r#"{ "command": "addChannelModerator" }"#,
            r#"{ "command": "listModerators" }"#,
            "{}",
        ] {
            let err = validate(&action_with_field_source("twitchapi", payload))
                .expect_err("only an allowlisted read is reachable from a form")
                .to_string();
            assert!(err.contains("listChannelPointRewards"), "{payload}: {err}");
        }
    }

    #[test]
    fn accepts_an_upload_field_source_on_its_own_function() {
        validate(&action_with_field_source(
            "barkloader.module.field_options",
            r#"{ "moduleId": "mod", "functionId": "f" }"#,
        ))
        .expect("a module's forms may run its own field-options function");
    }

    // The responder runs `{moduleId}:function:{functionId}` with that
    // module's permissions, so naming another module would borrow them.
    #[test]
    fn rejects_an_upload_field_source_on_another_modules_function() {
        for payload in [
            r#"{ "moduleId": "other_mod", "functionId": "f" }"#,
            r#"{ "functionId": "f" }"#,
        ] {
            let err = validate(&action_with_field_source(
                "barkloader.module.field_options",
                payload,
            ))
            .expect_err("a form must not run another module's function")
            .to_string();
            assert!(
                err.contains("its own module's functions"),
                "{payload}: {err}"
            );
            assert!(err.contains(r#"must be "mod""#), "{payload}: {err}");
        }
    }

    #[test]
    fn rejects_an_upload_field_source_on_an_undeclared_function() {
        let err = validate(&action_with_field_source(
            "barkloader.module.field_options",
            r#"{ "moduleId": "mod", "functionId": "missing" }"#,
        ))
        .expect_err("the field would never load")
        .to_string();
        assert!(err.contains("does not declare"), "{err}");
    }

    #[test]
    fn rejects_an_internal_upload_source_without_a_subject() {
        let err = validate(&action_with_field_source_descriptor(
            r#"{ "kind": "internal" }"#,
        ))
        .expect_err("an internal source names the subject it requests")
        .to_string();
        assert!(err.contains("`request.event`"), "{err}");
    }

    #[test]
    fn ignores_sources_the_api_does_not_send_as_requests() {
        validate(&action_with_field_source_descriptor(
            r#"{ "kind": "commands" }"#,
        ))
        .expect("a commands source resolves in the UI, not on the bus");
    }

    fn action_with_field_source_descriptor(descriptor: &str) -> ModuleManifest {
        parse(&format!(
            r#"{{"id": "mod", "name": "Mod", "version": "1.0.0",
            "actions": [{{ "id": "a", "name": "A", "type": "function", "function": "f",
                "schema": [{{ "id": "pick", "label": "Pick", "type": "select", "source": {descriptor} }}] }}],
            "functions": [{{ "id": "f", "name": "F", "runtime": "js", "path": "f.js" }}]}}"#
        ))
    }

    fn action_with_list_row(row_field: &str) -> ModuleManifest {
        parse(&format!(
            r#"{{"id": "mod", "name": "Mod", "version": "1.0.0",
            "functions": [{{ "id": "f", "name": "F", "runtime": "js", "path": "f.js" }}],
            "actions": [{{ "id": "a", "name": "A", "type": "function", "function": "f",
                "schema": [{{ "id": "rows", "label": "Rows", "type": "list",
                    "itemFields": [{row_field}] }}] }}]}}"#
        ))
    }

    // The api and the UI resolve sources only on top-level fields, so a
    // request in a list row would install and then never load. This holds for
    // the system module too, and for a request that would pass on its own.
    #[test]
    fn rejects_an_internal_source_inside_a_list_row() {
        let m = action_with_list_row(
            r#"{ "id": "pick", "label": "Pick", "type": "select",
                "source": { "kind": "internal", "request": {
                    "event": "barkloader.module.field_options",
                    "payload": { "moduleId": "mod", "functionId": "f" } } } }"#,
        );
        let err = validate(&m)
            .expect_err("a nested source is not resolved")
            .to_string();
        assert!(
            err.contains("internal sources are only supported on top-level fields"),
            "{err}"
        );
        assert!(
            err.contains("`itemFields` field #0 (pick): `source`"),
            "{err}"
        );

        let mut system = m.clone();
        system.id = SYSTEM_MODULE_ID.to_string();
        let err = validate_with_provenance(&system, InstallProvenance::System)
            .expect_err("the system module's rows are resolved the same way")
            .to_string();
        assert!(err.contains("only supported on top-level fields"), "{err}");
    }

    #[test]
    fn accepts_a_list_row_with_a_ui_resolved_source() {
        validate(&action_with_list_row(
            r#"{ "id": "cmd", "label": "Command", "type": "select", "source": { "kind": "commands" } }"#,
        ))
        .expect("only bus requests are limited to top-level fields");
    }

    #[test]
    fn rejects_an_upload_settings_button_on_a_command_subject() {
        let m = parse(
            r#"{"id": "mod", "name": "Mod", "version": "1.0.0",
            "settings": [{ "id": "go", "label": "Go", "type": "button",
                "action": { "kind": "internal", "request": { "event": "engine.obs.command" } } }]}"#,
        );
        let err = validate(&m)
            .expect_err("a button is a form request too")
            .to_string();
        assert!(err.contains("setting #0 (go): `action`"), "{err}");
    }

    #[test]
    fn the_system_modules_forms_may_read_engine_subjects() {
        let mut m = action_with_field_source("engine.obs.options", r#"{ "list": "scenes" }"#);
        m.id = SYSTEM_MODULE_ID.to_string();
        validate_with_provenance(&m, InstallProvenance::System)
            .expect("the system module's forms may read engine subjects");
    }

    fn system_module_with_trigger_event(event: &str) -> ModuleManifest {
        parse(&format!(
            r#"{{"id": "{SYSTEM_MODULE_ID}", "name": "woofx3", "version": "1.0.0",
            "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus", "event": "{event}" }}]}}"#
        ))
    }

    #[test]
    fn accepts_an_outbox_trigger_from_the_system_module() {
        let m = system_module_with_trigger_event("db.workflow.created.*");
        validate_with_provenance(&m, InstallProvenance::System)
            .expect("the system module binds the outbox");
    }

    #[test]
    fn rejects_the_webhook_prefix_even_from_the_system_module() {
        let m = system_module_with_trigger_event("webhook.other_mod.orders");
        let err = validate_with_provenance(&m, InstallProvenance::System)
            .expect_err("a webhook event is fired by its handler, never the bus")
            .to_string();
        assert!(err.contains("reserved prefix"), "{err}");
    }

    // ---------------------------------------------------------------
    // Widget surfaces
    // ---------------------------------------------------------------

    const ALERT_WIDGET: &str =
        r#"{ "id": "alert", "name": "Alert", "surfaces": ["scene"], "hostsSurface": "alert" }"#;

    fn widget_rejection(widget: &str) -> String {
        validate(&minimal(&format!(r#", "widgets": [{widget}]"#)))
            .expect_err("manifest must be rejected")
            .to_string()
    }

    fn system_module_with_widget(widget: &str) -> ModuleManifest {
        parse(&format!(
            r#"{{"id": "{SYSTEM_MODULE_ID}", "name": "woofx3", "version": "1.0.0", "widgets": [{widget}]}}"#
        ))
    }

    #[test]
    fn a_widget_without_surfaces_is_a_scene_widget() {
        let m = minimal(r#", "widgets": [{ "id": "w1", "name": "W1" }]"#);
        assert_eq!(m.widgets[0].surfaces, vec!["scene"]);
        validate(&m).expect("validate ok");
    }

    #[test]
    fn accepts_a_widget_placed_on_scenes_and_alerts() {
        let m = minimal(
            r#", "widgets": [{ "id": "w1", "name": "W1", "surfaces": ["scene", "alert"] }]"#,
        );
        validate(&m).expect("validate ok");
    }

    #[test]
    fn rejects_unknown_empty_or_repeated_surfaces() {
        for surfaces in [r#"["overlay"]"#, "[]", r#"["alert", "alert"]"#] {
            let err = widget_rejection(&format!(
                r#"{{ "id": "w1", "name": "W1", "surfaces": {surfaces} }}"#
            ));
            assert!(err.contains("`surfaces`"), "{surfaces}: {err}");
        }
    }

    #[test]
    fn accepts_the_system_alert_widget() {
        validate_with_provenance(
            &system_module_with_widget(ALERT_WIDGET),
            InstallProvenance::System,
        )
        .expect("the system module declares the alert widget");
    }

    #[test]
    fn rejects_a_hosting_widget_from_an_upload() {
        let err = widget_rejection(ALERT_WIDGET);
        assert!(err.contains("`hostsSurface`"), "{err}");
    }

    #[test]
    fn rejects_a_hosting_widget_placed_on_what_it_hosts_or_carrying_an_entry() {
        for widget in [
            r#"{ "id": "alert", "name": "Alert", "surfaces": ["scene", "alert"], "hostsSurface": "alert" }"#,
            r#"{ "id": "alert", "name": "Alert", "hostsSurface": "alert", "entry": "w/index.html", "assets": "w" }"#,
        ] {
            let result = validate_with_provenance(
                &system_module_with_widget(widget),
                InstallProvenance::System,
            );
            assert!(result.is_err(), "{widget} must be rejected");
        }
    }

    #[test]
    fn a_layout_field_names_its_surface() {
        let with_layout = |surface: &str| {
            minimal(&format!(
                r#", "actions": [{{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "schema": [{{ "id": "layout", "label": "Layout", "type": "layout"{surface} }}] }}],
                "functions": [{{ "id": "f1", "name": "F1", "runtime": "js", "path": "f.js" }}]"#
            ))
        };
        validate(&with_layout(r#", "surface": "alert""#)).expect("validate ok");
        let err = validate(&with_layout(""))
            .expect_err("a layout without a surface")
            .to_string();
        assert!(err.contains("`layout` needs a `surface`"), "{err}");
    }

    #[test]
    fn rejects_a_workflow_bound_to_a_webhook_trigger() {
        for trigger_ref in ["orders", "webhook.test_mod.orders"] {
            let extra = format!(
                r#", "actions": [{{ "id": "a1", "name": "A1", "type": "function", "function": "handle_order" }}],
                "workflows": [{{ "id": "wf", "name": "WF", "trigger": "{trigger_ref}", "steps": [{{ "action": "a1" }}] }}]"#
            );
            let err = rejection(WEBHOOK_TRIGGER, &extra);
            assert!(
                err.contains("cannot bind to a webhook trigger"),
                "{trigger_ref}: {err}"
            );
        }
    }

    // ---------------------------------------------------------------
    // Secret settings
    // ---------------------------------------------------------------

    #[test]
    fn accepts_a_secret_setting() {
        let m = minimal(
            r#", "settings": [{ "id": "webhookSecret", "label": "Webhook secret", "type": "secret" }]"#,
        );
        validate(&m).expect("validate ok");
    }

    #[test]
    fn rejects_a_default_value_on_a_secret_setting() {
        let m = minimal(
            r#", "settings": [{ "id": "webhookSecret", "label": "Webhook secret", "type": "secret", "defaultValue": "shipped" }]"#,
        );
        let err = validate(&m).expect_err("must be rejected").to_string();
        assert!(err.contains("defaultValue"), "{err}");
    }

    #[test]
    fn rejects_secret_as_a_trigger_field_type() {
        let m = minimal(
            r#", "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "a.b",
                "schema": [{ "id": "token", "label": "Token", "type": "secret" }] }]"#,
        );
        validate(&m).expect_err("secret is a settings-only type");
    }

    // ---------------------------------------------------------------
    // Field declarations: schema / settingsSchema / settings
    // ---------------------------------------------------------------

    #[test]
    fn accepts_the_canonical_field_list_on_every_surface() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "minBits", "label": "Minimum bits", "type": "number", "min": 1 }] }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "schema": [{ "id": "target", "label": "Counter", "type": "resource_ref", "resourceKind": "counter" }] }],
            "widgets": [{ "id": "w1", "name": "W1",
                "settingsSchema": [{ "id": "fontSize", "label": "Font size", "type": "number" }] }],
            "settings": [{ "id": "clientId", "label": "Client ID", "type": "text" }]"#,
        );
        validate(&m).expect("validate ok");
    }

    // The counter widget declared five settings this way and rendered none:
    // the object container is what trigger schemas accept, the widget parser
    // took only a bare array, and nothing said so.
    #[test]
    fn rejects_the_object_container_that_silently_dropped_widget_settings() {
        let json = r#"{
            "id": "test_mod", "name": "Test Mod", "version": "1.0.0",
            "widgets": [{ "id": "w1", "name": "W1", "settingsSchema": {
                "fields": [{ "id": "fontSize", "label": "Font size", "type": "number" }] } }]
        }"#;
        serde_json::from_str::<ModuleManifest>(json).expect_err("object container must not parse");
    }

    #[test]
    fn rejects_the_widget_key_and_field_type_spellings() {
        let json = r#"{
            "id": "test_mod", "name": "Test Mod", "version": "1.0.0",
            "widgets": [{ "id": "w1", "name": "W1", "settingsSchema": [
                { "key": "fontSize", "fieldType": "number", "label": "Font size" }] }]
        }"#;
        serde_json::from_str::<ModuleManifest>(json).expect_err("key/fieldType must not parse");
    }

    #[test]
    fn rejects_the_setting_name_and_default_spellings() {
        let json = r#"{
            "id": "test_mod", "name": "Test Mod", "version": "1.0.0",
            "settings": [{ "id": "s1", "name": "S1", "type": "text", "default": "x" }]
        }"#;
        serde_json::from_str::<ModuleManifest>(json).expect_err("name/default must not parse");
    }

    // deny_unknown_fields earns its keep on typos, not just renames.
    #[test]
    fn rejects_a_misspelled_field_property() {
        let json = r#"{
            "id": "test_mod", "name": "Test Mod", "version": "1.0.0",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": "A", "type": "text", "requried": true }] }]
        }"#;
        serde_json::from_str::<ModuleManifest>(json).expect_err("typo must not parse");
    }

    #[test]
    fn rejects_an_unknown_field_type_token() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": "A", "type": "string" }] }]"#,
        );
        let err = validate(&m).expect_err("string is not a control type");
        let msg = err.to_string();
        assert!(msg.contains("trigger #0 (t1)"), "names the surface: {msg}");
        assert!(msg.contains("text"), "lists the accepted tokens: {msg}");
    }

    #[test]
    fn rejects_duplicate_field_ids() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [
                    { "id": "a", "label": "A", "type": "text" },
                    { "id": "a", "label": "Again", "type": "number" }
                ] }]"#,
        );
        assert!(
            validate(&m)
                .expect_err("duplicate id")
                .to_string()
                .contains("duplicate")
        );
    }

    // A select with nothing to select and a resource picker that does not say
    // what to pick both render a dead control. Cheap here, confusing in a form.
    #[test]
    fn rejects_a_select_with_no_options_and_no_source() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": "A", "type": "select" }] }]"#,
        );
        assert!(
            validate(&m)
                .expect_err("dead select")
                .to_string()
                .contains("options")
        );
    }

    #[test]
    fn accepts_a_select_backed_by_a_dynamic_source() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": "A", "type": "select",
                    "source": { "kind": "commands" } }] }]"#,
        );
        validate(&m).expect("a source supplies the options at render time");
    }

    #[test]
    fn rejects_a_resource_ref_without_a_resource_kind() {
        let m = minimal(
            r#",
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "schema": [{ "id": "t", "label": "T", "type": "resource_ref" }] }]"#,
        );
        let err = validate(&m).expect_err("picker with nothing to pick");
        assert!(err.to_string().contains("resourceKind"), "{err}");
    }

    fn resource_with_field(field: &str) -> ModuleManifest {
        minimal(&format!(
            r#",
            "resources": [{{ "kind": "counter", "name": "Counter", "schema": [{field}] }}]"#
        ))
    }

    #[test]
    fn accepts_a_list_of_plain_rows() {
        let m = resource_with_field(
            r#"{ "id": "goals", "label": "Goals", "type": "list", "itemFields": [
                { "id": "value", "label": "Goal", "type": "number", "required": true },
                { "id": "name", "label": "Name", "type": "text" }
            ] }"#,
        );
        validate(&m).expect("a list of number and text rows is valid");
    }

    #[test]
    fn rejects_a_list_that_does_not_say_what_a_row_holds() {
        let missing = resource_with_field(r#"{ "id": "goals", "label": "Goals", "type": "list" }"#);
        let err = validate(&missing).expect_err("list with no rows declared");
        assert!(
            err.to_string().contains("`list` needs `itemFields`"),
            "{err}"
        );

        let empty = resource_with_field(
            r#"{ "id": "goals", "label": "Goals", "type": "list", "itemFields": [] }"#,
        );
        let err = validate(&empty).expect_err("list with an empty row");
        assert!(err.to_string().contains("at least one field"), "{err}");
    }

    #[test]
    fn rejects_item_fields_on_anything_but_a_list() {
        let m = resource_with_field(
            r#"{ "id": "goals", "label": "Goals", "type": "text", "itemFields": [
                { "id": "value", "label": "Goal", "type": "number" }
            ] }"#,
        );
        let err = validate(&m).expect_err("itemFields on a text field");
        assert!(err.to_string().contains("only a `list`"), "{err}");
    }

    #[test]
    fn rejects_a_row_field_that_does_not_fit_in_a_row() {
        let nested = resource_with_field(
            r#"{ "id": "goals", "label": "Goals", "type": "list", "itemFields": [
                { "id": "inner", "label": "Inner", "type": "list", "itemFields": [
                    { "id": "v", "label": "V", "type": "number" }
                ] }
            ] }"#,
        );
        let err = validate(&nested).expect_err("a list inside a list");
        assert!(err.to_string().contains("a list row takes only"), "{err}");
    }

    #[test]
    fn validates_row_fields_like_any_other_field_list() {
        let m = resource_with_field(
            r#"{ "id": "goals", "label": "Goals", "type": "list", "itemFields": [
                { "id": "value", "label": "Goal", "type": "number" },
                { "id": "value", "label": "Again", "type": "text" }
            ] }"#,
        );
        let err = validate(&m).expect_err("duplicate row field id");
        assert!(err.to_string().contains("duplicate"), "{err}");
    }

    #[test]
    fn rejects_a_list_module_setting() {
        let m = minimal(r#", "settings": [{ "id": "goals", "label": "Goals", "type": "list" }]"#);
        let err = validate(&m).expect_err("a list setting");
        assert!(err.to_string().contains("cannot be a `list`"), "{err}");
    }

    #[test]
    fn accepts_a_resource_ref_setting_that_links_an_instance_at_install() {
        let m = minimal(
            r#", "settings": [{ "id": "timer", "label": "Timer", "type": "resource_ref",
                "resourceKind": "timer",
                "create": { "instanceId": "subathon", "displayName": "Subathon", "settings": { "duration": 60 } } }]"#,
        );
        validate(&m).expect("a linking resource_ref setting");
    }

    #[test]
    fn rejects_a_resource_ref_setting_without_a_kind() {
        let m = minimal(r#", "settings": [{ "id": "timer", "label": "Timer", "type": "resource_ref" }]"#);
        assert!(bad_err(&m).contains("`resource_ref` needs `resourceKind`"));
    }

    #[test]
    fn rejects_resource_kind_and_create_on_any_other_setting() {
        let kind = minimal(r#", "settings": [{ "id": "n", "label": "N", "type": "text", "resourceKind": "timer" }]"#);
        assert!(bad_err(&kind).contains("`resourceKind` is only for a `resource_ref` setting"));
        let create = minimal(
            r#", "settings": [{ "id": "n", "label": "N", "type": "text",
                "create": { "instanceId": "x", "displayName": "X" } }]"#,
        );
        assert!(bad_err(&create).contains("`create` is only for a `resource_ref` setting"));
    }

    #[test]
    fn rejects_a_default_value_on_a_resource_ref_setting() {
        let m = minimal(
            r#", "settings": [{ "id": "timer", "label": "Timer", "type": "resource_ref",
                "resourceKind": "timer", "defaultValue": "woofx3:timer:x" }]"#,
        );
        assert!(bad_err(&m).contains("cannot declare `defaultValue`"));
    }

    #[test]
    fn rejects_a_malformed_create() {
        let id = minimal(
            r#", "settings": [{ "id": "timer", "label": "Timer", "type": "resource_ref",
                "resourceKind": "timer", "create": { "instanceId": "a:b", "displayName": "X" } }]"#,
        );
        assert!(bad_err(&id).contains("`create.instanceId`"));
        let settings = minimal(
            r#", "settings": [{ "id": "timer", "label": "Timer", "type": "resource_ref",
                "resourceKind": "timer", "create": { "instanceId": "x", "displayName": "X", "settings": 5 } }]"#,
        );
        assert!(bad_err(&settings).contains("`create.settings` must be an object"));
    }

    #[tokio::test]
    async fn plans_the_link_after_settings_are_registered() {
        let m = minimal(
            r#", "settings": [{ "id": "timer", "label": "Timer", "type": "resource_ref",
                "resourceKind": "timer", "create": { "instanceId": "x", "displayName": "X" } }]"#,
        );
        let resolved = validate(&m).expect("validate");
        let db = super::super::db_proxy_client::FakeDbProxyClient::new();
        let plan = build_install_plan(&m, &resolved, &db).await.expect("plan");
        let settings = plan.iter().position(|s| *s == InstallStep::RegisterSettings).expect("settings step");
        let link = plan.iter().position(|s| *s == InstallStep::LinkResourceSettings).expect("link step");
        assert!(settings < link, "{plan:?}");
    }

    #[test]
    fn validates_a_resource_kind_create_form_like_every_other_surface() {
        let ok = minimal(
            r#",
            "resources": [{ "kind": "counter", "name": "Counter",
                "schema": [{ "id": "initialValue", "label": "Initial value", "type": "number" }] }]"#,
        );
        validate(&ok).expect("validate ok");

        let bad = minimal(
            r#",
            "resources": [{ "kind": "counter", "name": "Counter",
                "schema": [{ "id": "initialValue", "label": "Initial value", "type": "integer" }] }]"#,
        );
        let err = bad_err(&bad);
        assert!(
            err.contains("resource #0 (counter)"),
            "names the surface: {err}"
        );
        assert!(err.contains("`schema`"), "{err}");
    }

    fn bad_err(m: &ModuleManifest) -> String {
        validate(m)
            .expect_err("expected a validation failure")
            .to_string()
    }

    #[test]
    fn rejects_a_button_setting_with_no_action() {
        let m = minimal(
            r#",
            "settings": [{ "id": "s1", "label": "S1", "type": "button" }]"#,
        );
        assert!(
            validate(&m)
                .expect_err("button with no action")
                .to_string()
                .contains("action")
        );
    }

    #[test]
    fn rejects_an_empty_field_id_and_an_empty_label() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "  ", "label": "A", "type": "text" }] }]"#,
        );
        assert!(
            validate(&m)
                .expect_err("blank id")
                .to_string()
                .contains("`id`")
        );

        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": " ", "type": "text" }] }]"#,
        );
        assert!(
            validate(&m)
                .expect_err("blank label")
                .to_string()
                .contains("`label`")
        );
    }

    // ---------------------------------------------------------------
    // Data shapes: `emits` on triggers, `returns` on actions
    // ---------------------------------------------------------------

    #[test]
    fn accepts_a_well_formed_emits_and_returns() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [
                    { "path": "bits", "type": "number", "description": "Bits cheered.", "example": 1000 },
                    { "path": "channel.title", "type": "string" }
                ] } }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "returns": { "fields": [{ "path": "next", "type": "number" }] } }]"#,
        );
        validate(&m).expect("validate ok");
    }

    #[test]
    fn accepts_a_manifest_declaring_no_shapes_at_all() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }]"#,
        );
        validate(&m).expect("validate ok");
    }

    #[test]
    fn rejects_an_empty_path_in_emits() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [{ "path": "  ", "type": "string" }] } }]"#,
        );
        let err = validate(&m).expect_err("empty path must fail");
        let msg = err.to_string();
        assert!(
            msg.contains("trigger #0 (t1)"),
            "names the offending trigger: {msg}"
        );
        assert!(msg.contains("`emits`"), "names the offending field: {msg}");
        assert!(msg.contains("path"), "{msg}");
    }

    #[test]
    fn rejects_an_unknown_field_type() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [{ "path": "bits", "type": "integer" }] } }]"#,
        );
        let err = validate(&m).expect_err("unknown type must fail");
        let msg = err.to_string();
        // The accepted set is quoted back so the author does not have to go
        // find the docs to learn "integer" should have been "number".
        assert!(msg.contains("integer"), "{msg}");
        assert!(msg.contains("number"), "lists the accepted tokens: {msg}");
    }

    // A path is a variable's identity, so a duplicate is either redundant or
    // contradictory and nothing can tell which. Rejecting beats picking one.
    #[test]
    fn rejects_duplicate_paths_within_one_shape() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [
                    { "path": "bits", "type": "number" },
                    { "path": "bits", "type": "string" }
                ] } }]"#,
        );
        let err = validate(&m).expect_err("duplicate path must fail");
        assert!(err.to_string().contains("duplicate"), "{}", err);
    }

    #[test]
    fn rejects_a_bad_returns_on_an_action() {
        let m = minimal(
            r#",
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "returns": { "fields": [{ "path": "next", "type": "int" }] } }]"#,
        );
        let err = validate(&m).expect_err("unknown type must fail");
        let msg = err.to_string();
        assert!(
            msg.contains("action #0 (a1)"),
            "names the offending action: {msg}"
        );
        assert!(msg.contains("`returns`"), "{msg}");
    }

    // Structure is serde's job; this pins that a malformed shape fails at
    // parse rather than reaching validation as something half-built.
    #[test]
    fn a_non_list_fields_value_fails_to_parse() {
        let json = r#"{
            "id": "test_mod", "name": "Test Mod", "version": "1.0.0",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": "oops" } }]
        }"#;
        serde_json::from_str::<ModuleManifest>(json).expect_err("must not parse");
    }

    #[test]
    fn a_field_missing_its_type_fails_to_parse() {
        let json = r#"{
            "id": "test_mod", "name": "Test Mod", "version": "1.0.0",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [{ "path": "bits" }] } }]
        }"#;
        serde_json::from_str::<ModuleManifest>(json).expect_err("must not parse");
    }

    // ---------------------------------------------------------------
    // Trigger sentences and the per-field wording they render
    // ---------------------------------------------------------------

    fn trigger_with_sentence(sentence: &str) -> ModuleManifest {
        minimal(&format!(
            r#",
            "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus",
                "sentence": {sentence},
                "schema": [
                    {{ "id": "reward", "label": "Reward", "type": "text" }},
                    {{ "id": "tier", "label": "Tier", "type": "text" }}
                ] }}]"#
        ))
    }

    fn sentence_rejection(sentence: &str) -> String {
        let msg = bad_err(&trigger_with_sentence(sentence));
        assert!(msg.contains("trigger #0 (t1)"), "names the trigger: {msg}");
        assert!(msg.contains("`sentence`"), "names the field: {msg}");
        msg
    }

    #[test]
    fn accepts_a_sentence_naming_declared_fields() {
        validate(&trigger_with_sentence(
            r#""{reward} is redeemed at {tier}""#,
        ))
        .expect("validate ok");
    }

    #[test]
    fn accepts_a_sentence_with_no_placeholders() {
        validate(&trigger_with_sentence(r#""Someone follows""#)).expect("validate ok");
    }

    #[test]
    fn rejects_an_empty_sentence() {
        let msg = sentence_rejection(r#""   ""#);
        assert!(msg.contains("non-empty"), "{msg}");
    }

    #[test]
    fn rejects_unbalanced_or_nested_braces() {
        for (sentence, reason) in [
            (r#""{reward is redeemed""#, "unclosed"),
            (r#""reward} is redeemed""#, "unmatched"),
            (r#""{re{ward}} is redeemed""#, "nested"),
            (r#""{} is redeemed""#, "empty placeholder"),
        ] {
            let msg = sentence_rejection(sentence);
            assert!(msg.contains(reason), "{sentence}: {msg}");
        }
    }

    #[test]
    fn rejects_a_placeholder_naming_no_field() {
        let msg = sentence_rejection(r#""{bits} are cheered""#);
        assert!(msg.contains("{bits}"), "names the placeholder: {msg}");
    }

    #[test]
    fn rejects_a_placeholder_on_a_trigger_with_no_schema() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "sentence": "{reward} is redeemed" }]"#,
        );
        let msg = bad_err(&m);
        assert!(msg.contains("trigger #0 (t1)"), "{msg}");
        assert!(msg.contains("{reward}"), "{msg}");
    }

    fn trigger_field(wording: &str) -> ModuleManifest {
        minimal(&format!(
            r#",
            "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{{ "id": "tier", "label": "Tier", "type": "text", {wording} }}] }}]"#
        ))
    }

    #[test]
    fn accepts_field_wording() {
        validate(&trigger_field(
            r#""anyText": "any tier", "missingText": "a tier""#,
        ))
        .expect("validate ok");
    }

    // An empty anyText is how an author says "leave this part out".
    #[test]
    fn accepts_an_empty_any_text() {
        validate(&trigger_field(r#""anyText": """#)).expect("validate ok");
    }

    #[test]
    fn rejects_a_whitespace_any_text() {
        let msg = bad_err(&trigger_field(r#""anyText": "  ""#));
        assert!(msg.contains("trigger #0 (t1)"), "{msg}");
        assert!(msg.contains("`anyText`"), "{msg}");
    }

    #[test]
    fn rejects_an_empty_missing_text() {
        let msg = bad_err(&trigger_field(r#""missingText": " ""#));
        assert!(msg.contains("trigger #0 (t1)"), "{msg}");
        assert!(msg.contains("`missingText`"), "{msg}");
    }

    fn number_trigger_field(comparison: &str) -> ModuleManifest {
        minimal(&format!(
            r#",
            "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{{ "id": "amount", "label": "Bits", "type": "number",
                    "eventPath": "amount", {comparison} }}] }}]"#
        ))
    }

    #[test]
    fn accepts_a_choice_of_comparisons() {
        validate(&number_trigger_field(
            r#""operator": "gte", "operators": ["gte", "eq"]"#,
        ))
        .expect("validate ok");
    }

    #[test]
    fn rejects_operators_on_a_field_that_is_not_a_number() {
        let msg = bad_err(&trigger_field(
            r#""operator": "eq", "operators": ["eq", "ne"]"#,
        ));
        assert!(msg.contains("trigger #0 (t1)"), "{msg}");
        assert!(msg.contains("only allowed on a `number`"), "{msg}");
    }

    #[test]
    fn rejects_operators_offering_one_comparison() {
        let msg = bad_err(&number_trigger_field(
            r#""operator": "gte", "operators": ["gte"]"#,
        ));
        assert!(msg.contains("at least two"), "{msg}");
    }

    #[test]
    fn rejects_an_operator_that_cannot_compare_amounts() {
        let msg = bad_err(&number_trigger_field(
            r#""operator": "gte", "operators": ["gte", "contains"]"#,
        ));
        assert!(msg.contains("\"contains\""), "{msg}");
    }

    #[test]
    fn rejects_a_repeated_operator() {
        let msg = bad_err(&number_trigger_field(
            r#""operator": "gte", "operators": ["gte", "eq", "gte"]"#,
        ));
        assert!(msg.contains("twice"), "{msg}");
    }

    #[test]
    fn rejects_operators_without_a_default() {
        let msg = bad_err(&number_trigger_field(r#""operators": ["gte", "eq"]"#));
        assert!(msg.contains("needs an `operator`"), "{msg}");
    }

    #[test]
    fn rejects_a_default_outside_the_choices() {
        let msg = bad_err(&number_trigger_field(
            r#""operator": "lte", "operators": ["gte", "eq"]"#,
        ));
        assert!(msg.contains("must be one of `operators`"), "{msg}");
    }

    // ---------------------------------------------------------------
    // Install plan: graph construction, ordering, validation
    // ---------------------------------------------------------------

    use super::super::db_proxy_client::FakeDbProxyClient;

    #[tokio::test]
    async fn build_install_plan_orders_uploads_before_create_module_before_registration() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [{ "action": "a1" }] }],
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix", "workflow": "w1" }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();
        let plan = build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect("plan ok");

        let workflow_step =
            InstallStep::RegisterWorkflow(resolved.workflows[0].canonical_id.clone());
        let command_step = InstallStep::RegisterCommand(resolved.commands[0].canonical_id.clone());
        let pos = |step: &InstallStep| {
            plan.iter()
                .position(|s| s == step)
                .unwrap_or_else(|| panic!("{step:?} missing from plan: {plan:?}"))
        };

        assert!(pos(&InstallStep::UploadFunctionFiles) < pos(&InstallStep::CreateModule));
        assert!(pos(&InstallStep::CreateModule) < pos(&InstallStep::RegisterTriggers));
        assert!(pos(&InstallStep::CreateModule) < pos(&InstallStep::RegisterActions));
        assert!(pos(&InstallStep::CreateModule) < pos(&workflow_step));
        // The whole reason this is a real dependency graph edge and not
        // just phase ordering: a command referencing a workflow must
        // come after that workflow, specifically.
        assert!(pos(&workflow_step) < pos(&command_step));
    }

    #[tokio::test]
    async fn build_install_plan_omits_bulk_steps_for_empty_or_button_only_kinds() {
        let m = minimal(
            r#",
            "settings": [{ "id": "s1", "label": "S1", "type": "button", "action": { "kind": "integration", "integration": "x" } }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();
        let plan = build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect("plan ok");

        assert!(!plan.contains(&InstallStep::RegisterWidgets));
        assert!(!plan.contains(&InstallStep::RegisterBackgroundTasks));
        assert!(!plan.contains(&InstallStep::RegisterAssets));
        assert!(
            !plan.contains(&InstallStep::RegisterSettings),
            "a button-only settings list has nothing to store, same as today's filtered empty check"
        );
        // Triggers/actions register unconditionally today, even empty.
        assert!(plan.contains(&InstallStep::RegisterTriggers));
        assert!(plan.contains(&InstallStep::RegisterActions));
    }

    #[tokio::test]
    async fn build_install_plan_includes_bulk_steps_when_kinds_are_present() {
        let m = minimal(
            r#",
            "widgets": [{ "id": "w1", "name": "W1" }],
            "backgroundTasks": [{ "id": "bg1", "function": "f1", "schedule": "* * * * * *" }],
            "settings": [{ "id": "s1", "label": "S1", "type": "text" }],
            "assets": [{ "id": "a1", "name": "A1", "path": "assets/a.png" }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();
        let plan = build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect("plan ok");

        assert!(plan.contains(&InstallStep::RegisterWidgets));
        assert!(plan.contains(&InstallStep::RegisterBackgroundTasks));
        assert!(plan.contains(&InstallStep::RegisterSettings));
        assert!(plan.contains(&InstallStep::RegisterAssets));
    }

    #[tokio::test]
    async fn build_install_plan_fails_fast_on_unresolvable_cross_module_trigger() {
        let m = minimal(
            r#",
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "other_mod:trigger:missing", "steps": [] }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::failing_on(["get_trigger_event_by_canonical_id"]);

        let err = build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect_err("should fail");
        assert!(
            err.to_string()
                .contains("depends on resources from other modules that are not installed"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn build_install_plan_passes_when_cross_module_trigger_resolves() {
        let m = minimal(
            r#",
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "other_mod:trigger:exists", "steps": [] }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();

        let plan = build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect("should resolve via the fake");
        let workflow_step =
            InstallStep::RegisterWorkflow(resolved.workflows[0].canonical_id.clone());
        assert!(plan.contains(&workflow_step));
    }

    // ---------------------------------------------------------------
    // No namespace is exempt from the existence check. `builtin` was,
    // which is how `builtin:trigger:*` ids that matched no registered
    // trigger installed cleanly and then silently dropped every alert.
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn a_retired_builtin_reference_is_rejected() {
        let m = minimal(
            r#",
            "workflows": [{
                "id": "w1", "name": "W1", "trigger": "t1",
                "steps": [{ "id": "s1", "action": "builtin:action:alert" }]
            }],
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "chat.command.x" }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::failing_on(["get_action_ref_by_canonical_id"]);

        let err = build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect_err("should fail");
        assert!(
            err.to_string().contains("builtin:action:alert"),
            "the error must name the unresolved id: {err}"
        );
    }

    #[tokio::test]
    async fn an_unresolvable_bundled_reference_is_rejected() {
        let m = minimal(
            r#",
            "workflows": [{
                "id": "w1", "name": "W1", "trigger": "t1",
                "steps": [{ "id": "s1", "action": "woofx3:action:doesnotexist" }]
            }],
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "chat.command.x" }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::failing_on(["get_action_ref_by_canonical_id"]);

        let err = build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect_err("should fail");
        assert!(
            err.to_string().contains("woofx3:action:doesnotexist"),
            "the error must name the unresolved id: {err}"
        );
    }

    /// The bundled module gets no exemption of its own -- it is installed
    /// before any upload, so its ids resolve through the ordinary check.
    #[tokio::test]
    async fn a_real_bundled_reference_installs() {
        let m = minimal(
            r#",
            "workflows": [{
                "id": "w1", "name": "W1", "trigger": "t1",
                "steps": [{ "id": "s1", "action": "woofx3:action:alert" }]
            }],
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "chat.command.x" }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_module("woofx3", &[])]);

        let plan = build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect("a resolvable bundled reference installs");
        let workflow_step =
            InstallStep::RegisterWorkflow(resolved.workflows[0].canonical_id.clone());
        assert!(plan.contains(&workflow_step));
    }

    // ---------------------------------------------------------------
    // systemOnly: an action a system module reserves for itself.
    // ---------------------------------------------------------------

    fn reserved_actions() -> SystemOnlyActions {
        let bundled = parse(
            r#"{
                "id": "woofx3", "name": "woofx3", "version": "1.0.0",
                "actions": [
                    { "id": "restricted", "name": "Restricted", "type": "native", "handler": "restricted", "systemOnly": true },
                    { "id": "open", "name": "Open", "type": "native", "handler": "open" }
                ]
            }"#,
        );
        SystemOnlyActions::from_manifests([&bundled]).expect("system-only set")
    }

    fn uploaded_using(action: &str) -> ResolvedManifest {
        let m = minimal(&format!(
            r#",
            "workflows": [{{
                "id": "w1", "name": "W1", "trigger": "t1",
                "steps": [{{ "id": "s1", "action": "{action}" }}]
            }}],
            "commands": [{{ "id": "c1", "name": "C1", "pattern": "!x", "type": "prefix", "actions": [{{ "action": "woofx3:action:open" }}] }}],
            "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus", "event": "chat.command.x" }}]"#
        ));
        validate(&m).expect("validate ok")
    }

    #[test]
    fn an_upload_cannot_reference_a_system_only_action() {
        let resolved = uploaded_using("woofx3:action:restricted");
        let err =
            refuse_system_only_references(&resolved, InstallProvenance::User, &reserved_actions())
                .expect_err("a reserved action must be refused");
        let msg = err.to_string();
        assert!(
            msg.contains("woofx3:action:restricted") && msg.contains("reserved for system modules"),
            "got: {msg}"
        );
    }

    #[test]
    fn a_command_cannot_reference_a_system_only_action_either() {
        let m = minimal(
            r#",
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!x", "type": "prefix", "actions": [{ "action": "woofx3:action:restricted" }] }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let err =
            refuse_system_only_references(&resolved, InstallProvenance::User, &reserved_actions())
                .expect_err("a reserved action must be refused");
        assert!(err.to_string().contains("command 'c1'"), "got: {err}");
    }

    #[test]
    fn an_upload_may_reference_an_action_that_is_not_system_only() {
        let resolved = uploaded_using("woofx3:action:open");
        refuse_system_only_references(&resolved, InstallProvenance::User, &reserved_actions())
            .expect("an open action installs");
    }

    #[test]
    fn a_system_module_may_reference_a_system_only_action() {
        let resolved = uploaded_using("woofx3:action:restricted");
        refuse_system_only_references(&resolved, InstallProvenance::System, &reserved_actions())
            .expect("system provenance is exempt");
    }

    #[test]
    fn an_upload_cannot_declare_system_only() {
        let m = minimal(
            r#",
            "functions": [{ "id": "f", "name": "F", "runtime": "js", "path": "functions/f.js" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f", "systemOnly": true }]"#,
        );
        let err = validate(&m).expect_err("systemOnly is a system-module flag");
        assert!(
            err.to_string()
                .contains("`systemOnly` may only be declared by a bundled system module"),
            "got: {err}"
        );
    }

    // ---------------------------------------------------------------
    // A step naming another module's action runs with that module's
    // permissions, so the upload must declare them too.
    // ---------------------------------------------------------------

    fn installed_module(
        module_id: &str,
        permissions: &[&str],
    ) -> super::super::db_proxy::ModuleRecord {
        let manifest = serde_json::json!({
            "id": module_id, "name": module_id, "version": "1.0.0",
            "permissions": permissions,
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

    fn installed_twitch() -> FakeDbProxyClient {
        FakeDbProxyClient::new().with_installed([installed_module(
            "woofx3_twitch",
            &["twitch.moderation", "twitch.channel"],
        )])
    }

    fn calls_twitch_timeout(permissions: &str) -> ModuleManifest {
        minimal(&format!(
            r#",
            "permissions": {permissions},
            "triggers": [{{ "id": "t1", "name": "T1", "type": "eventbus", "event": "chat.command.x" }}],
            "workflows": [{{
                "id": "w1", "name": "W1", "trigger": "t1",
                "steps": [{{ "id": "s1", "action": "woofx3_twitch:action:twitch.timeout" }}]
            }}]"#
        ))
    }

    #[tokio::test]
    async fn a_step_calling_another_modules_action_needs_its_permissions() {
        let m = calls_twitch_timeout(r#"["twitch.moderation"]"#);
        let err = plan_err(&m, &installed_twitch()).await;
        assert!(err.contains("woofx3_twitch:action:twitch.timeout"), "{err}");
        assert!(err.contains("twitch.channel"), "{err}");
        assert!(
            !err.contains("twitch.moderation,"),
            "a declared permission is not reported missing: {err}"
        );
    }

    #[tokio::test]
    async fn a_step_calling_another_modules_action_installs_with_its_permissions() {
        let m = calls_twitch_timeout(r#"["twitch.moderation", "twitch.channel"]"#);
        let resolved = validate(&m).expect("validate ok");
        build_install_plan(&m, &resolved, &installed_twitch())
            .await
            .expect("declaring the target's permissions installs");
    }

    #[tokio::test]
    async fn a_command_calling_another_modules_action_needs_its_permissions() {
        let m = minimal(
            r#",
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!to", "type": "prefix",
                "actions": [{ "action": "woofx3_twitch:action:twitch.timeout" }] }]"#,
        );
        let err = plan_err(&m, &installed_twitch()).await;
        assert!(err.contains("command 'c1'"), "{err}");
        assert!(err.contains("twitch.moderation, twitch.channel"), "{err}");
    }

    #[tokio::test]
    async fn a_step_calling_a_module_with_no_readable_manifest_is_refused() {
        let m = calls_twitch_timeout("[]");
        let err = plan_err(&m, &FakeDbProxyClient::new()).await;
        assert!(err.contains("no readable installed manifest"), "{err}");
    }

    #[tokio::test]
    async fn a_system_install_is_exempt_from_cross_module_permissions() {
        let mut m = calls_twitch_timeout("[]");
        m.id = SYSTEM_MODULE_ID.to_string();
        let resolved =
            validate_with_provenance(&m, InstallProvenance::System).expect("validate ok");
        build_install_plan(&m, &resolved, &installed_twitch())
            .await
            .expect("bundled modules wire the engine's own actions");
    }

    #[tokio::test]
    async fn a_step_calling_its_own_action_needs_no_extra_permissions() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "chat.command.x" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "js", "path": "f.js" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [{ "action": "a1" }] }]"#,
        );
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();
        build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect("same-module references are covered by the module's own permissions");
        assert!(
            !db_proxy.calls().contains(&"list_modules".to_string()),
            "no cross-module reference, no extra db-proxy call"
        );
    }

    #[test]
    fn a_five_field_cron_schedule_installs() {
        let m = minimal(
            r#",
            "functions": [{ "id": "sweep", "name": "Sweep", "runtime": "js", "path": "functions/sweep.js" }],
            "backgroundTasks": [{ "id": "s1", "function": "sweep", "schedule": "*/30 * * * *", "description": "d" }]"#,
        );
        validate(&m).expect("standard five-field cron must be accepted");
    }

    #[test]
    fn a_six_field_cron_schedule_still_installs() {
        let m = minimal(
            r#",
            "functions": [{ "id": "sweep", "name": "Sweep", "runtime": "js", "path": "functions/sweep.js" }],
            "backgroundTasks": [{ "id": "s1", "function": "sweep", "schedule": "0 */30 * * * *", "description": "d" }]"#,
        );
        validate(&m).expect("six-field cron must keep working");
    }

    /// The failure this replaces was a log line during registry load, long
    /// after the install reported success.
    #[test]
    fn an_unparseable_schedule_fails_the_install_naming_the_task() {
        let m = minimal(
            r#",
            "functions": [{ "id": "sweep", "name": "Sweep", "runtime": "js", "path": "functions/sweep.js" }],
            "backgroundTasks": [{ "id": "s1", "function": "sweep", "schedule": "not a cron", "description": "d" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("s1"), "the error must name the task: {err}");
        assert!(
            err.contains("cron"),
            "the error must say what is wrong: {err}"
        );
    }

    const SWEEP_FUNCTION: &str = r#",
            "functions": [{ "id": "timer.expire", "name": "Expire", "runtime": "js", "path": "functions/timer.js" }]"#;

    fn with_deadlines(deadlines: &str) -> ModuleManifest {
        minimal(&format!(r#"{SWEEP_FUNCTION}, "deadlines": {deadlines}"#))
    }

    #[test]
    fn a_declared_deadline_installs_and_parses_both_spellings() {
        let m = with_deadlines(
            r#"[
                { "id": "timer_end", "function": "timer.expire", "maxPending": 256, "description": "d" },
                { "id": "other", "function": "timer.expire", "max_pending": 1 }
            ]"#,
        );
        validate(&m).expect("a well-formed deadline must install");
        assert_eq!(m.deadlines[0].max_pending, 256);
        assert_eq!(m.deadlines[1].max_pending, 1);
    }

    #[test]
    fn a_duplicate_deadline_id_fails_the_install() {
        let m = with_deadlines(
            r#"[
                { "id": "timer_end", "function": "timer.expire", "maxPending": 4 },
                { "id": "timer_end", "function": "timer.expire", "maxPending": 4 }
            ]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("duplicate deadline id"), "{err}");
    }

    #[test]
    fn a_deadline_naming_an_undeclared_function_fails_the_install() {
        let m =
            with_deadlines(r#"[{ "id": "timer_end", "function": "timer.gone", "maxPending": 4 }]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("timer.gone"), "{err}");
    }

    #[test]
    fn a_deadline_without_max_pending_fails_the_install() {
        let m = with_deadlines(r#"[{ "id": "timer_end", "function": "timer.expire" }]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("maxPending is required"), "{err}");
    }

    #[test]
    fn a_deadline_over_the_pending_cap_fails_the_install() {
        let m = with_deadlines(&format!(
            r#"[{{ "id": "timer_end", "function": "timer.expire", "maxPending": {} }}]"#,
            DEADLINES_MAX_PENDING_CAP + 1
        ));
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("between 1 and"), "{err}");
    }

    #[test]
    fn a_deadline_without_an_id_fails_the_install() {
        let m = with_deadlines(r#"[{ "id": " ", "function": "timer.expire", "maxPending": 4 }]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("id is required"), "{err}");
    }

    #[test]
    fn known_permissions_install() {
        let m = minimal(r#", "permissions": ["twitch.moderation", "twitch.channel"]"#);
        validate(&m).expect("known permissions must install");
        assert_eq!(m.permissions, vec!["twitch.moderation", "twitch.channel"]);
    }

    #[test]
    fn a_manifest_without_permissions_declares_none() {
        assert!(minimal("").permissions.is_empty());
    }

    #[test]
    fn an_unknown_permission_fails_the_install() {
        let m = minimal(r#", "permissions": ["twitch.moderation", "twitch.everything"]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("permissions[1]"), "{err}");
        assert!(err.contains("twitch.everything"), "{err}");
    }

    #[test]
    fn a_net_host_permission_installs_and_a_malformed_one_does_not() {
        let m = minimal(r#", "permissions": ["net:api.spotify.com", "net:accounts.spotify.com"]"#);
        validate(&m).expect("net: hosts install");
        for bad in [
            "net:",
            "net:*.spotify.com",
            "net:localhost",
            "net:10.0.0.1",
            "net:API.spotify.com",
            "net:api.spotify.com:443",
        ] {
            let m = minimal(&format!(r#", "permissions": ["{bad}"]"#));
            let err = validate(&m).unwrap_err().to_string();
            assert!(err.contains("unknown permission"), "{bad}: {err}");
        }
    }

    #[test]
    fn a_url_setting_installs_without_a_default() {
        let m = minimal(r#", "settings": [{ "id": "server", "label": "Server", "type": "url" }]"#);
        validate(&m).expect("url setting installs");
        let m = minimal(
            r#", "settings": [{ "id": "server", "label": "Server", "type": "url", "defaultValue": "https://evil.example.com" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("cannot declare `defaultValue`"), "{err}");
    }

    const SPOTIFY_SETTINGS: &str = r#", "settings": [
        { "id": "clientId", "label": "Client ID", "type": "text" },
        { "id": "clientSecret", "label": "Client secret", "type": "secret" }
    ]"#;

    fn with_oauth(integration: &str) -> ModuleManifest {
        minimal(&format!(r#"{SPOTIFY_SETTINGS}, "oauth": [{integration}]"#))
    }

    const SPOTIFY: &str = r#"{ "id": "spotify", "authorizeUrl": "https://accounts.spotify.com/authorize",
        "tokenUrl": "https://accounts.spotify.com/api/token", "scopes": ["user-read-playback-state"],
        "clientIdSetting": "clientId", "clientSecretSetting": "clientSecret", "hosts": ["api.spotify.com"] }"#;

    #[test]
    fn an_oauth_integration_installs() {
        validate(&with_oauth(SPOTIFY)).expect("spotify integration installs");
    }

    #[test]
    fn an_oauth_integration_needs_https_endpoints_hosts_and_its_settings() {
        let cases = [
            (
                SPOTIFY.replace(
                    "https://accounts.spotify.com/api/token",
                    "http://accounts.spotify.com/api/token",
                ),
                "must be https",
            ),
            (
                SPOTIFY.replace(r#"["api.spotify.com"]"#, "[]"),
                "at least one host",
            ),
            (
                SPOTIFY.replace(r#"["api.spotify.com"]"#, r#"["10.0.0.1"]"#),
                "exact lowercase DNS name",
            ),
            (
                SPOTIFY.replace(
                    r#""clientIdSetting": "clientId""#,
                    r#""clientIdSetting": "nope""#,
                ),
                "not a setting",
            ),
            (
                SPOTIFY.replace(
                    r#""clientIdSetting": "clientId""#,
                    r#""clientIdSetting": "clientSecret""#,
                ),
                "must be a `text` setting",
            ),
            (
                SPOTIFY.replace(
                    r#""clientSecretSetting": "clientSecret""#,
                    r#""clientSecretSetting": "clientId""#,
                ),
                "must be a `secret` setting",
            ),
            (
                SPOTIFY.replace(r#""id": "spotify""#, r#""id": "Spot ify""#),
                "lowercase letters",
            ),
        ];
        for (integration, expected) in cases {
            let err = validate(&with_oauth(&integration)).unwrap_err().to_string();
            assert!(err.contains(expected), "{expected}: {err}");
        }
        let twice = minimal(&format!(
            r#"{SPOTIFY_SETTINGS}, "oauth": [{SPOTIFY}, {SPOTIFY}]"#
        ));
        assert!(
            validate(&twice)
                .unwrap_err()
                .to_string()
                .contains("listed twice")
        );
    }

    #[test]
    fn a_setting_may_not_take_a_reserved_token_key() {
        let m = minimal(
            r#", "settings": [{ "id": "oauth.spotify", "label": "Token", "type": "text" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("reserved"), "{err}");
    }

    #[test]
    fn a_duplicate_permission_fails_the_install() {
        let m = minimal(r#", "permissions": ["twitch.channel", "twitch.channel"]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("listed twice"), "{err}");
    }

    #[test]
    fn run_on_load_defaults_off_and_parses_both_spellings() {
        let m = minimal(&format!(
            r#"{SWEEP_FUNCTION}, "backgroundTasks": [
                {{ "id": "a", "function": "timer.expire", "schedule": "* * * * *" }},
                {{ "id": "b", "function": "timer.expire", "schedule": "* * * * *", "runOnLoad": true }},
                {{ "id": "c", "function": "timer.expire", "schedule": "* * * * *", "run_on_load": true }}
            ]"#
        ));
        validate(&m).expect("runOnLoad installs");
        let flags: Vec<bool> = m.background_tasks.iter().map(|t| t.run_on_load).collect();
        assert_eq!(flags, vec![false, true, true]);
    }

    #[test]
    fn a_declared_step_id_is_kept() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "channel.follow" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "js", "path": "functions/f1.js" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [
                { "id": "say", "action": "a1" }
            ]}]"#,
        );
        let r = validate(&m).expect("ok");
        assert_eq!(r.workflows[0].step_actions.len(), 1);
        // The declared id survives into the stored task; see
        // module_manifest::step_to_task_json.
        assert_eq!(m.workflows[0].steps[0].id.as_deref(), Some("say"));
    }

    #[test]
    fn duplicate_step_ids_are_rejected() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "channel.follow" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "js", "path": "functions/f1.js" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [
                { "id": "dup", "action": "a1" },
                { "id": "dup", "action": "a1" }
            ]}]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("duplicate step id"), "got: {err}");
    }

    /// A typo here used to produce a step that depended on nothing and ran in
    /// whatever order the array happened to give.
    #[test]
    fn a_dangling_depends_on_is_rejected() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "channel.follow" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "js", "path": "functions/f1.js" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [
                { "id": "first", "action": "a1" },
                { "id": "second", "action": "a1", "dependsOn": ["frist"] }
            ]}]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("names no step"), "got: {err}");
        assert!(
            err.contains("frist"),
            "the error must quote the typo: {err}"
        );
    }

    #[test]
    fn a_satisfied_depends_on_validates() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "channel.follow" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "js", "path": "functions/f1.js" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [
                { "id": "first", "action": "a1" },
                { "id": "second", "action": "a1", "dependsOn": ["first"] }
            ]}]"#,
        );
        validate(&m).expect("a dependency on a declared step is fine");
    }

    #[test]
    fn steps_without_ids_still_validate() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus", "event": "channel.follow" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "js", "path": "functions/f1.js" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [
                { "action": "a1" }, { "action": "a1" }
            ]}]"#,
        );
        validate(&m).expect("generated ids are still the default");
    }

    #[test]
    fn validates_minimal_manifest() {
        let m = minimal("");
        let r = validate(&m).expect("ok");
        assert_eq!(r.module_id, "test_mod");
        assert!(r.triggers.is_empty());
    }

    #[test]
    fn rejects_missing_top_level_id() {
        let m = parse(r#"{"id": "", "name": "X"}"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("top-level"), "got: {err}");
    }

    #[test]
    fn rejects_invalid_top_level_id() {
        let m = parse(r#"{"id": "bad:id", "name": "X"}"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("disallowed"), "got: {err}");
    }

    #[test]
    fn rejects_trigger_missing_id() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "", "name": "T", "type": "eventbus" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("trigger #0"), "got: {err}");
    }

    #[test]
    fn rejects_duplicate_ids_within_kind() {
        let m = minimal(
            r#",
            "triggers": [
                { "id": "foo", "name": "Foo", "type": "eventbus" },
                { "id": "foo", "name": "Foo Two", "type": "eventbus" }
            ]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("duplicate"), "got: {err}");
    }

    #[test]
    fn allows_same_id_across_different_kinds() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "play_alert", "name": "T", "type": "eventbus" }],
            "functions": [{ "id": "play_alert", "name": "F", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "play_alert", "name": "A", "type": "function", "function": "play_alert" }]"#,
        );
        let r = validate(&m).expect("ok");
        assert_eq!(
            r.triggers[0].canonical_id.to_string(),
            "test_mod:trigger:play_alert"
        );
        assert_eq!(
            r.actions[0].canonical_id.to_string(),
            "test_mod:action:play_alert"
        );
    }

    #[test]
    fn resolves_function_action_to_canonical_function() {
        let m = minimal(
            r#",
            "functions": [{ "id": "play_alert", "name": "F", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "play.alert", "name": "A", "type": "function", "function": "play_alert" }]"#,
        );
        let r = validate(&m).expect("ok");
        match &r.actions[0].implementation {
            ResolvedActionImpl::Function {
                canonical_function_id,
            } => {
                assert_eq!(
                    canonical_function_id.to_string(),
                    "test_mod:function:play_alert"
                );
            }
            other => panic!("expected a function reference, got {other:?}"),
        }
    }

    #[test]
    fn function_action_passes_through_full_canonical_id() {
        let m = minimal(
            r#",
            "actions": [{
                "id": "x",
                "name": "X",
                "type": "function",
                "function": "other_mod:function:bar"
            }]"#,
        );
        let r = validate(&m).expect("ok");
        match &r.actions[0].implementation {
            ResolvedActionImpl::Function {
                canonical_function_id,
            } => {
                assert_eq!(canonical_function_id.to_string(), "other_mod:function:bar");
            }
            other => panic!("expected a function reference, got {other:?}"),
        }
    }

    #[test]
    fn rejects_unresolved_function_reference() {
        let m = minimal(
            r#",
            "actions": [{ "id": "x", "name": "X", "type": "function", "function": "missing" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("does not match"), "got: {err}");
    }

    #[test]
    fn rejects_canonical_reference_with_wrong_kind() {
        let m = minimal(
            r#",
            "actions": [{
                "id": "x",
                "name": "X",
                "type": "function",
                "function": "other_mod:trigger:bar"
            }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("does not match expected kind"), "got: {err}");
    }

    #[test]
    fn rejects_function_action_with_empty_function_field() {
        let m = minimal(
            r#",
            "actions": [{ "id": "x", "name": "X", "type": "function", "function": "" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("function"), "got: {err}");
    }

    #[test]
    fn resolves_workflow_trigger_and_step_actions() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "channel_subscribe", "name": "T", "type": "eventbus" }],
            "functions": [{ "id": "play_alert", "name": "F", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "play_alert", "name": "A", "type": "function", "function": "play_alert" }],
            "workflows": [{
                "id": "on_subscribe",
                "name": "W",
                "trigger": "channel_subscribe",
                "steps": [{ "action": "play_alert" }]
            }]"#,
        );
        let r = validate(&m).expect("ok");
        let wf = &r.workflows[0];
        assert_eq!(
            wf.canonical_id.to_string(),
            "test_mod:workflow:on_subscribe"
        );
        assert_eq!(
            wf.trigger
                .as_resource()
                .expect("a local trigger id is a resource binding")
                .to_string(),
            "test_mod:trigger:channel_subscribe"
        );
        assert_eq!(wf.step_actions.len(), 1);
        assert_eq!(wf.step_actions[0].to_string(), "test_mod:action:play_alert");
    }

    // ---------------------------------------------------------------
    // Workflow trigger bindings. A canonical id is a promise the
    // declaration stays installed; an event type is not, and the
    // difference is what decides whether a dependency edge exists.
    // ---------------------------------------------------------------

    #[test]
    fn a_dotted_unknown_trigger_binds_to_the_event() {
        let m = minimal(
            r#",
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "channel.follow", "steps": [] }]"#,
        );
        let r = validate(&m).expect("ok");
        match &r.workflows[0].trigger {
            WorkflowTriggerRef::Event(e) => assert_eq!(e, "channel.follow"),
            other => panic!("expected an event binding, got {other:?}"),
        }
        assert!(
            r.workflows[0].trigger.as_resource().is_none(),
            "an event binding must not produce a dependency"
        );
    }

    #[test]
    fn a_canonical_id_binds_to_the_resource() {
        let m = minimal(
            r#",
            "workflows": [{
                "id": "w1", "name": "W1",
                "trigger": "woofx3_twitch:trigger:channel_follow", "steps": []
            }]"#,
        );
        let r = validate(&m).expect("ok");
        let canonical = r.workflows[0]
            .trigger
            .as_resource()
            .expect("a canonical id is a resource binding");
        assert_eq!(
            canonical.to_string(),
            "woofx3_twitch:trigger:channel_follow"
        );
    }

    /// The ambiguous case the inferred form has to get right: a bare word is
    /// a local trigger id, and a mistyped one must not slide through as an
    /// event type that never fires.
    #[test]
    fn a_dotless_unknown_trigger_is_rejected_as_a_typo() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "channel_follow", "name": "T", "type": "eventbus" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "chanel_follow", "steps": [] }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("matches no trigger"), "got: {err}");
    }

    #[test]
    fn a_local_trigger_id_still_binds_to_the_resource() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [] }]"#,
        );
        let r = validate(&m).expect("ok");
        assert_eq!(
            r.workflows[0]
                .trigger
                .as_resource()
                .expect("local id is a resource")
                .to_string(),
            "test_mod:trigger:t1"
        );
    }

    #[test]
    fn rejects_workflow_with_unknown_trigger() {
        let m = minimal(
            r#",
            "workflows": [{
                "id": "x",
                "name": "X",
                "trigger": "missing",
                "steps": []
            }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("matches no trigger"), "got: {err}");
    }

    #[test]
    fn resolves_command_workflow() {
        let m = minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [] }],
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix", "workflow": "w1" }]"#,
        );
        let r = validate(&m).expect("ok");
        assert_eq!(
            r.commands[0].workflow.as_ref().unwrap().to_string(),
            "test_mod:workflow:w1"
        );
    }

    #[test]
    fn rejects_accepted_events_on_a_widget() {
        let err = validate(&minimal(
            r#",
            "widgets": [{ "id": "wd1", "name": "Wd1", "acceptedEvents": ["channel.follow"] }]"#,
        ))
        .unwrap_err()
        .to_string();
        assert!(
            err.contains("`acceptedEvents` is no longer supported"),
            "got: {err}"
        );
        validate(&minimal(
            r#",
            "widgets": [{ "id": "wd1", "name": "Wd1", "acceptedEvents": [] }]"#,
        ))
        .expect("an empty list asks for nothing");
    }

    #[test]
    fn resolves_command_actions() {
        let m = minimal(
            r#",
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix",
                "actions": [{ "action": "a1" }, { "action": "other_mod:action:say" }] }]"#,
        );
        let r = validate(&m).expect("ok");
        let actions: Vec<String> = r.commands[0]
            .step_actions
            .iter()
            .map(|a| a.to_string())
            .collect();
        assert_eq!(actions, ["test_mod:action:a1", "other_mod:action:say"]);
        assert!(r.commands[0].workflow.is_none());
    }

    #[test]
    fn rejects_command_action_naming_no_local_action() {
        let err = validate(&minimal(
            r#",
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix",
                "actions": [{ "action": "missing" }] }]"#,
        ))
        .unwrap_err()
        .to_string();
        assert!(err.contains("command #0 (c1) action #0"), "got: {err}");
    }

    #[test]
    fn rejects_command_declaring_both_workflow_and_actions() {
        let err = validate(&minimal(
            r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [] }],
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix",
                "workflow": "w1", "actions": [{ "action": "a1" }] }]"#,
        ))
        .unwrap_err()
        .to_string();
        assert!(err.contains("either `workflow` or `actions`"), "got: {err}");
    }

    #[test]
    fn command_without_workflow_resolves_to_none() {
        let m = minimal(
            r#",
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix" }]"#,
        );
        let r = validate(&m).expect("ok");
        assert!(r.commands[0].workflow.is_none());
    }

    // ---------------------------------------------------------------
    // Asset validation
    // ---------------------------------------------------------------

    #[test]
    fn validates_asset_array_and_resolves_canonical_ids() {
        let m = minimal(
            r#",
            "assets": [
              { "id": "victory", "name": "Victory", "path": "assets/victory.mp3", "kind": "audio" },
              { "id": "logo",    "name": "Logo",    "path": "assets/logo.png",    "kind": "image" }
            ]"#,
        );
        let r = validate(&m).expect("ok");
        assert_eq!(r.assets.len(), 2);
        assert_eq!(
            r.assets[0].canonical_id.to_string(),
            "test_mod:asset:victory"
        );
        assert_eq!(r.assets[1].canonical_id.to_string(), "test_mod:asset:logo");
    }

    #[test]
    fn rejects_duplicate_asset_ids() {
        let m = minimal(
            r#",
            "assets": [
              { "id": "a", "name": "A", "path": "assets/a.png" },
              { "id": "a", "name": "B", "path": "assets/b.png" }
            ]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("duplicate"), "got: {err}");
    }

    #[test]
    fn rejects_asset_missing_id() {
        let m = minimal(
            r#",
            "assets": [{ "id": "", "name": "X", "path": "assets/x.png" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("asset #0"), "got: {err}");
    }

    #[test]
    fn rejects_asset_with_empty_path() {
        let m = minimal(
            r#",
            "assets": [{ "id": "x", "name": "X", "path": "" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("`path` is required"), "got: {err}");
    }

    #[test]
    fn rejects_asset_with_absolute_path() {
        let m = minimal(
            r#",
            "assets": [{ "id": "x", "name": "X", "path": "/etc/passwd" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("must be relative"), "got: {err}");
    }

    #[test]
    fn rejects_asset_path_traversal() {
        let m = minimal(
            r#",
            "assets": [{ "id": "x", "name": "X", "path": "assets/../../etc/passwd" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains(".."), "got: {err}");
    }

    #[test]
    fn rejects_widget_entry_path_traversal() {
        let m = minimal(
            r#",
            "widgets": [{ "id": "w", "name": "W", "entry": "assets/../../etc/passwd", "assets": "assets/" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("widget #0"), "got: {err}");
        assert!(err.contains(".."), "got: {err}");
    }

    #[test]
    fn rejects_widget_assets_path_traversal_even_without_entry() {
        // entry_relative_to_assets() alone returns Ok(None) when `entry` is
        // absent, never inspecting `assets` — this guards the case where
        // only `assets` is declared and it contains `..`.
        let m = minimal(
            r#",
            "widgets": [{ "id": "w", "name": "W", "assets": "assets/../../etc" }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("widget #0"), "got: {err}");
        assert!(err.contains(".."), "got: {err}");
    }

    #[test]
    fn assets_array_is_optional() {
        let m = minimal("");
        let r = validate(&m).expect("ok");
        assert!(r.assets.is_empty());
    }

    #[test]
    fn asset_kind_and_content_type_are_optional_passthrough() {
        let m = minimal(
            r#",
            "assets": [{
              "id": "raw",
              "name": "Raw",
              "path": "assets/data.bin"
            }]"#,
        );
        let r = validate(&m).expect("ok");
        assert_eq!(r.assets.len(), 1);
        // The raw manifest fields aren't projected onto ResolvedAsset
        // today (they're consumed at install time + emitted in the
        // webhook event), but the entry must still be present and
        // canonicalized so cross-references resolve.
        assert_eq!(r.assets[0].canonical_id.to_string(), "test_mod:asset:raw");
    }

    // ---------------------------------------------------------------
    // Themes: contracts, theme entries, `requires`
    // ---------------------------------------------------------------

    const COUNTDOWN_CONTRACT: &str = r##"{
        "contractVersion": 1,
        "variables": [{ "id": "accent", "type": "color", "default": "#7ad7ff" }],
        "assetSlots": [{ "id": "background", "kinds": ["image", "video"] }]
    }"##;

    fn timerpro_manifest_json() -> String {
        format!(
            r#"{{"id": "timerpro", "name": "Timer Pro", "version": "1.2.3",
                 "widgets": [{{"id": "countdown", "name": "Countdown",
                              "entry": "widgets/countdown/index.html", "assets": "widgets/countdown",
                              "theme": {COUNTDOWN_CONTRACT}}},
                             {{"id": "plain", "name": "Plain",
                              "entry": "widgets/plain/index.html", "assets": "widgets/plain"}}]}}"#
        )
    }

    fn installed_timerpro() -> super::super::db_proxy::ModuleRecord {
        serde_json::from_value(serde_json::json!({
            "id": "row-1",
            "module_id": "timerpro",
            "module_key": "timerpro:1.2.3:abc1234",
            "name": "Timer Pro",
            "version": "1.2.3",
            "state": "active",
            "manifest": timerpro_manifest_json(),
        }))
        .expect("module record")
    }

    fn neon_pack(requires: &str, theme: &str) -> ModuleManifest {
        parse(&format!(
            r#"{{"id": "neonpack", "name": "Neon", "version": "1.0.0",
                 "requires": {requires},
                 "themes": [{theme}]}}"#
        ))
    }

    const NEON: &str = r##"{"id": "neon", "name": "Neon", "target": "timerpro:widget:countdown",
        "contractVersion": 1, "variables": { "accent": "#ff2bd6" },
        "assets": { "background": "assets/grid.webm" }}"##;

    async fn plan_err(m: &ModuleManifest, db_proxy: &FakeDbProxyClient) -> String {
        let resolved = validate(m).expect("static validation passes");
        build_install_plan(m, &resolved, db_proxy)
            .await
            .expect_err("install plan should fail")
            .to_string()
    }

    #[test]
    fn a_theme_gets_the_theme_canonical_kind() {
        let m = neon_pack(r#"{"timerpro": "^1.2.0"}"#, NEON);
        let resolved = validate(&m).expect("valid");
        assert_eq!(
            resolved.themes[0].canonical_id.to_string(),
            "neonpack:theme:neon"
        );
    }

    #[test]
    fn a_manifest_may_not_declare_a_theme_field() {
        let m = minimal(
            r#",
            "widgets": [{ "id": "w", "name": "W",
                          "settingsSchema": [{ "id": "look", "label": "Look", "type": "theme" }] }]"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("a `theme` field cannot be declared"), "{err}");
    }

    #[test]
    fn a_theme_for_another_module_must_require_it() {
        let err = validate(&neon_pack("{}", NEON)).unwrap_err().to_string();
        assert!(err.contains("which `requires` must name"), "{err}");
    }

    #[test]
    fn a_module_may_theme_its_own_widget() {
        let m = parse(&format!(
            r##"{{"id": "timerpro", "name": "Timer Pro", "version": "1.2.3",
                 "widgets": [{{"id": "countdown", "name": "Countdown",
                              "entry": "widgets/countdown/index.html", "assets": "widgets/countdown",
                              "theme": {COUNTDOWN_CONTRACT}}}],
                 "themes": [{{"id": "free", "name": "Free", "target": "timerpro:widget:countdown",
                              "contractVersion": 1, "variables": {{ "accent": "#00ff00" }}}}]}}"##
        ));
        validate(&m).expect("own theme validates");
    }

    #[test]
    fn a_module_cannot_theme_its_own_widget_without_a_contract() {
        let m = parse(
            r#"{"id": "timerpro", "name": "Timer Pro", "version": "1.2.3",
                 "widgets": [{"id": "plain", "name": "Plain"}],
                 "themes": [{"id": "free", "name": "Free", "target": "timerpro:widget:plain",
                             "contractVersion": 1}]}"#,
        );
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("declares no `theme` contract"), "{err}");
    }

    #[test]
    fn a_theme_entry_with_code_fails_to_parse() {
        let err = serde_json::from_str::<ModuleManifest>(
            r#"{"id": "neonpack", "name": "Neon",
                "themes": [{"id": "neon", "name": "Neon", "target": "timerpro:widget:countdown",
                            "contractVersion": 1, "functions": []}]}"#,
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("unknown field `functions`"), "{err}");
    }

    #[tokio::test]
    async fn install_fails_when_requires_is_not_installed() {
        let err = plan_err(
            &neon_pack(r#"{"timerpro": "^1.2.0"}"#, NEON),
            &FakeDbProxyClient::new(),
        )
        .await;
        assert!(err.contains("timerpro ^1.2.0 is not installed"), "{err}");
    }

    #[tokio::test]
    async fn install_fails_when_the_installed_version_is_out_of_range() {
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_timerpro()]);
        let err = plan_err(&neon_pack(r#"{"timerpro": "^2.0.0"}"#, NEON), &db_proxy).await;
        assert!(err.contains("1.2.3 is installed"), "{err}");
    }

    #[tokio::test]
    async fn install_fails_when_the_target_widget_is_not_installed() {
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_timerpro()]);
        let theme = NEON.replace("timerpro:widget:countdown", "timerpro:widget:gone");
        let err = plan_err(&neon_pack(r#"{"timerpro": "^1.2.0"}"#, &theme), &db_proxy).await;
        assert!(err.contains("names no installed widget"), "{err}");
    }

    #[tokio::test]
    async fn install_fails_when_the_target_widget_has_no_contract() {
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_timerpro()]);
        let theme = NEON.replace("timerpro:widget:countdown", "timerpro:widget:plain");
        let err = plan_err(&neon_pack(r#"{"timerpro": "^1.2.0"}"#, &theme), &db_proxy).await;
        assert!(err.contains("declares no `theme` contract"), "{err}");
    }

    #[tokio::test]
    async fn install_fails_when_the_contract_version_differs() {
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_timerpro()]);
        let theme = NEON.replace("\"contractVersion\": 1", "\"contractVersion\": 2");
        let err = plan_err(&neon_pack(r#"{"timerpro": "^1.2.0"}"#, &theme), &db_proxy).await;
        assert!(
            err.contains("theme #0 (neon): `contractVersion` 2 does not match"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn install_fails_when_a_theme_sets_an_undeclared_variable() {
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_timerpro()]);
        let theme = NEON.replace("\"accent\"", "\"glow\"");
        let err = plan_err(&neon_pack(r#"{"timerpro": "^1.2.0"}"#, &theme), &db_proxy).await;
        assert!(err.contains("`variables.glow`"), "{err}");
    }

    #[tokio::test]
    async fn install_fails_when_a_variable_value_does_not_fit() {
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_timerpro()]);
        let theme = NEON.replace("#ff2bd6", "red; background: url(x)");
        let err = plan_err(&neon_pack(r#"{"timerpro": "^1.2.0"}"#, &theme), &db_proxy).await;
        assert!(err.contains("`variables.accent`"), "{err}");
    }

    #[tokio::test]
    async fn install_fails_when_an_asset_does_not_match_the_slot_kinds() {
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_timerpro()]);
        let theme = NEON.replace("assets/grid.webm", "assets/grid.mp3");
        let err = plan_err(&neon_pack(r#"{"timerpro": "^1.2.0"}"#, &theme), &db_proxy).await;
        assert!(err.contains("`assets.background`"), "{err}");
    }

    #[tokio::test]
    async fn a_theme_pack_plans_once_its_target_is_installed() {
        let db_proxy = FakeDbProxyClient::new().with_installed([installed_timerpro()]);
        let m = neon_pack(r#"{"timerpro": "^1.2.0"}"#, NEON);
        let resolved = validate(&m).expect("valid");
        build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect("theme pack plans");
    }

    #[tokio::test]
    async fn a_module_without_themes_or_requires_never_lists_modules() {
        let m = minimal("");
        let resolved = validate(&m).expect("valid");
        let db_proxy = FakeDbProxyClient::new();
        build_install_plan(&m, &resolved, &db_proxy)
            .await
            .expect("plans");
        assert!(!db_proxy.calls().contains(&"list_modules".to_string()));
    }
}
