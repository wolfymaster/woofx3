use anyhow::{anyhow, Result};
use std::collections::HashMap;
use lib_repository::{CreateFileRequest, Repository};
use tracing::{info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::module_file::ModuleFile;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestTrigger {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Trigger transport / category (e.g. `eventbus`, `webhook`,
    /// `schedule`). Determines how the trigger is wired up at install
    /// time. Distinct from `event` (which is the NATS subject the
    /// trigger fires on for `eventbus` triggers).
    #[serde(rename = "type", default)]
    pub trigger_type: String,
    /// The NATS subject this trigger fires on (for `eventbus`-type
    /// triggers). Persisted as `triggers.event`. The trigger's `id` is
    /// the manifest-local identifier and is **not** the same as the
    /// subject — the two were conflated in earlier versions.
    #[serde(default)]
    pub event: String,
    /// Legacy UX / registry grouping (e.g. `platform.twitch`). Superseded by
    /// `taxonomy`; still accepted from older manifests and folded into
    /// `taxonomy` at registration time (see `resolve_taxonomy`).
    #[serde(default)]
    pub category: Option<String>,
    /// Open, multi-valued classification for the UI catalog — each entry a
    /// dotted hierarchical path (e.g. `platform.twitch.chat`,
    /// `function.chat`). Multiple entries express independent
    /// classification axes on the same trigger. Not validated against any
    /// fixed vocabulary; module authors are free to introduce new terms.
    #[serde(default)]
    pub taxonomy: Vec<String>,
    /// The fields a user fills in when wiring this trigger to a workflow.
    /// A bare array - see `ManifestConfigField`.
    #[serde(default)]
    pub schema: Option<Vec<ManifestConfigField>>,
    /// What `trigger.data` carries when this trigger fires:
    /// `{ "fields": [{ "path": "user_name", "type": "string" }] }`.
    ///
    /// Distinct from `schema`, which is the trigger's *configuration form*.
    /// Only config fields carrying an `eventPath` become workflow variables,
    /// so a trigger emitting payload keys it does not also expose as config
    /// fields has no way to advertise them without this. Absent means the
    /// builder falls back to deriving variables from `schema`, exactly as it
    /// does today.
    ///
    /// Not called a schema on purpose: nothing validates an event payload
    /// against it. It answers "which paths can be referenced".
    #[serde(default)]
    pub emits: Option<ManifestDataShape>,
    /// When true, the UI lets the user create multiple bound instances ("variants")
    /// of this trigger, each with its own values for the `schema` fields. Used for
    /// triggers like cheer/subscribe/subscription.gift where the same event class
    /// fans out into per-tier or per-threshold workflows.
    #[serde(default)]
    pub allow_variants: bool,
}

/// Action implementation — discriminated by `type` (matches an engine
/// action handler). Each variant carries the handler-specific config at
/// the same JSON object level as `type`, mirroring how `TaskDefinition`
/// puts `wait`/`workflow`/etc. configs at the top level next to `type`.
///
/// New variants are added when new built-in action handlers ship in the
/// engine; modules don't add new variants — they instantiate existing
/// ones with module-specific config (e.g. a different function id).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ManifestActionImpl {
    /// `type: "function"` — invokes a sandboxed module function via
    /// barkloader. The `function` field is the manifest-local function
    /// id; install resolves it to the function's canonical id.
    Function {
        /// Manifest-local function id, or a full canonical id for
        /// cross-module function references.
        function: String,
    },
    /// `type: "native"` — dispatches to a handler compiled into the
    /// workflow engine (`alert`, `print`), with no sandboxed function
    /// behind it. This is what lets those handlers be *declared* by a
    /// manifest instead of hand-registered in `workflow/app.go`.
    ///
    /// Restricted to system-provenance installs: an upload that could
    /// name an engine handler would be a way to bind workflow steps to
    /// arbitrary engine internals. Enforced in `manifest_validate`.
    Native {
        /// Engine action handler name, matching a `RegisterAction` call in
        /// the workflow engine.
        handler: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAction {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Action handler + its handler-specific config. Flattened so the
    /// JSON has `{ "type": "function", "function": "..." }` rather than
    /// nesting under an `implementation` key.
    #[serde(flatten)]
    pub implementation: ManifestActionImpl,
    /// The fields a user fills in when wiring this action into a workflow
    /// step. A bare array - see `ManifestConfigField`. Distinct from a
    /// workflow step's `parameters`, which are the values a user supplies per
    /// invocation.
    #[serde(default)]
    pub schema: Vec<ManifestConfigField>,
    /// Open, multi-valued classification for the UI catalog. See
    /// `ManifestTrigger::taxonomy` for the shape/convention.
    #[serde(default)]
    pub taxonomy: Vec<String>,
    /// What this action's function hands back:
    /// `{ "fields": [{ "path": "next", "type": "number" }] }`. Feeds the
    /// workflow builder's `${stepId.field}` autocomplete.
    ///
    /// Replaces the older `outputs` key, which said the same thing in
    /// `ConfigField` shape — form vocabulary (`label`, `placeholder`,
    /// `options`) that means nothing for a returned value, and no way to
    /// express a nested path or an example.
    ///
    /// Not called a schema on purpose: the engine treats a function result as
    /// an opaque map and never validates it against this.
    #[serde(default)]
    pub returns: Option<ManifestDataShape>,
}

/// One field a user fills in.
///
/// The same shape for a trigger's `schema`, an action's `schema`, a widget's
/// `settingsSchema` and a module's `settings` - all four mean "render this
/// input, collect this value", and described a field differently only because
/// they were built at different times. There are no accepted aliases: `key`,
/// `fieldType`, `name` and `default` are rejected, so every consumer handles
/// exactly one spelling.
///
/// Unknown properties are rejected rather than ignored, so a typo is reported
/// at install instead of silently rendering a control that misses half its
/// configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestConfigField {
    /// Stable field id; the key the collected value is stored under.
    pub id: String,
    pub label: String,
    /// One of `CONFIG_FIELD_TYPES`. Validated at install rather than as a
    /// serde enum so an unrecognised token reports the offending field and
    /// the accepted set, instead of a bare "unknown variant".
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub options: Option<Vec<ManifestConfigFieldOption>>,
    /// Dynamic option source, e.g. a NATS request/reply descriptor. Opaque
    /// here and forwarded for the consumer to interpret.
    #[serde(default)]
    pub source: Option<serde_json::Value>,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub default_value: Option<serde_json::Value>,
    #[serde(default)]
    pub media_type: Option<String>,
    /// For `type: "asset"` - filter the picker by `ManifestAsset.kind`.
    #[serde(default)]
    pub kinds: Option<Vec<String>>,
    /// Required for `type: "resource_ref"` - which resource kind to list.
    #[serde(default)]
    pub resource_kind: Option<String>,
    /// Present only on `type: "button"`, which collects no value and instead
    /// fires a request. Opaque here.
    #[serde(default)]
    pub action: Option<serde_json::Value>,
    /// Trigger config only - binds this field to a path in the event payload.
    #[serde(default)]
    pub event_path: Option<String>,
    /// Trigger config only - the comparison emitted with this field's value.
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
    /// A JSON-encoded example of the event payload this field reads from,
    /// rendered in the field's info popover. An illustration, not a
    /// declaration - see `ManifestTrigger::emits` for the machine-readable one.
    #[serde(default)]
    pub example_payload: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestConfigFieldOption {
    pub value: String,
    pub label: String,
}

/// The accepted `type` tokens. Mirrors `CONFIG_FIELD_TYPES` in
/// `shared/clients/typescript/api/ui-schema.ts` - the two must not drift.
///
/// `text` and `toggle` rather than `string` and `boolean`: these name the
/// control, not the stored value, and the latter pair only ever appeared on
/// module settings.
pub const CONFIG_FIELD_TYPES: [&str; 10] = [
    "number",
    "range",
    "text",
    "select",
    "media",
    "toggle",
    "color",
    "asset",
    "resource_ref",
    "button",
];

/// A flat list of the paths a runtime value carries, with their types.
///
/// Deliberately not JSON Schema: it matches `${trigger.data.X}` /
/// `${tasks.<id>.<key>}` access exactly and renders straight into a variable
/// picker, which is the only question anything asks of it. Nothing validates a
/// payload or a function result against it, so it carries no `required`, no
/// nesting and no constraints — those would all be promises the engine does
/// not keep.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestDataShape {
    #[serde(default)]
    pub fields: Vec<ManifestDataShapeField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDataShapeField {
    /// Dot path into the value, e.g. `"bits"` or `"channel.title"`.
    pub path: String,
    /// One of `DATA_SHAPE_FIELD_TYPES`. Validated at install time rather than
    /// as a serde enum so an unrecognised token reports the offending field
    /// and the accepted set, instead of a bare "unknown variant".
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub example: Option<serde_json::Value>,
}

/// The accepted `type` tokens for a data-shape field. Closed on purpose: this
/// drives a picker's rendering, so an unrecognised token is an author mistake
/// worth reporting rather than an extension point.
pub const DATA_SHAPE_FIELD_TYPES: [&str; 6] =
    ["string", "number", "boolean", "array", "object", "unknown"];

/// Serialize a declared shape for the wire, or `"{}"` when the manifest
/// declared none.
///
/// `"{}"` rather than `"null"`: the db column is NOT NULL and every consumer
/// parses this as an object, so "declared nothing" needs no null branch
/// anywhere. The gateway drops the `"{}"` again rather than forwarding it, so
/// an undeclared shape never reads as one declaring zero fields.
/// Serialize a field list for the wire, or `"[]"` when none was declared.
///
/// Always a bare array: the contract has one container shape, and re-emitting
/// what serde parsed is what guarantees it — an author cannot smuggle a
/// different one through, because anything else failed to deserialize.
fn encode_field_list(fields: Option<&[ManifestConfigField]>) -> String {
    match fields {
        Some(fields) => serde_json::to_string(fields).unwrap_or_else(|_| "[]".to_string()),
        None => "[]".to_string(),
    }
}

fn encode_data_shape(shape: Option<&ManifestDataShape>) -> String {
    match shape {
        Some(shape) => serde_json::to_string(shape).unwrap_or_else(|_| "{}".to_string()),
        None => "{}".to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFunction {
    pub id: String,
    pub name: String,
    pub runtime: String,
    pub path: String,
    #[serde(default)]
    pub entry_point: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCommand {
    pub id: String,
    pub name: String,
    pub pattern: String,
    #[serde(rename = "type")]
    pub pattern_type: String,
    #[serde(default)]
    pub workflow: Option<String>,
    #[serde(default)]
    pub required_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWorkflowStep {
    /// Optional explicit step id. When omitted, install generates
    /// `{moduleId}-{workflowId}-{index}`.
    #[serde(default)]
    pub id: Option<String>,
    /// Workflow engine step type — defaults to `"action"` since that is
    /// the only step type a manifest can declare today. Future manifest
    /// support for `wait` / `condition` / etc. would surface here.
    #[serde(rename = "type", default = "default_step_type")]
    pub step_type: String,
    /// Manifest-local action id (or full canonical id for cross-module
    /// references). Resolved at install.
    pub action: String,
    /// Per-invocation parameters — author-supplied values that flow to
    /// the action handler at runtime. Schema is action-handler defined.
    #[serde(default)]
    pub parameters: serde_json::Value,
}

fn default_step_type() -> String {
    "action".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWorkflow {
    pub id: String,
    pub name: String,
    pub trigger: String,
    #[serde(default)]
    pub steps: Vec<ManifestWorkflowStep>,
    /// Open, multi-valued classification for the UI catalog. See
    /// `ManifestTrigger::taxonomy` for the shape/convention.
    #[serde(default)]
    pub taxonomy: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestOverlay {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub entry: String,
}

/// A static asset bundled with a module — typically image / audio /
/// video / font files that workflow authors reference from action
/// parameters. The engine uploads each declared asset into the
/// configured repository at install time (mirroring the function and
/// widget upload paths) and emits a `module.asset.registered` event so
/// the workflow editor can present an asset picker for actions whose
/// schema declares an `"asset"`-typed field.
///
/// Asset URL resolution (repository key → public CDN URL) is the
/// deployer's concern; the engine only declares "this file exists in
/// my repository at this path."
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAsset {
    /// Manifest-local id, scoped to this module. Combined with the
    /// module id at install to form `{moduleId}:asset:{id}`. Workflow
    /// definitions reference assets by canonical id, never by raw path.
    pub id: String,
    /// Display name for the asset picker.
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Relative path inside the module zip, e.g. `assets/bell.mp3`
    /// (the module root, not a directory implicitly named `assets/`).
    /// Resolved via `resolve_zip_file` at install time; the resulting
    /// bytes are written into the repository under
    /// `modules/{module_key}/{path}` — do not prepend another
    /// `assets/` segment, since `path` already carries it.
    pub path: String,
    /// Optional broad-category hint for the editor's UI filter:
    /// `"image" | "audio" | "video" | "font" | "data"`. Free-form;
    /// the engine doesn't validate values.
    #[serde(default)]
    pub kind: Option<String>,
    /// Optional MIME type override. When omitted, the deployer / CDN
    /// derives one from the file extension.
    #[serde(default)]
    pub content_type: Option<String>,
}

/// Resource-kind declaration. Lists the kinds of runtime instances this
/// module is the controller for — the K8s CRD analog. Each declared
/// kind enables `resource_ref(kind=...)` config fields elsewhere in the
/// system to pick instances of this kind, and lets the engine attribute
/// instance ownership at uninstall time.
///
/// The engine learns identity (kind name, owning module) but never
/// learns what the kind *means*. Mutation operations, value storage,
/// and validation all live in the owning module's functions / commands.
///
/// `schema` is the form shown when creating an instance of this kind - the
/// same `ManifestConfigField` list every other surface uses. The engine never
/// renders it and never validates an instance's value against it; it forwards
/// the declaration so the UI can build the form.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestResourceKind {
    /// Open kind string. Validates per `validate_segment`
    /// (`[A-Za-z0-9._-]+`). Forms the middle segment of instance
    /// canonical ids: `{moduleId}:{kind}:{instanceId}`.
    pub kind: String,
    /// Display name (singular) shown in pickers and management UIs.
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Optional asset-or-icon canonical id for picker UX.
    #[serde(default)]
    pub icon: Option<String>,
    /// The fields a user fills in to create an instance of this kind.
    ///
    /// Was `valueSchema`, a JSON-Schema-ish blob describing the stored
    /// *value* (`{"type":"number","default":0}`). Its documented purpose was
    /// always to drive a create-form, but nothing could render it: a form
    /// needs an id, a label and a control type per input, none of which that
    /// shape carries. Declaring it as fields makes the stated purpose
    /// achievable and removes the last vocabulary that was not
    /// `ManifestConfigField`.
    #[serde(default)]
    pub schema: Vec<ManifestConfigField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleWidget {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub entry: Option<String>,
    #[serde(default)]
    pub assets: Option<String>,
    /// The fields a user fills in when placing this widget on a scene. A bare
    /// array - see `ManifestConfigField`. Values come back to the widget at
    /// render time as `widgetHost.settings`.
    #[serde(default)]
    pub settings_schema: Option<Vec<ManifestConfigField>>,
    /// Canonical trigger ids (e.g. `twitch_platform:trigger:follow.channel.twitch`)
    /// the widget consumes. Resolved at install via `manifest_validate.rs` to
    /// confirm those triggers actually exist in the engine — this is the
    /// engine-internal reference graph.
    #[serde(default)]
    pub accepted_events: Vec<String>,
    /// AlertContext.type strings the widget renders (e.g. `["follow"]`,
    /// `["raid"]`, `["follow", "cheer", "raid"]`). What the Convex scene
    /// manager filters on when wiring widgets to slot pipelines. When
    /// omitted, the engine derives this list at emission time by mapping
    /// each `accepted_events` canonical id to its AlertContext type via
    /// the same table the api/ AlertEmitter uses (see
    /// `api/src/alert-emitter.ts`). Authors typically only set this when
    /// the widget cares about a coarser bucket than the canonical ids
    /// imply, or wants to opt in to events the engine doesn't emit yet.
    #[serde(default)]
    pub alert_types: Vec<String>,
}

/// Background task declared in the module manifest. Barkloader's internal
/// scheduler picks these up at module install / reload and fires the named
/// function on the given cron schedule for the lifetime of the module.
/// Tasks are purely runtime-managed — they are not persisted as workflow,
/// action, or trigger rows in the system database.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestBackgroundTask {
    pub id: String,
    /// Manifest-local function id to invoke (e.g. `"poll_current_track"`).
    pub function: String,
    /// Cron expression controlling the fire rate (e.g. `"*/30 * * * * *"`).
    pub schedule: String,
    #[serde(default)]
    pub description: String,
}

/// A setting declared in the module manifest. Values are stored in the
/// `module_settings` table keyed by `module_id` + `id`. Type must be one of
/// `CONFIG_FIELD_TYPES`.
/// A module-level setting.
///
/// Same field vocabulary as every other surface - `id`, `label`, `type`,
/// `defaultValue` - because it means the same thing: render an input, collect
/// a value. It was previously spelled `name` / `default`, which is exactly the
/// divergence this contract removes.
///
/// What is genuinely different is storage, not description: these values
/// persist engine-side in `module_settings` and are read by sandboxed
/// functions as `ctx.module.settings`, where a trigger's or widget's values
/// live UI-side. That is why this stays its own struct rather than becoming a
/// plain `ManifestConfigField`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestSetting {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "type")]
    pub setting_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default_value: Option<String>,
    /// Present only when `type: "button"` — `{ kind: "internal", request: {...},
    /// timeoutMs? } | { kind: "integration", integration: "..." }`. Opaque to
    /// the engine and forwarded verbatim so the UI can interpret it.
    /// `RegisterModuleSettings` skips settings with this present — buttons
    /// have no stored value.
    #[serde(default)]
    pub action: serde_json::Value,
}

impl ManifestSetting {
    /// Returns the value to insert when no user value exists yet.
    pub fn resolved_default(&self) -> String {
        if let Some(v) = &self.default_value {
            return v.clone();
        }
        match self.setting_type.as_str() {
            "number" => "0".to_string(),
            "toggle" => "false".to_string(),
            _ => String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Manifest-declared author / publisher of the module. Preserved through
    /// the install round-trip so the UI catalog can surface it; absent for
    /// modules whose author predates this field.
    #[serde(default)]
    pub author: Option<String>,
    /// Legacy UI catalog grouping for the module as a whole (e.g.
    /// `platform`, `automation`). Superseded by `taxonomy`; still accepted
    /// from older manifests and folded into `taxonomy` at registration time
    /// (see `resolve_taxonomy`).
    #[serde(default)]
    pub category: Option<String>,
    /// Open, multi-valued classification for the UI catalog. See
    /// `ManifestTrigger::taxonomy` for the shape/convention.
    #[serde(default)]
    pub taxonomy: Vec<String>,
    #[serde(default)]
    pub triggers: Vec<ManifestTrigger>,
    #[serde(default)]
    pub actions: Vec<ManifestAction>,
    #[serde(default)]
    pub functions: Vec<ManifestFunction>,
    #[serde(default)]
    pub commands: Vec<ManifestCommand>,
    #[serde(default)]
    pub workflows: Vec<ManifestWorkflow>,
    #[serde(default)]
    pub widgets: Vec<ModuleWidget>,
    #[serde(default)]
    pub overlays: Vec<ManifestOverlay>,
    /// Static media bundled with the module — see [`ManifestAsset`]. The
    /// engine treats these as opaque blobs: writes them to the
    /// repository at install, lists them in the
    /// `module.asset.registered` webhook event, then steps out of the
    /// way. Action schemas reference them via `"asset"`-typed fields.
    #[serde(default)]
    pub assets: Vec<ManifestAsset>,
    /// Runtime-instance kind declarations — the K8s CRD analog. Other
    /// parts of the system (pickers, workflows, widgets) reference
    /// instances of these kinds by canonical id; the engine relies on
    /// the owning module to provide create / mutate / delete operations
    /// (typically as `commands` and `actions`).
    #[serde(default)]
    pub resources: Vec<ManifestResourceKind>,
    /// Background tasks declared by the module. The scheduler registers
    /// these at module install/reload and fires the referenced function on
    /// the given cron schedule until the module is unloaded or uninstalled.
    /// Accept both camelCase ("backgroundTasks") and snake_case ("background_tasks")
    /// since module authors commonly use either form.
    #[serde(default, alias = "background_tasks")]
    pub background_tasks: Vec<ManifestBackgroundTask>,
    /// Module-level settings declared in the manifest. Registered into the
    /// `module_settings` table at install time. Values survive upgrades.
    #[serde(default)]
    pub settings: Vec<ManifestSetting>,
}

impl ModuleManifest {
    pub fn module_key(&self) -> &str {
        &self.id
    }

    /// The ID component used in the composite module_id.
    /// Uses the manifest `id` field if non-empty, otherwise falls back to
    /// lowercase snake_case of the module name.
    #[allow(dead_code)]
    pub fn id_component(&self) -> String {
        let trimmed = self.id.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
        to_snake_case(&self.name)
    }

    /// Compute the composite module_key: `{id}:{version}:{hash}` where hash is
    /// the first 7 characters of the SHA-256 hex digest of the zip bytes.
    #[allow(dead_code)]
    pub fn compute_module_key(&self, zip_bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(zip_bytes);
        let hash = format!("{:x}", hasher.finalize());
        let short_hash = &hash[..7];
        format!("{}:{}:{}", self.id_component(), self.version, short_hash)
    }
}

#[allow(dead_code)]
fn dedup_preserve_order(items: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(items.len());
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for s in items {
        if seen.insert(s.clone()) {
            out.push(s.clone());
        }
    }
    out
}

#[allow(dead_code)]
fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('_');
            }
            result.push(c.to_ascii_lowercase());
        } else if c.is_whitespace() || c == '-' {
            result.push('_');
        } else {
            result.push(c);
        }
    }
    result
}

/// Normalize a manifest- or zip-declared relative path and reject any `..`
/// segment. Every repository key derived from a manifest/zip path funnels
/// through here — rejecting traversal at this single point (rather than only
/// at the manifest-string validation layer) means a crafted zip *member
/// name* (not just a declared `entry`/`assets`/`path` config string) can
/// never produce a `..`-containing repository key, which `lib_repository`'s
/// file backend would otherwise honor via `PathBuf::join`, writing outside
/// the configured storage root.
fn normalize_rel_path(s: &str) -> Result<String> {
    let normalized = s
        .trim_start_matches("./")
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if normalized.split('/').any(|segment| segment == "..") {
        return Err(anyhow!("path must not contain `..` segments, got {:?}", s));
    }
    Ok(normalized)
}

pub fn resolve_zip_file<'a>(files: &'a [ModuleFile], rel_path: &str) -> Option<&'a ModuleFile> {
    let rel = normalize_rel_path(rel_path).ok()?;
    if rel.is_empty() {
        return None;
    }
    files.iter().find(|f| {
        let n = match normalize_rel_path(&f.name) {
            Ok(n) => n,
            Err(_) => return false,
        };
        n == rel || n.ends_with(&format!("/{rel}")) || rel.ends_with(&n)
    })
}

fn extension_for_path(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_string()
}

/// Writes `contents` to `repository` at `repo_key`, skipping the write
/// entirely if that exact key already exists.
///
/// `repo_key` is expected to already carry a version-scoped directory
/// segment (see `run_install`'s `version_dir`) ahead of the file's
/// relative path, so this is content-addressed at the *version* level:
/// re-running an install with byte-identical content (a retry, or a
/// rollback to a version whose files are still present) is a no-op
/// here, while a genuine version bump always writes to a fresh
/// directory rather than overwriting the previous version's bytes —
/// which is what makes rollback possible.
async fn upload_content_addressed<R: Repository>(
    repository: &R,
    repo_key: &str,
    contents: &[u8],
    extension: String,
) -> Result<()> {
    if repository.exists(repo_key).await.unwrap_or(false) {
        return Ok(());
    }
    let req = CreateFileRequest {
        content: Some(contents.to_vec()),
        extension: Some(extension),
        file_name: repo_key.to_string(),
    };
    let mut failed = Vec::new();
    repository.create([req], &mut failed).await?;
    if failed.is_empty() {
        Ok(())
    } else {
        Err(anyhow!("Failed to store file at {}", repo_key))
    }
}

impl ManifestFunction {
    pub async fn upload_to_repository<R: Repository>(
        &self,
        module_key: &str,
        version_dir: &str,
        files: &[ModuleFile],
        repository: &R,
    ) -> Result<String> {
        let file = resolve_zip_file(files, &self.path).ok_or_else(|| {
            anyhow!(
                "Function {}: path '{}' not found in module archive",
                self.id,
                self.path
            )
        })?;
        // Manifest paths are relative to the module root (e.g.
        // `functions/sendChatMessage.js`). Do not prepend another
        // `functions/` segment — that produced `functions/functions/...`.
        let rel_in_module = normalize_rel_path(&self.path)?;
        let repo_key = format!("modules/{module_key}/{version_dir}/{rel_in_module}");
        let ext = extension_for_path(&self.path);
        upload_content_addressed(repository, &repo_key, &file.contents, ext).await?;
        info!("Stored function {} at {}", self.id, repo_key);
        Ok(repo_key)
    }
}

impl ManifestAsset {
    /// Resolve the asset's path inside the module zip and write the
    /// bytes into the engine's repository under
    /// `modules/{module_key}/{version_dir}/{rel_in_module}`. Mirror of
    /// `ManifestFunction::upload_to_repository` — same failure modes,
    /// same key shape. `rel_in_module` (== `self.path`, normalized)
    /// already carries whatever directory the author put the file
    /// under in the zip (conventionally `assets/`, e.g.
    /// `assets/bell.mp3`) — do not prepend another `assets/` segment
    /// here, that produces `assets/assets/...`.
    pub async fn upload_to_repository<R: Repository>(
        &self,
        module_key: &str,
        version_dir: &str,
        files: &[ModuleFile],
        repository: &R,
    ) -> Result<String> {
        let file = resolve_zip_file(files, &self.path).ok_or_else(|| {
            anyhow!(
                "Asset {}: path '{}' not found in module archive",
                self.id,
                self.path
            )
        })?;
        let rel_in_module = normalize_rel_path(&self.path)?;
        let repo_key = format!("modules/{module_key}/{version_dir}/{rel_in_module}");
        let ext = extension_for_path(&self.path);
        upload_content_addressed(repository, &repo_key, &file.contents, ext).await?;
        info!("Stored asset {} at {}", self.id, repo_key);
        Ok(repo_key)
    }

    /// Build the Twirp `AssetInput` JSON for bulk registration. Pairs
    /// the manifest fields with the engine-side `repository_key`
    /// produced by `upload_to_repository`.
    pub fn to_input(&self, repository_key: String) -> super::db_proxy::AssetInputJson {
        super::db_proxy::AssetInputJson {
            manifest_id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone().unwrap_or_default(),
            manifest_path: self.path.clone(),
            repository_key,
            kind: self.kind.clone().unwrap_or_default(),
            content_type: self.content_type.clone().unwrap_or_default(),
        }
    }
}

impl ManifestTrigger {
    /// Taxonomy for `RegisterTrigger` and install-time grouping: manifest
    /// `taxonomy` when non-empty, otherwise the legacy `category` (trimmed,
    /// wrapped in a single-element list) when set, otherwise transport/type
    /// (`type` field, e.g. `eventbus`) as a last resort.
    pub fn resolve_taxonomy(&self) -> Vec<String> {
        if !self.taxonomy.is_empty() {
            return self.taxonomy.clone();
        }
        match self
            .category
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            Some(category) => vec![category.to_owned()],
            None => vec![self.trigger_type.clone()],
        }
    }

    /// Build the Twirp TriggerInput JSON for bulk registration.
    ///
    /// The trigger row's `event` field is the actual NATS subject the
    /// trigger fires on — that's what publishers (twitch service, etc.)
    /// emit on the bus and what workflows subscribe to. By today's
    /// manifest convention the `id` field also serves as that event
    /// subject; if we ever split the two we'll thread the separate event
    /// subject in here.
    ///
    /// Note: the trigger's *canonical id* (`{moduleId}:trigger:{id}`) is
    /// a separate concept used for reference tracking — it lives on the
    /// `module_resources` ledger and in workflow `$ref` fields, never on
    /// the trigger row itself.
    pub fn to_input(&self) -> super::db_proxy::TriggerInputJson {
        let config_schema = encode_field_list(self.schema.as_deref());
        // Manifest authors give us `event` (the NATS subject) and `id`
        // (the manifest-local identifier). Older manifests put the
        // subject in `id` and left `event` empty; for that case we fall
        // back to `id` so existing test fixtures still load. New
        // manifests should always set `event` explicitly.
        let event = if self.event.is_empty() {
            self.id.clone()
        } else {
            self.event.clone()
        };
        super::db_proxy::TriggerInputJson {
            taxonomy: self.resolve_taxonomy(),
            name: self.name.clone(),
            description: self.description.clone(),
            event,
            config_schema,
            emits: encode_data_shape(self.emits.as_ref()),
            allow_variants: self.allow_variants,
            manifest_id: self.id.clone(),
        }
    }
}

fn widget_asset_prefix(assets: &str) -> Result<String> {
    Ok(normalize_rel_path(assets)?.trim_end_matches('/').to_string() + "/")
}

/// Map a canonical trigger id (e.g.
/// `twitch_platform:trigger:follow.channel.twitch`) to the AlertContext.type
/// the engine emits for that event. Returns `None` for triggers that
/// don't translate to an alert (chat messages, internal events, etc.) —
/// those widgets must declare `alert_types` explicitly in the manifest.
///
/// This table mirrors `api/src/alert-emitter.ts` mappers — keep in sync
/// when the AlertContext type union grows.
#[allow(dead_code)]
pub fn alert_type_for_canonical(canonical: &str) -> Option<&'static str> {
    let event = canonical.rsplit(':').next().unwrap_or(canonical);
    match event {
        "follow.channel.twitch" => Some("follow"),
        "cheer.channel.twitch" => Some("cheer"),
        "subscribe.channel.twitch" => Some("subscribe"),
        "subscriptionGift.channel.twitch" => Some("sub_gift"),
        "hypetrain.channel.twitch" => Some("hypetrain"),
        "raid.channel.twitch" => Some("raid"),
        "online.channel.twitch" => Some("stream_online"),
        _ => None,
    }
}

impl ModuleWidget {
    /// Resolve the wire-format alert_types this widget exposes to the
    /// Convex scene manager. Prefers the manifest's explicit `alert_types`
    /// if present; otherwise derives the list from `accepted_events` using
    /// the AlertContext.type lookup table. Canonical ids that don't map to
    /// an AlertContext type are skipped. Order is preserved, duplicates
    /// removed.
    pub fn resolved_alert_types(&self) -> Vec<String> {
        if !self.alert_types.is_empty() {
            return dedup_preserve_order(&self.alert_types);
        }
        let mut out: Vec<String> = Vec::new();
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for ev in &self.accepted_events {
            if let Some(t) = alert_type_for_canonical(ev) {
                if seen.insert(t) {
                    out.push(t.to_string());
                }
            }
        }
        out
    }

    /// Normalize the manifest `entry` path relative to the widget asset
    /// root (the `assets` directory). The registered widget row and the
    /// repository both use this assets-relative form, so
    /// `modules/{module_key}/widgets/{id}/{entry}` is always a valid
    /// repository key for the entry file (design 5.2.5).
    ///
    /// Returns `Ok(None)` when no entry is declared. Errors when an
    /// entry is declared without an `assets` directory or points
    /// outside it — authoring constraint: `entry` must live inside
    /// `assets`.
    pub fn entry_relative_to_assets(&self) -> Result<Option<String>> {
        let Some(entry) = &self.entry else {
            return Ok(None);
        };
        let normalized = normalize_rel_path(entry)?;
        if normalized.is_empty() {
            return Err(anyhow!(
                "widget {}: `entry` must be a non-empty relative path",
                self.id
            ));
        }
        let Some(assets) = &self.assets else {
            return Err(anyhow!(
                "widget {}: `entry` {:?} requires an `assets` directory that contains it",
                self.id,
                entry
            ));
        };
        let prefix = widget_asset_prefix(assets)?;
        let rel = normalized.strip_prefix(&prefix).unwrap_or_default();
        if rel.is_empty() {
            return Err(anyhow!(
                "widget {}: `entry` {:?} must live inside the `assets` directory {:?}",
                self.id,
                entry,
                assets
            ));
        }
        Ok(Some(rel.to_string()))
    }

    /// Build the Twirp WidgetInput JSON for bulk registration. The engine
    /// db-proxy persists rows in `widgets` and emits the NATS outbox event
    /// that the api/ service forwards to Convex as `module.widget.registered`.
    ///
    /// `directory` is the manifest's `assets` bundle path (trimmed) — that's
    /// what streamware / Convex use to address widget files via the asset route.
    /// `entry` is assets-relative (see `entry_relative_to_assets`); empty
    /// means the consumer falls back to `index.html`.
    /// `settings_schema` is the manifest's `settingsSchema` value serialized;
    /// engine treats it opaquely.
    pub fn to_input(&self) -> super::db_proxy::WidgetInputJson {
        let description = self.description.clone().unwrap_or_default();
        let directory = self
            .assets
            .as_ref()
            .map(|a| {
                normalize_rel_path(a)
                    .map(|n| n.trim_end_matches('/').to_string())
                    .unwrap_or_else(|_| {
                        debug_assert!(
                            false,
                            "widget assets dir failed normalization after validation"
                        );
                        String::new()
                    })
            })
            .unwrap_or_default();
        let settings_schema = encode_field_list(self.settings_schema.as_deref());
        // Manifest validation rejects unnormalizable entries before any
        // registration runs, so the error arm is unreachable on the
        // install path; registering an empty entry there keeps this
        // projection infallible.
        let entry = match self.entry_relative_to_assets() {
            Ok(Some(rel)) => rel,
            Ok(None) => String::new(),
            Err(_) => {
                debug_assert!(false, "widget entry failed normalization after validation");
                String::new()
            }
        };
        super::db_proxy::WidgetInputJson {
            manifest_id: self.id.clone(),
            name: self.name.clone(),
            description,
            directory,
            alert_types: self.resolved_alert_types(),
            settings_schema,
            surface: "scene".to_string(),
            entry,
        }
    }

    async fn upload_one_file<R: Repository>(
        &self,
        module_key: &str,
        version_dir: &str,
        file: &ModuleFile,
        rel_under_widget: &str,
        repository: &R,
    ) -> Result<String> {
        let rel = normalize_rel_path(rel_under_widget)?;
        let repo_key = format!("modules/{module_key}/{version_dir}/widgets/{}/{rel}", self.id);
        let ext = extension_for_path(&file.name);
        upload_content_addressed(repository, &repo_key, &file.contents, ext).await?;
        Ok(repo_key)
    }

    pub async fn upload_assets<R: Repository>(
        &self,
        module_key: &str,
        version_dir: &str,
        files: &[ModuleFile],
        repository: &R,
    ) -> Result<Vec<String>> {
        let mut keys = Vec::new();

        // The entry is stored at its assets-relative key — the same key
        // shape the assets-dir walk below produces — so the registered
        // `entry` always resolves as
        // `modules/{module_key}/{version_dir}/widgets/{id}/{entry}`
        // (design 5.2.5, extended with the version-scoped directory so a
        // module upgrade never overwrites a previous version's widget
        // files — every file belonging to one version shares the same
        // `version_dir`, so relative references between sibling files,
        // e.g. `index.html` linking `style.css`, keep resolving
        // correctly). Manifest validation already guarantees the entry
        // normalizes; failing here means upload ran without validation.
        let entry_rel = self.entry_relative_to_assets()?;
        let mut entry_uploaded = false;
        if let (Some(entry), Some(rel)) = (&self.entry, &entry_rel) {
            if let Some(f) = resolve_zip_file(files, entry) {
                keys.push(self.upload_one_file(module_key, version_dir, f, rel, repository).await?);
                entry_uploaded = true;
            } else {
                warn!("Widget {} entry '{}' not found in archive", self.id, entry);
            }
        }

        if let Some(assets_dir) = &self.assets {
            let prefix = widget_asset_prefix(assets_dir)?;
            for file in files {
                // Reject rather than skip: a `..`-containing zip member name
                // anywhere in the archive is never legitimate (no tool
                // produces one), so treat it as a corrupt/malicious archive
                // and fail the whole widget upload rather than silently
                // dropping the offending file.
                let n = normalize_rel_path(&file.name).map_err(|e| {
                    anyhow!("widget {}: invalid file name in archive: {e}", self.id)
                })?;
                if !n.starts_with(&prefix) {
                    continue;
                }
                let rel_under = n.strip_prefix(&prefix).unwrap_or(&n).to_string();
                if rel_under.is_empty() {
                    continue;
                }
                if entry_uploaded && Some(&rel_under) == entry_rel.as_ref() {
                    // Already stored by the entry pass above.
                    continue;
                }
                keys.push(
                    self.upload_one_file(module_key, version_dir, file, &rel_under, repository)
                        .await?,
                );
            }
        }

        Ok(keys)
    }
}

impl ManifestOverlay {
    pub async fn upload_entry<R: Repository>(
        &self,
        module_key: &str,
        version_dir: &str,
        files: &[ModuleFile],
        repository: &R,
    ) -> Result<String> {
        let file = resolve_zip_file(files, &self.entry).ok_or_else(|| {
            anyhow!(
                "Overlay {}: entry '{}' not found in module archive",
                self.id,
                self.entry
            )
        })?;
        let rel = normalize_rel_path(&self.entry)?;
        let repo_key = format!("modules/{module_key}/{version_dir}/overlays/{}/{rel}", self.id);
        let ext = extension_for_path(&self.entry);
        upload_content_addressed(repository, &repo_key, &file.contents, ext).await?;
        Ok(repo_key)
    }
}

impl ManifestAction {
    /// Build the Twirp ActionInput JSON for bulk registration.
    ///
    /// `action_type` names the engine handler the row dispatches through and
    /// `resolved_call` is its invocation target; the install path derives both
    /// from the resolved `ManifestActionImpl`. A `function` action carries
    /// `type: "function"` and the canonical function id; a `native` action
    /// carries the handler name and an empty call, which is the shape
    /// `workflow/app.go` writes for the handlers it registers by hand.
    ///
    /// `type` used to be omitted entirely, leaving every barkloader-installed
    /// action on the column default - fine while `function` was the only
    /// variant, wrong the moment it was not.
    pub fn to_input(&self, action_type: &str, resolved_call: &str) -> super::db_proxy::ActionInputJson {
        super::db_proxy::ActionInputJson {
            name: self.name.clone(),
            description: self.description.clone(),
            action_type: action_type.to_string(),
            call: resolved_call.to_string(),
            params_schema: encode_field_list(Some(&self.schema)),
            returns: encode_data_shape(self.returns.as_ref()),
            taxonomy: self.taxonomy.clone(),
            manifest_id: self.id.clone(),
        }
    }
}

impl ManifestCommand {
    /// `resolved_workflow` is the canonical id of the workflow this command
    /// invokes (when the manifest declared one). When `None`, the command
    /// is treated as a text command per the existing semantics.
    pub async fn register(
        &self,
        module_name: &str,
        db_proxy: &dyn super::db_proxy_client::ModuleDbProxy,
        resolved_workflow: Option<&str>,
    ) -> Result<()> {
        let command_name = self
            .pattern
            .strip_prefix('!')
            .unwrap_or(&self.pattern);

        let command_type = if resolved_workflow.is_some() {
            "function"
        } else {
            "text"
        };

        let type_value = if let Some(workflow) = resolved_workflow {
            workflow.to_string()
        } else {
            format!("Module command: {} ({}). Configure a workflow to handle this command.", self.name, self.pattern)
        };

        db_proxy
            .register_command("", command_name, command_type, &type_value, module_name)
            .await?;

        info!(
            "Registered command: {} [{}] (pattern={}, type={}, workflow={:?})",
            self.name,
            self.id,
            self.pattern,
            command_type,
            resolved_workflow,
        );
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn process(&self) -> Result<()> {
        info!(
            "command stub: id={} pattern={} (use register() instead)",
            self.id, self.pattern
        );
        Ok(())
    }
}

/// Resolution context for a single bundled workflow step.
///
/// `engine_action` names the workflow engine's registered action
/// handler (today always `"function"`, since that's the only handler
/// modules can target). `function_call` is the canonical function id
/// the handler invokes — emitted as the step's top-level `function`
/// field. `action_ref` is the source module action's canonical id —
/// emitted as `$ref` for the reference graph.
pub struct ResolvedWorkflowStep {
    pub action_ref: String,
    pub engine_action: String,
    pub function_call: Option<String>,
}

/// Build the JSON for a single bundled workflow step. Output shape
/// matches `types.TaskDefinition` (workflow/internal/types/types.go):
///
/// ```json
/// {
///   "id": "...",
///   "type": "action",
///   "action": "function",                                    // engine handler
///   "function": "twitch_platform:function:play_alert",        // canonical fn id
///   "parameters": { ...author-supplied... },
///   "$ref": "twitch_platform:action:play_alert"               // graph metadata
/// }
/// ```
///
/// `function` lives at the top level (next to `action`) — the same
/// pattern as `wait` / `workflow` configs on other step types. The
/// resource_reference extractor reads `$ref` (action) and `function`
/// (function); no separate `call` field is needed.
///
/// Today only `type: "action"` steps are emitted from the manifest
/// (`ManifestWorkflowStep` has no type discriminator). When the manifest
/// gains support for wait / condition / log / sub-workflow steps, this
/// helper grows a branch.
/// Prefix an author writes inside a workflow step's `parameters` to
/// reference one of this module's own declared assets, e.g.
/// `${asset:pleasure_sound}` where `pleasure_sound` matches an
/// `assets[].id` in the same manifest.
const ASSET_MARKER_PREFIX: &str = "${asset:";

/// Rewrite every `${asset:<id>}` marker in `value` (recursively, through
/// objects and arrays) into `${woofx3_asset_url:<repositoryKey>}`, baking
/// the module-qualified repository key directly into the persisted
/// workflow JSON at install time.
///
/// This exists because a workflow step's parameters can reach a widget
/// whose own `<base href>` belongs to a *different* module (e.g. a
/// generic `MediaWidget` rendering an asset declared by the module that
/// triggered the alert) — a bare relative filename has no way to carry
/// "this belongs to module X" through to the browser. Baking the full
/// repository key in at install time, with a recognizable
/// `woofx3_asset_url:` prefix the workflow engine resolves via simple
/// string concatenation against `storage.baseUrl` (see
/// `workflow/internal/expression/resolver.go`), fixes that without
/// requiring the workflow engine to do a DB lookup at execution time.
///
/// Fails loudly — rather than leaving an unresolved `${asset:...}` marker
/// to break silently at runtime — if a marker references an asset id not
/// declared in this manifest's `assets[]`.
fn encode_asset_url_markers(
    value: &serde_json::Value,
    asset_repo_keys: &HashMap<String, String>,
) -> Result<serde_json::Value> {
    match value {
        serde_json::Value::String(s) => Ok(serde_json::Value::String(rewrite_asset_markers(
            s,
            asset_repo_keys,
        )?)),
        serde_json::Value::Array(items) => {
            let rewritten = items
                .iter()
                .map(|v| encode_asset_url_markers(v, asset_repo_keys))
                .collect::<Result<Vec<_>>>()?;
            Ok(serde_json::Value::Array(rewritten))
        }
        serde_json::Value::Object(map) => {
            let rewritten = map
                .iter()
                .map(|(k, v)| Ok((k.clone(), encode_asset_url_markers(v, asset_repo_keys)?)))
                .collect::<Result<serde_json::Map<String, serde_json::Value>>>()?;
            Ok(serde_json::Value::Object(rewritten))
        }
        other => Ok(other.clone()),
    }
}

fn rewrite_asset_markers(s: &str, asset_repo_keys: &HashMap<String, String>) -> Result<String> {
    if !s.contains(ASSET_MARKER_PREFIX) {
        return Ok(s.to_string());
    }
    let mut result = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find(ASSET_MARKER_PREFIX) {
        result.push_str(&rest[..start]);
        let after_prefix = &rest[start + ASSET_MARKER_PREFIX.len()..];
        let end = after_prefix
            .find('}')
            .ok_or_else(|| anyhow!("unterminated ${{asset:...}} marker in workflow parameters: {:?}", s))?;
        let asset_id = &after_prefix[..end];
        let repo_key = asset_repo_keys.get(asset_id).ok_or_else(|| {
            anyhow!(
                "workflow parameters reference ${{asset:{}}}, but no assets[] entry with that id exists in this manifest",
                asset_id
            )
        })?;
        result.push_str("${woofx3_asset_url:");
        result.push_str(repo_key);
        result.push('}');
        rest = &after_prefix[end + 1..];
    }
    result.push_str(rest);
    Ok(result)
}

fn step_to_task_json(
    step_id_prefix: &str,
    step_index: usize,
    step: &ManifestWorkflowStep,
    resolved: &ResolvedWorkflowStep,
    asset_repo_keys: &HashMap<String, String>,
) -> Result<serde_json::Value> {
    let mut task = serde_json::Map::new();
    task.insert(
        "id".to_string(),
        serde_json::Value::String(format!("{step_id_prefix}{step_index}")),
    );
    task.insert("type".to_string(), serde_json::Value::String("action".to_string()));
    task.insert(
        "action".to_string(),
        serde_json::Value::String(resolved.engine_action.clone()),
    );
    if let Some(function) = &resolved.function_call {
        task.insert(
            "function".to_string(),
            serde_json::Value::String(function.clone()),
        );
    }
    task.insert(
        "parameters".to_string(),
        encode_asset_url_markers(&step.parameters, asset_repo_keys)?,
    );
    task.insert(
        "$ref".to_string(),
        serde_json::Value::String(resolved.action_ref.clone()),
    );
    Ok(serde_json::Value::Object(task))
}

/// Resolution context for a bundled workflow's trigger.
pub struct ResolvedWorkflowTrigger {
    /// Canonical id of the trigger declaration this workflow references —
    /// recorded as the trigger's `$ref` field for the reference graph.
    pub trigger_ref: String,
    /// The actual NATS subject the trigger fires on — baked into the
    /// persisted workflow's `trigger.event` so the workflow engine
    /// subscribes to the right subject without a runtime lookup.
    pub event_subject: String,
}

impl ManifestWorkflow {
    /// Register the workflow with the workflow service.
    ///
    /// The persisted workflow definition is self-contained for execution
    /// (engine reads `event` to subscribe and each step's `call` to
    /// invoke — no DB lookups at runtime) and carries `$ref` metadata on
    /// the trigger and each step so the `resource_references` extractor
    /// can build the workflow → trigger / action edges deterministically.
    pub async fn register(
        &self,
        module_name: &str,
        db_proxy: &dyn super::db_proxy_client::ModuleDbProxy,
        resolved_trigger: &ResolvedWorkflowTrigger,
        resolved_steps: &[ResolvedWorkflowStep],
        asset_repo_keys: &HashMap<String, String>,
    ) -> Result<()> {
        if resolved_steps.len() != self.steps.len() {
            return Err(anyhow!(
                "workflow {} register: resolved_steps ({}) does not match steps ({})",
                self.id,
                resolved_steps.len(),
                self.steps.len(),
            ));
        }

        let step_id_prefix = format!("{}-{}-", module_name, self.id);

        // Build the canonical step JSON used by every consumer of this
        // workflow: the workflow engine (via `_definition`), the
        // workflow_definitions.steps column (via `_steps`, which the
        // resource_reference extractor reads), and any future reader.
        // This is the single source of truth for what a step looks like
        // on the wire — keep it in sync with `types.TaskDefinition`
        // (workflow/internal/types/types.go) and with the `$ref` /
        // `call` reads in `resource_reference/extractor.go`.
        let tasks_json: Vec<serde_json::Value> = self
            .steps
            .iter()
            .enumerate()
            .map(|(i, s)| step_to_task_json(&step_id_prefix, i, s, &resolved_steps[i], asset_repo_keys))
            .collect::<Result<Vec<_>>>()?;

        // Trigger JSON. `$ref` is reference metadata for the graph;
        // `type` and `event` are what the workflow engine consumes
        // to subscribe.
        let trigger_json = serde_json::json!({
            "$ref": resolved_trigger.trigger_ref,
            "type": "event",
            "event": resolved_trigger.event_subject,
        });

        // Single canonical workflow shape: `steps_json` and
        // `trigger_json` go directly to CreateWorkflowRequest. The
        // db service stores them verbatim into the workflow_definitions
        // columns; the engine reads them back via Workflow's
        // `steps_json` / `trigger_json` getters. The legacy typed
        // `WorkflowStep` proto field was removed.
        let steps_json_string = serde_json::to_string(&serde_json::Value::Array(tasks_json))
            .map_err(|e| anyhow!("marshal steps_json: {}", e))?;
        let trigger_json_string = serde_json::to_string(&trigger_json)
            .map_err(|e| anyhow!("marshal trigger_json: {}", e))?;

        // `created_by_ref` carries the stable manifest module id (not the
        // composite `{id}:{version}:{hash}` key) so upgrades upsert this
        // workflow in place instead of duplicating it on every version
        // bump — symmetric with the trigger / action / widget rows, which
        // upsert on `(created_by_type, created_by_ref, manifest_id)`.
        // `manifest_id` is the workflow's manifest-local id (e.g.
        // `follow-workflow`).
        let request = woofx3::db::workflow::CreateWorkflowRequest {
            name: format!("{}/{}", module_name, self.name),
            description: format!(
                "Module workflow: {} (trigger: {}, steps: {})",
                self.name,
                self.trigger,
                self.steps.len()
            ),
            // Module workflows are instance-global; applicationId is set on
            // the triggering event payload when the workflow runs.
            application_id: String::new(),
            enabled: true,
            variables: std::collections::HashMap::new(),
            on_success: String::new(),
            on_failure: String::new(),
            max_retries: 0,
            timeout_seconds: 0,
            created_by_type: "MODULE".to_string(),
            created_by_ref: module_name.to_string(),
            steps_json: steps_json_string,
            trigger_json: trigger_json_string,
            manifest_id: self.id.clone(),
            taxonomy: self.taxonomy.clone(),
        };

        db_proxy.register_workflow(request).await.map_err(|e| {
            anyhow!(
                "Failed to create workflow {}: {} (trigger={})",
                self.id,
                e,
                self.trigger
            )
        })?;

        info!(
            "Registered workflow: {} [{}] (trigger={}, steps={})",
            self.name,
            self.id,
            self.trigger,
            self.steps.len()
        );
        Ok(())
    }

    pub async fn process(&self) -> Result<()> {
        info!(
            "workflow stub: id={} trigger={} steps={} (use register() instead)",
            self.id,
            self.trigger,
            self.steps.len()
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset_map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn encode_asset_url_markers_rewrites_a_bare_string() {
        let map = asset_map(&[("pleasure_sound", "modules/wolfy_profile/assets/pleasure.mp3")]);
        let value = serde_json::json!("${asset:pleasure_sound}");
        let result = encode_asset_url_markers(&value, &map).expect("rewrite");
        assert_eq!(
            result,
            serde_json::json!("${woofx3_asset_url:modules/wolfy_profile/assets/pleasure.mp3}")
        );
    }

    #[test]
    fn encode_asset_url_markers_leaves_unrelated_strings_untouched() {
        let map = asset_map(&[]);
        let value = serde_json::json!("<3 {primary}${trigger.data.userName}{primary} followed <3");
        let result = encode_asset_url_markers(&value, &map).expect("rewrite");
        assert_eq!(result, value);
    }

    #[test]
    fn encode_asset_url_markers_recurses_through_arrays_and_objects() {
        let map = asset_map(&[
            ("overlay", "modules/wm/assets/bit_overlay.json"),
            ("confetti", "modules/wm/assets/confetti2.gif"),
        ]);
        let value = serde_json::json!({
            "widget": "MediaWidget",
            "mediaUrl": ["${asset:overlay}", "${asset:confetti}"],
            "duration": 10,
        });
        let result = encode_asset_url_markers(&value, &map).expect("rewrite");
        assert_eq!(
            result,
            serde_json::json!({
                "widget": "MediaWidget",
                "mediaUrl": [
                    "${woofx3_asset_url:modules/wm/assets/bit_overlay.json}",
                    "${woofx3_asset_url:modules/wm/assets/confetti2.gif}"
                ],
                "duration": 10,
            })
        );
    }

    #[test]
    fn encode_asset_url_markers_rejects_unknown_asset_id() {
        let map = asset_map(&[]);
        let value = serde_json::json!("${asset:does_not_exist}");
        let err = encode_asset_url_markers(&value, &map).expect_err("must fail");
        assert!(err.to_string().contains("does_not_exist"));
    }

    #[test]
    fn encode_asset_url_markers_rejects_unterminated_marker() {
        let map = asset_map(&[]);
        let value = serde_json::json!("${asset:pleasure_sound");
        let err = encode_asset_url_markers(&value, &map).expect_err("must fail");
        assert!(err.to_string().contains("unterminated"));
    }

    #[test]
    fn parses_spec_manifest_json() {
        let j = r#"{
            "id": "test-mod",
            "name": "Test Mod",
            "version": "1.0.0",
            "triggers": [{ "id": "twitch.foo", "name": "Foo", "description": "d", "type": "eventbus" }],
            "functions": [{ "id": "f1", "name": "F1", "runtime": "lua", "path": "functions/f1.lua" }],
            "widgets": [{ "id": "w1", "name": "W", "entry": "widgets/w1/index.html" }]
        }"#;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert_eq!(m.module_key(), "test-mod");
        assert_eq!(m.functions.len(), 1);
        assert_eq!(m.functions[0].id, "f1");
    }

    #[test]
    fn manifest_preserves_author_and_category_through_round_trip() {
        let j = r#"{
            "id": "wolfy_profile",
            "name": "Wolfy profile",
            "version": "1.0.0",
            "author": "WolfyMaster LLC",
            "category": "platform"
        }"#;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert_eq!(m.author.as_deref(), Some("WolfyMaster LLC"));
        assert_eq!(m.category.as_deref(), Some("platform"));

        let s = serde_json::to_string(&m).expect("serialize");
        let reparsed: serde_json::Value = serde_json::from_str(&s).expect("reparse");
        assert_eq!(reparsed.get("author").and_then(|v| v.as_str()), Some("WolfyMaster LLC"));
        assert_eq!(reparsed.get("category").and_then(|v| v.as_str()), Some("platform"));
    }

    #[test]
    fn manifest_author_and_category_are_optional() {
        let j = r#"{
            "id": "m",
            "name": "M",
            "version": "1.0.0"
        }"#;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert!(m.author.is_none());
        assert!(m.category.is_none());
    }

    #[test]
    fn trigger_resolve_taxonomy_prefers_taxonomy_over_category() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "category": "platform.twitch",
            "taxonomy": ["platform.twitch.chat", "function.chat"]
        }))
        .expect("parse");
        assert_eq!(
            t.resolve_taxonomy(),
            vec!["platform.twitch.chat".to_string(), "function.chat".to_string()]
        );
    }

    #[test]
    fn trigger_resolve_taxonomy_falls_back_to_legacy_category() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "category": "platform.twitch"
        }))
        .expect("parse");
        assert_eq!(t.resolve_taxonomy(), vec!["platform.twitch".to_string()]);
    }

    #[test]
    fn trigger_resolve_taxonomy_falls_back_to_type() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus"
        }))
        .expect("parse");
        assert_eq!(t.resolve_taxonomy(), vec!["eventbus".to_string()]);
    }

    #[test]
    fn trigger_resolve_taxonomy_ignores_blank_category() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "category": "   "
        }))
        .expect("parse");
        assert_eq!(t.resolve_taxonomy(), vec!["eventbus".to_string()]);
    }

    #[test]
    fn trigger_resolve_taxonomy_ignores_empty_taxonomy_array() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "category": "platform.twitch",
            "taxonomy": []
        }))
        .expect("parse");
        assert_eq!(t.resolve_taxonomy(), vec!["platform.twitch".to_string()]);
    }

    #[test]
    fn trigger_to_input_projects_resolved_taxonomy() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "taxonomy": ["platform.twitch.chat", "function.chat"]
        }))
        .expect("parse");
        assert_eq!(
            t.to_input().taxonomy,
            vec!["platform.twitch.chat".to_string(), "function.chat".to_string()]
        );
    }

    #[test]
    fn action_to_input_projects_taxonomy() {
        let a: ManifestAction = serde_json::from_value(serde_json::json!({
            "id": "play_alert",
            "name": "Play Alert",
            "type": "function",
            "function": "play_alert",
            "taxonomy": ["platform.govee", "function.lighting"]
        }))
        .expect("parse");
        assert_eq!(
            a.to_input("function", "play_alert").taxonomy,
            vec!["platform.govee".to_string(), "function.lighting".to_string()]
        );
    }

    #[test]
    fn action_to_input_defaults_taxonomy_to_empty() {
        let a: ManifestAction = serde_json::from_value(serde_json::json!({
            "id": "play_alert",
            "name": "Play Alert",
            "type": "function",
            "function": "play_alert"
        }))
        .expect("parse");
        assert!(a.to_input("function", "play_alert").taxonomy.is_empty());
    }

    #[test]
    fn action_to_input_projects_returns() {
        let a: ManifestAction = serde_json::from_value(serde_json::json!({
            "id": "increment",
            "name": "Increment Counter",
            "type": "function",
            "function": "increment",
            "returns": {
                "fields": [
                    { "path": "next", "type": "number", "description": "New value" },
                    { "path": "previous", "type": "number" }
                ]
            }
        }))
        .expect("parse");
        let returns = a.to_input("function", "increment").returns;
        let parsed: serde_json::Value = serde_json::from_str(&returns).expect("valid json");
        assert_eq!(parsed["fields"][0]["path"], "next");
        assert_eq!(parsed["fields"][0]["type"], "number");
        assert_eq!(parsed["fields"][1]["path"], "previous");
    }

    #[test]
    fn action_to_input_defaults_returns_to_empty_object() {
        let a: ManifestAction = serde_json::from_value(serde_json::json!({
            "id": "play_alert",
            "name": "Play Alert",
            "type": "function",
            "function": "play_alert"
        }))
        .expect("parse");
        assert_eq!(a.to_input("function", "play_alert").returns, "{}");
    }

    // The old ConfigField-shaped `outputs` key is gone. A manifest still
    // carrying one parses fine and simply declares nothing, so an unmigrated
    // module installs rather than failing on a key it cannot know is dead.
    #[test]
    fn action_ignores_the_removed_outputs_key() {
        let a: ManifestAction = serde_json::from_value(serde_json::json!({
            "id": "increment",
            "name": "Increment Counter",
            "type": "function",
            "function": "increment",
            "outputs": [{ "id": "next", "label": "New value", "type": "number" }]
        }))
        .expect("parse");
        assert_eq!(a.to_input("function", "increment").returns, "{}");
    }

    #[test]
    fn trigger_to_input_projects_emits() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "channel_cheer",
            "name": "Cheer",
            "event": "cheer.channel.twitch",
            "emits": {
                "fields": [
                    { "path": "bits", "type": "number", "description": "Bits cheered" },
                    { "path": "user_name", "type": "string" }
                ]
            }
        }))
        .expect("parse");
        let emits = t.to_input().emits;
        let parsed: serde_json::Value = serde_json::from_str(&emits).expect("valid json");
        assert_eq!(parsed["fields"][0]["path"], "bits");
        assert_eq!(parsed["fields"][0]["type"], "number");
        assert_eq!(parsed["fields"][1]["path"], "user_name");
    }

    #[test]
    fn trigger_to_input_defaults_emits_to_empty_object() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "channel_cheer",
            "name": "Cheer",
            "event": "cheer.channel.twitch"
        }))
        .expect("parse");
        // "{}" rather than "null": the column is NOT NULL and every consumer
        // parses this as an object, so an undeclared shape reads as "declared
        // nothing" with no null branch anywhere. A trigger that never declares
        // one keeps deriving its variables from `schema`.
        assert_eq!(t.to_input().emits, "{}");
    }

    #[test]
    fn parses_widget_with_entry_assets_accepted_events_and_settings_schema() {
        // Mirrors the shape used by the bundled `scene_widgets` reference
        // module: entry + assets directory + accepted canonical event ids
        // + a structured settingsSchema with field descriptors.
        let j = r##"{
            "id": "scene_widgets",
            "name": "Scene Widgets",
            "version": "0.1.0",
            "widgets": [
                {
                    "id": "raid_counter",
                    "name": "Raid Counter",
                    "description": "Counts incoming raids.",
                    "entry": "widgets/raid_counter/index.html",
                    "assets": "widgets/raid_counter",
                    "acceptedEvents": ["twitch_platform:trigger:raid.channel.twitch"],
                    "settingsSchema": [
                        {
                            "id": "minViewers",
                            "type": "number",
                            "label": "Minimum viewers",
                            "defaultValue": 1
                        },
                        {
                            "id": "accentColor",
                            "type": "color",
                            "label": "Accent color",
                            "defaultValue": "#ff5e3a"
                        }
                    ]
                }
            ]
        }"##;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert_eq!(m.widgets.len(), 1);
        let w = &m.widgets[0];
        assert_eq!(w.id, "raid_counter");
        assert_eq!(w.entry.as_deref(), Some("widgets/raid_counter/index.html"));
        assert_eq!(w.assets.as_deref(), Some("widgets/raid_counter"));
        assert_eq!(w.accepted_events, vec!["twitch_platform:trigger:raid.channel.twitch"]);
        let fields = w.settings_schema.as_ref().expect("settings_schema present");
        assert_eq!(fields.len(), 2);
        assert_eq!(fields[0].id, "minViewers");
        assert_eq!(fields[0].field_type, "number");
    }

    #[test]
    fn parses_multi_widget_manifest_with_mixed_accepted_events() {
        // Exercises the alert_feed shape: a widget that subscribes to
        // multiple canonical event ids, alongside two single-event widgets.
        let j = r#"{
            "id": "scene_widgets",
            "name": "Scene Widgets",
            "version": "0.1.0",
            "widgets": [
                {
                    "id": "recent_followers",
                    "name": "Recent Followers",
                    "entry": "widgets/recent_followers/index.html",
                    "assets": "widgets/recent_followers",
                    "acceptedEvents": ["twitch_platform:trigger:follow.channel.twitch"]
                },
                {
                    "id": "alert_feed",
                    "name": "Alert Feed",
                    "entry": "widgets/alert_feed/index.html",
                    "assets": "widgets/alert_feed",
                    "acceptedEvents": [
                        "twitch_platform:trigger:follow.channel.twitch",
                        "twitch_platform:trigger:cheer.channel.twitch",
                        "twitch_platform:trigger:raid.channel.twitch"
                    ]
                }
            ]
        }"#;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert_eq!(m.widgets.len(), 2);
        assert_eq!(m.widgets[0].accepted_events.len(), 1);
        assert_eq!(m.widgets[1].accepted_events.len(), 3);
    }

    #[test]
    fn resolved_alert_types_uses_explicit_field_when_set() {
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "x",
            "name": "X",
            "acceptedEvents": ["twitch_platform:trigger:follow.channel.twitch"],
            "alertTypes": ["follow", "raid"]
        }))
        .expect("parse");
        assert_eq!(w.resolved_alert_types(), vec!["follow", "raid"]);
    }

    #[test]
    fn resolved_alert_types_derives_from_accepted_events_when_absent() {
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "x",
            "name": "X",
            "acceptedEvents": [
                "twitch_platform:trigger:follow.channel.twitch",
                "twitch_platform:trigger:raid.channel.twitch",
                "twitch_platform:trigger:cheer.channel.twitch"
            ]
        }))
        .expect("parse");
        assert_eq!(w.resolved_alert_types(), vec!["follow", "raid", "cheer"]);
    }

    #[test]
    fn resolved_alert_types_skips_canonicals_with_no_mapping() {
        // chat.message has no AlertContext type — should be skipped silently.
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "x",
            "name": "X",
            "acceptedEvents": [
                "twitch_platform:trigger:message.user.twitch",
                "twitch_platform:trigger:follow.channel.twitch"
            ]
        }))
        .expect("parse");
        assert_eq!(w.resolved_alert_types(), vec!["follow"]);
    }

    #[test]
    fn resolved_alert_types_deduplicates() {
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "x",
            "name": "X",
            "acceptedEvents": [
                "twitch_platform:trigger:follow.channel.twitch",
                "twitch_platform:trigger:follow.channel.twitch"
            ]
        }))
        .expect("parse");
        assert_eq!(w.resolved_alert_types(), vec!["follow"]);
    }

    #[test]
    fn alert_type_for_canonical_recognizes_full_alert_set() {
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:follow.channel.twitch"), Some("follow"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:cheer.channel.twitch"), Some("cheer"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:subscribe.channel.twitch"), Some("subscribe"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:subscriptionGift.channel.twitch"), Some("sub_gift"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:hypetrain.channel.twitch"), Some("hypetrain"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:raid.channel.twitch"), Some("raid"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:online.channel.twitch"), Some("stream_online"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:message.user.twitch"), None);
    }

    #[test]
    fn to_input_projects_manifest_into_wire_format() {
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "raid_counter",
            "name": "Raid Counter",
            "description": "Counts incoming raids.",
            "entry": "widgets/raid_counter/index.html",
            "assets": "widgets/raid_counter",
            "acceptedEvents": ["twitch_platform:trigger:raid.channel.twitch"],
            "settingsSchema": [
                { "id": "minViewers", "type": "number", "label": "Minimum viewers", "defaultValue": 1 }
            ]
        }))
        .expect("parse");
        let input = w.to_input();
        assert_eq!(input.manifest_id, "raid_counter");
        assert_eq!(input.name, "Raid Counter");
        assert_eq!(input.description, "Counts incoming raids.");
        assert_eq!(input.directory, "widgets/raid_counter");
        // Registered entry is assets-relative (design 5.2.5).
        assert_eq!(input.entry, "index.html");
        assert_eq!(input.alert_types, vec!["raid"]);
        // Re-emitted from the parsed fields, so always the canonical array.
        assert!(input.settings_schema.starts_with('['));
        assert!(input.settings_schema.contains("minViewers"));
    }

    #[test]
    fn to_input_falls_back_to_empty_strings_for_omitted_optional_fields() {
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "raid_counter",
            "name": "Raid Counter"
        }))
        .expect("parse");
        let input = w.to_input();
        assert_eq!(input.description, "");
        assert_eq!(input.directory, "");
        // No entry -> empty string; consumers fall back to index.html.
        assert_eq!(input.entry, "");
        // No settings_schema -> an empty list, not an empty object: the
        // contract has one container shape and it is an array.
        assert_eq!(input.settings_schema, "[]");
        assert!(input.alert_types.is_empty());
    }

    #[test]
    fn entry_normalizes_relative_to_assets_dir() {
        // spotify_sr-style manifest: entry inside the assets directory.
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "now_playing",
            "name": "Now Playing",
            "entry": "widgets/now_playing/index.html",
            "assets": "widgets/now_playing"
        }))
        .expect("parse");
        assert_eq!(
            w.entry_relative_to_assets().expect("normalize").as_deref(),
            Some("index.html")
        );
        assert_eq!(w.to_input().entry, "index.html");

        // Nested entry keeps its assets-relative subpath.
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "w1",
            "name": "W",
            "entry": "./widgets/w1/pages/main.html",
            "assets": "widgets/w1/"
        }))
        .expect("parse");
        assert_eq!(
            w.entry_relative_to_assets().expect("normalize").as_deref(),
            Some("pages/main.html")
        );
    }

    #[test]
    fn entry_outside_assets_dir_is_an_error() {
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "w1",
            "name": "W",
            "entry": "elsewhere/index.html",
            "assets": "widgets/w1"
        }))
        .expect("parse");
        let err = w.entry_relative_to_assets().expect_err("outside assets");
        assert!(
            err.to_string().contains("must live inside the `assets` directory"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn entry_without_assets_dir_is_an_error() {
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "w1",
            "name": "W",
            "entry": "widgets/w1/index.html"
        }))
        .expect("parse");
        let err = w.entry_relative_to_assets().expect_err("missing assets");
        assert!(
            err.to_string().contains("requires an `assets` directory"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn no_entry_normalizes_to_none() {
        let w: ModuleWidget = serde_json::from_value(serde_json::json!({
            "id": "w1",
            "name": "W"
        }))
        .expect("parse");
        assert_eq!(w.entry_relative_to_assets().expect("ok"), None);
    }

    #[test]
    fn widget_round_trips_through_serialization() {
        let j = r#"{
            "id": "raid_counter",
            "name": "Raid Counter",
            "entry": "widgets/raid_counter/index.html",
            "assets": "widgets/raid_counter",
            "acceptedEvents": ["twitch_platform:trigger:raid.channel.twitch"]
        }"#;
        let w: ModuleWidget = serde_json::from_str(j).expect("parse");
        let s = serde_json::to_string(&w).expect("serialize");
        let reparsed: serde_json::Value = serde_json::from_str(&s).expect("reparse");
        // Confirm the camelCase rename survives the round trip.
        assert_eq!(
            reparsed.get("acceptedEvents").and_then(|v| v.as_array()).map(|a| a.len()),
            Some(1)
        );
        assert!(reparsed.get("accepted_events").is_none());
    }

    #[test]
    fn parses_manifest_settings() {
        let j = r#"
    {
        "id": "mymod",
        "name": "My Module",
        "settings": [
            {"id": "clientId", "label": "Client ID", "description": "OAuth client ID", "type": "text", "required": true},
            {"id": "maxRetries", "label": "Max Retries", "description": "Retry count", "type": "number", "required": false, "defaultValue": "5"},
            {"id": "enabled", "label": "Enabled", "description": "Toggle feature", "type": "toggle", "required": false, "defaultValue": "true"}
        ]
    }"#;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert_eq!(m.settings.len(), 3);
        let s0 = &m.settings[0];
        assert_eq!(s0.id, "clientId");
        assert_eq!(s0.setting_type, "text");
        assert_eq!(s0.required, true);
        assert!(s0.default_value.is_none());

        let s1 = &m.settings[1];
        assert_eq!(s1.id, "maxRetries");
        assert_eq!(s1.setting_type, "number");
        assert_eq!(s1.default_value.as_deref(), Some("5"));

        let s2 = &m.settings[2];
        assert_eq!(s2.setting_type, "toggle");
        assert_eq!(s2.default_value.as_deref(), Some("true"));
    }

    #[test]
    fn button_setting_action_survives_manifest_storage_round_trip() {
        // Regression test: modules.manifest is stored as serde_json::to_string(manifest),
        // not the raw uploaded bytes, so any field ManifestSetting doesn't declare is
        // silently dropped before it's ever persisted. `action` must round-trip intact.
        let j = r#"
    {
        "id": "spotify",
        "name": "Spotify Song Request",
        "settings": [
            {
                "id": "authorizeSpotify",
                "label": "Authorize Spotify",
                "type": "button",
                "action": { "kind": "integration", "integration": "spotify" }
            },
            {
                "id": "someInternalButton",
                "label": "Do something",
                "type": "button",
                "action": {
                    "kind": "internal",
                    "request": { "event": "barkloader.module.field_options", "payload": { "moduleId": "spotify", "functionId": "get_devices" } },
                    "timeoutMs": 10000
                }
            },
            {"id": "clientId", "label": "Spotify Client ID", "type": "text", "required": false}
        ]
    }"#;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert_eq!(m.settings.len(), 3);
        assert_eq!(m.settings[0].action["kind"], "integration");
        assert_eq!(m.settings[0].action["integration"], "spotify");
        assert_eq!(m.settings[1].action["kind"], "internal");
        assert_eq!(m.settings[1].action["request"]["event"], "barkloader.module.field_options");
        // clientId has no action at all — must not gain one from a missing-field default.
        assert!(m.settings[2].action.is_null());

        let reserialized = serde_json::to_string(&m).expect("serialize");
        let reparsed: ModuleManifest = serde_json::from_str(&reserialized).expect("reparse");
        assert_eq!(reparsed.settings[0].action["integration"], "spotify");
        assert_eq!(
            reparsed.settings[1].action["request"]["payload"]["functionId"],
            "get_devices"
        );
        assert!(reparsed.settings[2].action.is_null());
    }

    #[test]
    fn realistic_manifest_parses_and_round_trips() {
        // A committed copy of a real first-party manifest (woofx3_spotify),
        // exercising the whole struct against something an author actually
        // wrote rather than the minimum each test needs.
        //
        // It used to `include_str!` the live manifest out of a sibling
        // checkout, which meant this test — and every other test in the crate,
        // since a missing `include_str!` target fails compilation — could not
        // run on CI or a fresh clone at all. Drift against the real modules is
        // caught where it actually matters now: a manifest that no longer
        // matches this struct fails to install (see manifest_validate).
        let j = include_str!("../fixtures/spotify_manifest.json");
        let m: ModuleManifest = serde_json::from_str(j).expect("parse spotify fixture");
        assert_eq!(m.settings.len(), 2);
        assert_eq!(m.settings[0].id, "authorizeSpotify");
        assert_eq!(m.settings[0].setting_type, "button");
        assert_eq!(m.settings[0].action["kind"], "integration");
        assert_eq!(m.settings[0].action["integration"], "spotify");
        assert_eq!(m.settings[1].id, "clientId");
        assert_eq!(m.settings[1].setting_type, "text");
        assert!(m.settings[1].action.is_null());

        let reserialized = serde_json::to_string(&m).expect("serialize");
        let reparsed: ModuleManifest = serde_json::from_str(&reserialized).expect("reparse");
        assert_eq!(reparsed.settings[0].action["integration"], "spotify");
    }
}
