//! Two-pass manifest validation.
//!
//! Pass 1 builds per-kind symbol tables of canonical ids, enforcing the
//! hard rules of the contract documented in `docs/barkloader/modules.md`:
//!
//!   - top-level `id` is required, non-empty, and a valid id segment
//!   - every resource (`triggers`, `actions`, `functions`, `commands`,
//!     `workflows`, `widgets`, `overlays`) has a non-empty `id` matching
//!     `[A-Za-z0-9._-]+`
//!   - within each kind, canonical ids are unique
//!
//! Pass 2 resolves intra-manifest references — the `function` field of
//! `function`-typed actions, `workflows[].trigger`,
//! `workflows[].steps[].action`, `commands[].workflow`,
//! `widgets[].acceptedEvents` — to canonical ids, either via the local
//! symbol tables or by accepting an already-canonical id verbatim
//! (cross-module references).
//!
//! On success, returns a [`ResolvedManifest`] that the install path can
//! iterate alongside the original manifest. Any failure aborts install
//! before any database or file-system side effect runs.

use anyhow::{anyhow, Result};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

use super::canonical_id::{
    looks_like_canonical_id, validate_segment, CanonicalId, ResourceKind,
    CANONICAL_ID_SEPARATOR,
};
use super::db_proxy_client::ModuleDbProxy;
use super::module_manifest::{
    ManifestAction, ManifestActionImpl, ManifestAsset, ManifestCommand, ManifestConfigField,
    ManifestDataShape, ManifestFunction, ManifestOverlay, ManifestResourceKind, ManifestSetting,
    ManifestTrigger, ManifestWorkflow, ModuleManifest, ModuleWidget, CONFIG_FIELD_TYPES,
    DATA_SHAPE_FIELD_TYPES,
};

/// Resolved action implementation. Mirrors `ManifestActionImpl` but
/// carries fully-resolved canonical ids ready for persistence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedActionImpl {
    /// `type: "function"` — function reference resolved to a canonical id.
    Function {
        canonical_function_id: CanonicalId,
    },
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
}

#[derive(Debug, Clone)]
pub struct ResolvedWorkflow {
    pub canonical_id: CanonicalId,
    pub trigger: CanonicalId,
    pub step_actions: Vec<CanonicalId>,
}

#[derive(Debug, Clone)]
pub struct ResolvedWidget {
    pub canonical_id: CanonicalId,
    pub accepted_events: Vec<CanonicalId>,
}

#[derive(Debug, Clone)]
pub struct ResolvedOverlay {
    pub canonical_id: CanonicalId,
}

#[derive(Debug, Clone)]
pub struct ResolvedAsset {
    pub canonical_id: CanonicalId,
}

#[derive(Debug, Clone)]
pub struct ResolvedManifest {
    pub module_id: String,
    pub triggers: Vec<ResolvedTrigger>,
    pub actions: Vec<ResolvedAction>,
    pub functions: Vec<ResolvedFunction>,
    pub commands: Vec<ResolvedCommand>,
    pub workflows: Vec<ResolvedWorkflow>,
    pub widgets: Vec<ResolvedWidget>,
    pub overlays: Vec<ResolvedOverlay>,
    pub assets: Vec<ResolvedAsset>,
}

