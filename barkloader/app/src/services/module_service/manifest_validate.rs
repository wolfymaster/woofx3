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
use std::collections::HashMap;

use super::canonical_id::{
    looks_like_canonical_id, validate_segment, CanonicalId, ResourceKind,
    CANONICAL_ID_SEPARATOR,
};
use super::module_manifest::{
    ManifestAction, ManifestActionImpl, ManifestAsset, ManifestCommand, ManifestFunction,
    ManifestOverlay, ManifestResourceKind, ManifestTrigger, ManifestWorkflow, ModuleManifest,
    ModuleWidget,
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
    pub manifest_index: usize,
}

#[derive(Debug, Clone)]
pub struct ResolvedAction {
    pub canonical_id: CanonicalId,
    pub manifest_index: usize,
    pub implementation: ResolvedActionImpl,
}

#[derive(Debug, Clone)]
pub struct ResolvedFunction {
    pub canonical_id: CanonicalId,
    pub manifest_index: usize,
}

#[derive(Debug, Clone)]
pub struct ResolvedCommand {
    pub canonical_id: CanonicalId,
    pub manifest_index: usize,
    pub workflow: Option<CanonicalId>,
}

#[derive(Debug, Clone)]
pub struct ResolvedWorkflow {
    pub canonical_id: CanonicalId,
    pub manifest_index: usize,
    pub trigger: CanonicalId,
    pub step_actions: Vec<CanonicalId>,
}

#[derive(Debug, Clone)]
pub struct ResolvedWidget {
    pub canonical_id: CanonicalId,
    pub manifest_index: usize,
    pub accepted_events: Vec<CanonicalId>,
}

#[derive(Debug, Clone)]
pub struct ResolvedOverlay {
    pub canonical_id: CanonicalId,
    pub manifest_index: usize,
}

#[derive(Debug, Clone)]
pub struct ResolvedAsset {
    pub canonical_id: CanonicalId,
    pub manifest_index: usize,
}

/// A validated resource-kind declaration. Resource kinds are open-ended
/// strings (no fixed enum) declared by modules to describe the runtime
/// instances they're the controller for — see [`ManifestResourceKind`]
/// and `docs/barkloader/modules.md`. Unlike surface kinds, they don't
/// carry their own canonical id; instead, instances of the kind get
/// `{moduleId}:{kind}:{instanceId}` canonical ids at runtime.
#[derive(Debug, Clone)]
pub struct ResolvedResourceKind {
    pub kind: String,
    pub manifest_index: usize,
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
    pub resource_kinds: Vec<ResolvedResourceKind>,
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
    let resource_kinds = validate_resource_kinds(&manifest.resources)?;

    // Pass 2: resolve references for kinds that have them.
    let triggers = entries_to_resolved(&triggers_table, |e| ResolvedTrigger {
        canonical_id: e.canonical_id.clone(),
        manifest_index: e.manifest_index,
    });
    let functions = entries_to_resolved(&functions_table, |e| ResolvedFunction {
        canonical_id: e.canonical_id.clone(),
        manifest_index: e.manifest_index,
    });
    let overlays = entries_to_resolved(&overlays_table, |e| ResolvedOverlay {
        canonical_id: e.canonical_id.clone(),
        manifest_index: e.manifest_index,
    });
    let assets = entries_to_resolved(&assets_table, |e| ResolvedAsset {
        canonical_id: e.canonical_id.clone(),
        manifest_index: e.manifest_index,
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
        resource_kinds,
    })
}

/// Validate `manifest.resources[]`: every kind must be non-empty,
/// well-formed per [`validate_segment`], and unique within this manifest.
/// Resource kinds are not canonical-id'd themselves (instances are), so
/// this is intentionally a flat check rather than a [`build_kind_table`]
/// call.
fn validate_resource_kinds(items: &[ManifestResourceKind]) -> Result<Vec<ResolvedResourceKind>> {
    let mut seen: HashMap<String, usize> = HashMap::with_capacity(items.len());
    let mut out = Vec::with_capacity(items.len());
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
        out.push(ResolvedResourceKind {
            kind: kind.to_string(),
            manifest_index: i,
        });
    }
    Ok(out)
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
        if trimmed.starts_with('/') || trimmed.starts_with('\\') {
            return Err(anyhow!(
                "asset #{i} ({}): `path` must be relative to the module root, got {:?}",
                a.id,
                a.path
            ));
        }
        // Reject `..` segments — same guard the asset proxy used to apply,
        // applied earlier in the pipeline.
        for segment in trimmed.split(['/', '\\']) {
            if segment == ".." {
                return Err(anyhow!(
                    "asset #{i} ({}): `path` must not contain `..` segments, got {:?}",
                    a.id,
                    a.path
                ));
            }
        }
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
            manifest_index: entry.manifest_index,
            implementation,
        });
    }
    out.sort_by_key(|r| r.manifest_index);
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
            manifest_index: entry.manifest_index,
            workflow,
        });
    }
    out.sort_by_key(|r| r.manifest_index);
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
            manifest_index: entry.manifest_index,
            trigger,
            step_actions,
        });
    }
    out.sort_by_key(|r| r.manifest_index);
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
            manifest_index: entry.manifest_index,
            accepted_events,
        });
    }
    out.sort_by_key(|r| r.manifest_index);
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