/// Validate the manifest and resolve all intra-manifest references.
pub fn validate(manifest: &ModuleManifest) -> Result<ResolvedManifest> {
    let module_id = require_module_id(manifest)?;

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
    let overlays_table = build_kind_table(
        &module_id,
        ResourceKind::Overlay,
        &manifest.overlays,
        |o: &ManifestOverlay| &o.id,
    )?;
    let assets_table = build_kind_table(
        &module_id,
        ResourceKind::Asset,
        &manifest.assets,
        |a: &ManifestAsset| &a.id,
    )?;
    validate_asset_paths(&manifest.assets)?;
    validate_widget_entries(&manifest.widgets)?;
    validate_resource_kinds(&manifest.resources)?;
    validate_data_shapes(&manifest.triggers, &manifest.actions)?;
    validate_field_lists(manifest)?;

    // Pass 2: resolve references for kinds that have them.
    let triggers = entries_to_resolved(&triggers_table, |e| ResolvedTrigger {
        canonical_id: e.canonical_id.clone(),
    });
    let functions = entries_to_resolved(&functions_table, |e| ResolvedFunction {
        canonical_id: e.canonical_id.clone(),
    });
    let overlays = entries_to_resolved(&overlays_table, |e| ResolvedOverlay {
        canonical_id: e.canonical_id.clone(),
    });
    let assets = entries_to_resolved(&assets_table, |e| ResolvedAsset {
        canonical_id: e.canonical_id.clone(),
    });
    let actions = resolve_actions(&manifest.actions, &actions_table, &functions_table)?;
    let commands = resolve_commands(&manifest.commands, &commands_table, &workflows_table)?;
    let workflows =
        resolve_workflows(&manifest.workflows, &workflows_table, &triggers_table, &actions_table)?;
    let widgets = resolve_widgets(&manifest.widgets, &widgets_table, &triggers_table)?;

    Ok(ResolvedManifest {
        module_id,
        triggers,
        actions,
        functions,
        commands,
        workflows,
        widgets,
        overlays,
        assets,
    })
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
    nodes.push(StepNode { step, phase, deps: dep_indices });
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

    let mut nodes: Vec<StepNode> = Vec::new();
    let mut index_of: HashMap<InstallStep, usize> = HashMap::new();

    add_step(&mut nodes, &mut index_of, InstallStep::UploadFunctionFiles, (0, 0, 0), &[]);
    add_step(&mut nodes, &mut index_of, InstallStep::UploadWidgetAssets, (0, 1, 0), &[]);
    add_step(&mut nodes, &mut index_of, InstallStep::UploadOverlayEntries, (0, 2, 0), &[]);
    add_step(&mut nodes, &mut index_of, InstallStep::UploadAssets, (0, 3, 0), &[]);

    add_step(
        &mut nodes,
        &mut index_of,
        InstallStep::CreateModule,
        (1, 0, 0),
        &[&InstallStep::UploadFunctionFiles],
    );

    // Triggers and actions register unconditionally today (even with an
    // empty list) — functions and overlays have no bulk-registration
    // call of their own, only the upload + (for functions) the ledger
    // entries `CreateModule` writes.
    add_step(&mut nodes, &mut index_of, InstallStep::RegisterTriggers, (2, 0, 0), &[&InstallStep::CreateModule]);
    add_step(&mut nodes, &mut index_of, InstallStep::RegisterActions, (2, 1, 0), &[&InstallStep::CreateModule]);

    if !resolved.widgets.is_empty() {
        add_step(&mut nodes, &mut index_of, InstallStep::RegisterWidgets, (2, 2, 0), &[&InstallStep::CreateModule]);
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
        add_step(&mut nodes, &mut index_of, InstallStep::RegisterSettings, (2, 4, 0), &[&InstallStep::CreateModule]);
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
        let mut deps = vec![InstallStep::CreateModule];
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

    debug_assert_eq!(order.len(), n, "install step graph must be acyclic by construction");

    let mut steps: Vec<Option<InstallStep>> = nodes.into_iter().map(|node| Some(node.step)).collect();
    order.into_iter().map(|i| steps[i].take().expect("each index visited exactly once")).collect()
}

/// Check every cross-module reference this manifest declares (a
/// workflow's trigger, a workflow step's action, a widget's accepted
/// event) resolves against an already-installed module, via `db_proxy`.
/// Same checks and error message as the old `validate_cross_module_dependencies`
/// in `module_install.rs`, computed once here as part of building the
/// plan instead of a second traversal of `resolved`.
async fn validate_cross_module_refs(
    resolved: &ResolvedManifest,
    db_proxy: &dyn ModuleDbProxy,
) -> Result<()> {
    let is_external = |id: &CanonicalId| {
        id.module_id() != resolved.module_id.as_str() && id.module_id() != "builtin"
    };

    let mut missing: Vec<String> = Vec::new();
    let mut checked: HashSet<String> = HashSet::new();

    for wf in &resolved.workflows {
        let canonical = &wf.trigger;
        if !is_external(canonical) || !checked.insert(canonical.to_string()) {
            continue;
        }
        if let Err(e) = db_proxy.get_trigger_event_by_canonical_id(&canonical.to_string()).await {
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
            if !is_external(event) || !checked.insert(event.to_string()) {
                continue;
            }
            if let Err(e) = db_proxy.get_trigger_event_by_canonical_id(&event.to_string()).await {
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
            if !is_external(action_canonical) || !checked.insert(action_canonical.to_string()) {
                continue;
            }
            if let Err(e) = db_proxy.get_action_ref_by_canonical_id(&action_canonical.to_string()).await {
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
            return Err(anyhow!("{context} field #{i} ({id}): `label` must be non-empty"));
        }
        validate_field_type(&field.field_type, &format!("{context} field #{i} ({id})"))?;
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
        if !seen.insert(id) {
            return Err(anyhow!("{context}: duplicate field `id` {id:?}"));
        }
    }
    Ok(())
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
        validate_field_type(&setting.setting_type, &format!("setting #{i} ({id})"))?;
        if setting.setting_type == "button" && setting.action.is_null() {
            return Err(anyhow!("setting #{i} ({id}): `button` needs an `action`"));
        }
        if !seen.insert(id) {
            return Err(anyhow!("duplicate setting `id` {id:?}"));
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
        return Err(anyhow!("manifest top-level `id` is required and must be non-empty"));
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
/// (triggers, functions, overlays).
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
        out.push(ResolvedCommand {
            canonical_id: entry.canonical_id.clone(),
            workflow,
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
        let trigger = resolve_local_or_canonical(
            workflow.trigger.trim(),
            ResourceKind::Trigger,
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
    triggers_table: &KindTable,
) -> Result<Vec<ResolvedWidget>> {
    let mut out = Vec::with_capacity(items.len());
    for (i, widget) in items.iter().enumerate() {
        let entry = widgets_table
            .entries
            .get(widget.id.trim())
            .ok_or_else(|| anyhow!("internal: widget #{i} missing from widget table"))?;
        let mut accepted_events = Vec::with_capacity(widget.accepted_events.len());
        for (ei, raw) in widget.accepted_events.iter().enumerate() {
            let canonical = resolve_local_or_canonical(
                raw.trim(),
                ResourceKind::Trigger,
                triggers_table,
                &format!("widget #{i} ({}) acceptedEvents[{ei}]", widget.id),
            )?;
            accepted_events.push(canonical);
        }
        out.push(ResolvedWidget {
            canonical_id: entry.canonical_id.clone(),
            accepted_events,
        });
    }
    Ok(out)
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
    // Field declarations: schema / settingsSchema / settings
    // ---------------------------------------------------------------

    #[test]
    fn accepts_the_canonical_field_list_on_every_surface() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "minBits", "label": "Minimum bits", "type": "number", "min": 1 }] }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "schema": [{ "id": "target", "label": "Counter", "type": "resource_ref", "resourceKind": "counter" }] }],
            "widgets": [{ "id": "w1", "name": "W1",
                "settingsSchema": [{ "id": "fontSize", "label": "Font size", "type": "number" }] }],
            "settings": [{ "id": "clientId", "label": "Client ID", "type": "text" }]"#);
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
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": "A", "type": "string" }] }]"#);
        let err = validate(&m).expect_err("string is not a control type");
        let msg = err.to_string();
        assert!(msg.contains("trigger #0 (t1)"), "names the surface: {msg}");
        assert!(msg.contains("text"), "lists the accepted tokens: {msg}");
    }

    #[test]
    fn rejects_duplicate_field_ids() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [
                    { "id": "a", "label": "A", "type": "text" },
                    { "id": "a", "label": "Again", "type": "number" }
                ] }]"#);
        assert!(validate(&m).expect_err("duplicate id").to_string().contains("duplicate"));
    }

    // A select with nothing to select and a resource picker that does not say
    // what to pick both render a dead control. Cheap here, confusing in a form.
    #[test]
    fn rejects_a_select_with_no_options_and_no_source() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": "A", "type": "select" }] }]"#);
        assert!(validate(&m).expect_err("dead select").to_string().contains("options"));
    }

    #[test]
    fn accepts_a_select_backed_by_a_dynamic_source() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": "A", "type": "select",
                    "source": { "kind": "commands" } }] }]"#);
        validate(&m).expect("a source supplies the options at render time");
    }

    #[test]
    fn rejects_a_resource_ref_without_a_resource_kind() {
        let m = minimal(r#",
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "schema": [{ "id": "t", "label": "T", "type": "resource_ref" }] }]"#);
        let err = validate(&m).expect_err("picker with nothing to pick");
        assert!(err.to_string().contains("resourceKind"), "{err}");
    }

    #[test]
    fn validates_a_resource_kind_create_form_like_every_other_surface() {
        let ok = minimal(r#",
            "resources": [{ "kind": "counter", "name": "Counter",
                "schema": [{ "id": "initialValue", "label": "Initial value", "type": "number" }] }]"#);
        validate(&ok).expect("validate ok");

        let bad = minimal(r#",
            "resources": [{ "kind": "counter", "name": "Counter",
                "schema": [{ "id": "initialValue", "label": "Initial value", "type": "integer" }] }]"#);
        let err = bad_err(&bad);
        assert!(err.contains("resource #0 (counter)"), "names the surface: {err}");
        assert!(err.contains("`schema`"), "{err}");
    }

    fn bad_err(m: &ModuleManifest) -> String {
        validate(m).expect_err("expected a validation failure").to_string()
    }

    #[test]
    fn rejects_a_button_setting_with_no_action() {
        let m = minimal(r#",
            "settings": [{ "id": "s1", "label": "S1", "type": "button" }]"#);
        assert!(validate(&m).expect_err("button with no action").to_string().contains("action"));
    }

    #[test]
    fn rejects_an_empty_field_id_and_an_empty_label() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "  ", "label": "A", "type": "text" }] }]"#);
        assert!(validate(&m).expect_err("blank id").to_string().contains("`id`"));

        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "schema": [{ "id": "a", "label": " ", "type": "text" }] }]"#);
        assert!(validate(&m).expect_err("blank label").to_string().contains("`label`"));
    }

    // ---------------------------------------------------------------
    // Data shapes: `emits` on triggers, `returns` on actions
    // ---------------------------------------------------------------

    #[test]
    fn accepts_a_well_formed_emits_and_returns() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [
                    { "path": "bits", "type": "number", "description": "Bits cheered.", "example": 1000 },
                    { "path": "channel.title", "type": "string" }
                ] } }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "returns": { "fields": [{ "path": "next", "type": "number" }] } }]"#);
        validate(&m).expect("validate ok");
    }

    #[test]
    fn accepts_a_manifest_declaring_no_shapes_at_all() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }]"#);
        validate(&m).expect("validate ok");
    }

    #[test]
    fn rejects_an_empty_path_in_emits() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [{ "path": "  ", "type": "string" }] } }]"#);
        let err = validate(&m).expect_err("empty path must fail");
        let msg = err.to_string();
        assert!(msg.contains("trigger #0 (t1)"), "names the offending trigger: {msg}");
        assert!(msg.contains("`emits`"), "names the offending field: {msg}");
        assert!(msg.contains("path"), "{msg}");
    }

    #[test]
    fn rejects_an_unknown_field_type() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [{ "path": "bits", "type": "integer" }] } }]"#);
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
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus",
                "emits": { "fields": [
                    { "path": "bits", "type": "number" },
                    { "path": "bits", "type": "string" }
                ] } }]"#);
        let err = validate(&m).expect_err("duplicate path must fail");
        assert!(err.to_string().contains("duplicate"), "{}", err);
    }

    #[test]
    fn rejects_a_bad_returns_on_an_action() {
        let m = minimal(r#",
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1",
                "returns": { "fields": [{ "path": "next", "type": "int" }] } }]"#);
        let err = validate(&m).expect_err("unknown type must fail");
        let msg = err.to_string();
        assert!(msg.contains("action #0 (a1)"), "names the offending action: {msg}");
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
    // Install plan: graph construction, ordering, validation
    // ---------------------------------------------------------------

    use super::super::db_proxy_client::FakeDbProxyClient;

    #[tokio::test]
    async fn build_install_plan_orders_uploads_before_create_module_before_registration() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "a1", "name": "A1", "type": "function", "function": "f1" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [{ "action": "a1" }] }],
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix", "workflow": "w1" }]"#);
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();
        let plan = build_install_plan(&m, &resolved, &db_proxy).await.expect("plan ok");

        let workflow_step = InstallStep::RegisterWorkflow(resolved.workflows[0].canonical_id.clone());
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
        let m = minimal(r#",
            "settings": [{ "id": "s1", "label": "S1", "type": "button", "action": { "kind": "integration", "integration": "x" } }]"#);
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();
        let plan = build_install_plan(&m, &resolved, &db_proxy).await.expect("plan ok");

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
        let m = minimal(r#",
            "widgets": [{ "id": "w1", "name": "W1" }],
            "backgroundTasks": [{ "id": "bg1", "function": "f1", "schedule": "* * * * * *" }],
            "settings": [{ "id": "s1", "label": "S1", "type": "text" }],
            "assets": [{ "id": "a1", "name": "A1", "path": "assets/a.png" }]"#);
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();
        let plan = build_install_plan(&m, &resolved, &db_proxy).await.expect("plan ok");

        assert!(plan.contains(&InstallStep::RegisterWidgets));
        assert!(plan.contains(&InstallStep::RegisterBackgroundTasks));
        assert!(plan.contains(&InstallStep::RegisterSettings));
        assert!(plan.contains(&InstallStep::RegisterAssets));
    }

    #[tokio::test]
    async fn build_install_plan_fails_fast_on_unresolvable_cross_module_trigger() {
        let m = minimal(r#",
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "other_mod:trigger:missing", "steps": [] }]"#);
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::failing_on(["get_trigger_event_by_canonical_id"]);

        let err = build_install_plan(&m, &resolved, &db_proxy).await.expect_err("should fail");
        assert!(
            err.to_string().contains("depends on resources from other modules that are not installed"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn build_install_plan_passes_when_cross_module_trigger_resolves() {
        let m = minimal(r#",
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "other_mod:trigger:exists", "steps": [] }]"#);
        let resolved = validate(&m).expect("validate ok");
        let db_proxy = FakeDbProxyClient::new();

        let plan = build_install_plan(&m, &resolved, &db_proxy).await.expect("should resolve via the fake");
        let workflow_step = InstallStep::RegisterWorkflow(resolved.workflows[0].canonical_id.clone());
        assert!(plan.contains(&workflow_step));
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
        let m = minimal(r#",
            "triggers": [{ "id": "", "name": "T", "type": "eventbus" }]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("trigger #0"), "got: {err}");
    }

    #[test]
    fn rejects_duplicate_ids_within_kind() {
        let m = minimal(r#",
            "triggers": [
                { "id": "foo", "name": "Foo", "type": "eventbus" },
                { "id": "foo", "name": "Foo Two", "type": "eventbus" }
            ]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("duplicate"), "got: {err}");
    }

    #[test]
    fn allows_same_id_across_different_kinds() {
        let m = minimal(r#",
            "triggers": [{ "id": "play_alert", "name": "T", "type": "eventbus" }],
            "functions": [{ "id": "play_alert", "name": "F", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "play_alert", "name": "A", "type": "function", "function": "play_alert" }]"#);
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
        let m = minimal(r#",
            "functions": [{ "id": "play_alert", "name": "F", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "play.alert", "name": "A", "type": "function", "function": "play_alert" }]"#);
        let r = validate(&m).expect("ok");
        match &r.actions[0].implementation {
            ResolvedActionImpl::Function { canonical_function_id } => {
                assert_eq!(canonical_function_id.to_string(), "test_mod:function:play_alert");
            }
        }
    }

    #[test]
    fn function_action_passes_through_full_canonical_id() {
        let m = minimal(r#",
            "actions": [{
                "id": "x",
                "name": "X",
                "type": "function",
                "function": "other_mod:function:bar"
            }]"#);
        let r = validate(&m).expect("ok");
        match &r.actions[0].implementation {
            ResolvedActionImpl::Function { canonical_function_id } => {
                assert_eq!(canonical_function_id.to_string(), "other_mod:function:bar");
            }
        }
    }

    #[test]
    fn rejects_unresolved_function_reference() {
        let m = minimal(r#",
            "actions": [{ "id": "x", "name": "X", "type": "function", "function": "missing" }]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("does not match"), "got: {err}");
    }

    #[test]
    fn rejects_canonical_reference_with_wrong_kind() {
        let m = minimal(r#",
            "actions": [{
                "id": "x",
                "name": "X",
                "type": "function",
                "function": "other_mod:trigger:bar"
            }]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("does not match expected kind"), "got: {err}");
    }

    #[test]
    fn rejects_function_action_with_empty_function_field() {
        let m = minimal(r#",
            "actions": [{ "id": "x", "name": "X", "type": "function", "function": "" }]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("function"), "got: {err}");
    }

    #[test]
    fn resolves_workflow_trigger_and_step_actions() {
        let m = minimal(r#",
            "triggers": [{ "id": "channel_subscribe", "name": "T", "type": "eventbus" }],
            "functions": [{ "id": "play_alert", "name": "F", "runtime": "lua", "path": "f.lua" }],
            "actions": [{ "id": "play_alert", "name": "A", "type": "function", "function": "play_alert" }],
            "workflows": [{
                "id": "on_subscribe",
                "name": "W",
                "trigger": "channel_subscribe",
                "steps": [{ "action": "play_alert" }]
            }]"#);
        let r = validate(&m).expect("ok");
        let wf = &r.workflows[0];
        assert_eq!(wf.canonical_id.to_string(), "test_mod:workflow:on_subscribe");
        assert_eq!(wf.trigger.to_string(), "test_mod:trigger:channel_subscribe");
        assert_eq!(wf.step_actions.len(), 1);
        assert_eq!(wf.step_actions[0].to_string(), "test_mod:action:play_alert");
    }

    #[test]
    fn rejects_workflow_with_unknown_trigger() {
        let m = minimal(r#",
            "workflows": [{
                "id": "x",
                "name": "X",
                "trigger": "missing",
                "steps": []
            }]"#);
        let err = validate(&m).unwrap_err().to_string();
        assert!(err.contains("does not match"), "got: {err}");
    }

    #[test]
    fn resolves_command_workflow_and_widget_accepted_events() {
        let m = minimal(r#",
            "triggers": [{ "id": "t1", "name": "T1", "type": "eventbus" }],
            "workflows": [{ "id": "w1", "name": "W1", "trigger": "t1", "steps": [] }],
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix", "workflow": "w1" }],
            "widgets": [{ "id": "wd1", "name": "Wd1", "acceptedEvents": ["t1"] }]"#);
        let r = validate(&m).expect("ok");
        assert_eq!(
            r.commands[0].workflow.as_ref().unwrap().to_string(),
            "test_mod:workflow:w1"
        );
        assert_eq!(
            r.widgets[0].accepted_events[0].to_string(),
            "test_mod:trigger:t1"
        );
    }

    #[test]
    fn command_without_workflow_resolves_to_none() {
        let m = minimal(r#",
            "commands": [{ "id": "c1", "name": "C1", "pattern": "!c1", "type": "prefix" }]"#);
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
        assert_eq!(r.assets[0].canonical_id.to_string(), "test_mod:asset:victory");
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
}
