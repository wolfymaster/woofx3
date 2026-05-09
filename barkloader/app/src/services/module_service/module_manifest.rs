use anyhow::{anyhow, Result};
use lib_repository::{CreateFileRequest, Repository};
use log::{info, warn};
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
    /// UX / registry grouping (e.g. platform.twitch). Sent to RegisterTrigger as `category`.
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub schema: Option<serde_json::Value>,
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
    /// UI form definition for this action's user-editable inputs.
    /// `ConfigField[]` — engine treats it as opaque and forwards as
    /// `paramsSchema` for the UI to render. Distinct from a workflow
    /// step's `parameters` (the values the user provides per invocation).
    ///
    /// Supported field `type` values (the editor knows how to render
    /// each; the engine itself does not validate type strings):
    ///
    ///   - `"text"`     — single-line string
    ///   - `"number"`   — numeric input with optional `min` / `max`
    ///   - `"boolean"`  — checkbox / toggle
    ///   - `"select"`   — dropdown driven by `options[]`
    ///   - `"color"`    — color picker (CSS color string)
    ///   - `"asset"`    — picker scoped to the declaring module's
    ///                    `assets[]`. Field shape:
    ///                    `{ id, label, type: "asset", required?,
    ///                       kinds?: string[] }`.
    ///                    `kinds` filters the picker by
    ///                    `ManifestAsset.kind` (e.g. `["image"]`).
    ///                    The value stored in the workflow's `parameters`
    ///                    map is the asset's canonical id; the editor
    ///                    resolves to a public URL at config time and
    ///                    bakes that URL into the saved workflow so the
    ///                    runtime never has to re-resolve.
    #[serde(default)]
    pub schema: serde_json::Value,
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
    /// Relative path inside the module zip. Resolved via
    /// `resolve_zip_file` at install time; the resulting bytes are
    /// written into the repository under
    /// `modules/{module_key}/assets/{path}`.
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
/// `value_schema` is opaque to the engine — modules may use it to drive
/// a UI create-form, or omit it entirely. The engine forwards it as
/// part of the manifest payload so consumers (the UI) can inspect.
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
    /// Opaque value schema. The engine does not validate values of
    /// this kind; modules may publish a JSON-schema-like document
    /// here to drive a create-form in the UI.
    #[serde(default)]
    pub value_schema: Option<serde_json::Value>,
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
    #[serde(default)]
    pub settings_schema: Option<serde_json::Value>,
    /// Canonical trigger ids (e.g. `twitch_platform:trigger:follow.user.twitch`)
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
    /// UI catalog grouping for the module as a whole (e.g. `platform`,
    /// `automation`). Distinct from `triggers[].category`, which groups
    /// individual triggers in the workflow builder.
    #[serde(default)]
    pub category: Option<String>,
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
}

impl ModuleManifest {
    pub fn module_key(&self) -> &str {
        &self.id
    }

    /// The ID component used in the composite module_id.
    /// Uses the manifest `id` field if non-empty, otherwise falls back to
    /// lowercase snake_case of the module name.
    pub fn id_component(&self) -> String {
        let trimmed = self.id.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
        to_snake_case(&self.name)
    }

    /// Compute the composite module_key: `{id}:{version}:{hash}` where hash is
    /// the first 7 characters of the SHA-256 hex digest of the zip bytes.
    pub fn compute_module_key(&self, zip_bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(zip_bytes);
        let hash = format!("{:x}", hasher.finalize());
        let short_hash = &hash[..7];
        format!("{}:{}:{}", self.id_component(), self.version, short_hash)
    }
}

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

fn normalize_rel_path(s: &str) -> String {
    s.trim_start_matches("./")
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string()
}

pub fn resolve_zip_file<'a>(files: &'a [ModuleFile], rel_path: &str) -> Option<&'a ModuleFile> {
    let rel = normalize_rel_path(rel_path);
    if rel.is_empty() {
        return None;
    }
    files.iter().find(|f| {
        let n = normalize_rel_path(&f.name);
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

impl ManifestFunction {
    pub async fn upload_to_repository<R: Repository>(
        &self,
        module_key: &str,
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
        let rel_in_module = normalize_rel_path(&self.path);
        let repo_key = format!("modules/{module_key}/functions/{rel_in_module}");
        let ext = extension_for_path(&self.path);
        let req = CreateFileRequest {
            content: Some(file.contents.clone()),
            extension: Some(ext),
            file_name: repo_key.clone(),
        };
        let mut failed = Vec::new();
        repository.create([req], &mut failed).await?;
        if failed.is_empty() {
            info!("Stored function {} at {}", self.id, repo_key);
            Ok(repo_key)
        } else {
            Err(anyhow!("Failed to store function {}", self.id))
        }
    }
}

impl ManifestAsset {
    /// Resolve the asset's path inside the module zip and write the
    /// bytes into the engine's repository under
    /// `modules/{module_key}/assets/{rel_in_module}`. Mirror of
    /// `ManifestFunction::upload_to_repository` — same failure modes,
    /// same key shape (just `assets/` instead of `functions/`).
    pub async fn upload_to_repository<R: Repository>(
        &self,
        module_key: &str,
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
        let rel_in_module = normalize_rel_path(&self.path);
        let repo_key = format!("modules/{module_key}/assets/{rel_in_module}");
        let ext = extension_for_path(&self.path);
        let req = CreateFileRequest {
            content: Some(file.contents.clone()),
            extension: Some(ext),
            file_name: repo_key.clone(),
        };
        let mut failed = Vec::new();
        repository.create([req], &mut failed).await?;
        if failed.is_empty() {
            info!("Stored asset {} at {}", self.id, repo_key);
            Ok(repo_key)
        } else {
            Err(anyhow!("Failed to store asset {}", self.id))
        }
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
    /// Category for `RegisterTrigger` and install-time grouping: manifest `category` when set
    /// (non-empty after trim), otherwise transport/type (`type` field, e.g. `eventbus`).
    pub fn register_category(&self) -> String {
        self.category
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| self.trigger_type.clone())
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
        let config_schema = self
            .schema
            .as_ref()
            .map(|v| v.to_string())
            .unwrap_or_else(|| "{}".to_string());
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
            category: self.register_category(),
            name: self.name.clone(),
            description: self.description.clone(),
            event,
            config_schema,
            allow_variants: self.allow_variants,
            manifest_id: self.id.clone(),
        }
    }
}

fn widget_asset_prefix(assets: &str) -> String {
    normalize_rel_path(assets).trim_end_matches('/').to_string() + "/"
}

/// Map a canonical trigger id (e.g.
/// `twitch_platform:trigger:follow.user.twitch`) to the AlertContext.type
/// the engine emits for that event. Returns `None` for triggers that
/// don't translate to an alert (chat messages, internal events, etc.) —
/// those widgets must declare `alert_types` explicitly in the manifest.
///
/// This table mirrors `api/src/alert-emitter.ts` mappers — keep in sync
/// when the AlertContext type union grows.
pub fn alert_type_for_canonical(canonical: &str) -> Option<&'static str> {
    let event = canonical.rsplit(':').next().unwrap_or(canonical);
    match event {
        "follow.user.twitch" => Some("follow"),
        "cheer.user.twitch" => Some("cheer"),
        "subscribe.user.twitch" => Some("subscribe"),
        "subscription.gift.twitch" => Some("sub_gift"),
        "hypetrain.channel.twitch" => Some("hypetrain"),
        "raid.user.twitch" => Some("raid"),
        "online.user.twitch" => Some("stream_online"),
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

    /// Build the Twirp WidgetInput JSON for bulk registration. The engine
    /// db-proxy persists this and emits the NATS outbox event that the
    /// api/ service forwards to Convex as `module.widget.registered`.
    ///
    /// `directory` defaults to `assets` (the manifest's bundle path) — that's
    /// what Convex needs to address widget files via the asset HTTP route.
    /// `settings_schema` is the manifest's `settingsSchema` value serialized;
    /// engine treats it opaquely.
    pub fn to_input(&self) -> super::db_proxy::WidgetInputJson {
        super::db_proxy::WidgetInputJson {
            manifest_id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone().unwrap_or_default(),
            directory: self.assets.clone().unwrap_or_default(),
            alert_types: self.resolved_alert_types(),
            settings_schema: self
                .settings_schema
                .as_ref()
                .map(|v| v.to_string())
                .unwrap_or_else(|| "{}".to_string()),
        }
    }

    async fn upload_one_file<R: Repository>(
        &self,
        module_key: &str,
        file: &ModuleFile,
        rel_under_widget: &str,
        repository: &R,
    ) -> Result<String> {
        let rel = normalize_rel_path(rel_under_widget);
        let repo_key = format!("modules/{module_key}/widgets/{}/{rel}", self.id);
        let ext = extension_for_path(&file.name);
        let mut failed = Vec::new();
        repository
            .create(
                [CreateFileRequest {
                    content: Some(file.contents.clone()),
                    extension: Some(ext),
                    file_name: repo_key.clone(),
                }],
                &mut failed,
            )
            .await?;
        if failed.is_empty() {
            Ok(repo_key)
        } else {
            Err(anyhow!("Failed to store widget file for {}", self.id))
        }
    }

    pub async fn upload_assets<R: Repository>(
        &self,
        module_key: &str,
        files: &[ModuleFile],
        repository: &R,
    ) -> Result<Vec<String>> {
        let mut keys = Vec::new();

        if let Some(entry) = &self.entry {
            if let Some(f) = resolve_zip_file(files, entry) {
                let rel = normalize_rel_path(entry);
                keys.push(
                    self.upload_one_file(module_key, f, &rel, repository)
                        .await?,
                );
            } else {
                warn!("Widget {} entry '{}' not found in archive", self.id, entry);
            }
        }

        if let Some(assets_dir) = &self.assets {
            let prefix = widget_asset_prefix(assets_dir);
            for file in files {
                let n = normalize_rel_path(&file.name);
                if !n.starts_with(&prefix) {
                    continue;
                }
                let rel_under = n.strip_prefix(&prefix).unwrap_or(&n).to_string();
                if rel_under.is_empty() {
                    continue;
                }
                keys.push(
                    self.upload_one_file(module_key, file, &rel_under, repository)
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
        let rel = normalize_rel_path(&self.entry);
        let repo_key = format!("modules/{module_key}/overlays/{}/{rel}", self.id);
        let ext = extension_for_path(&self.entry);
        let mut failed = Vec::new();
        repository
            .create(
                [CreateFileRequest {
                    content: Some(file.contents.clone()),
                    extension: Some(ext),
                    file_name: repo_key.clone(),
                }],
                &mut failed,
            )
            .await?;
        if failed.is_empty() {
            Ok(repo_key)
        } else {
            Err(anyhow!("Failed to store overlay {}", self.id))
        }
    }
}

impl ManifestAction {
    /// Build the Twirp ActionInput JSON for bulk registration.
    ///
    /// `resolved_call` is the action's resolved handler invocation
    /// target — currently always the canonical function id, since
    /// `function` is the only `ManifestActionImpl` variant. When more
    /// action types ship, the install path picks the right resolved
    /// value per variant.
    pub fn to_input(&self, resolved_call: &str) -> super::db_proxy::ActionInputJson {
        super::db_proxy::ActionInputJson {
            name: self.name.clone(),
            description: self.description.clone(),
            call: resolved_call.to_string(),
            params_schema: self.schema.to_string(),
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
        db_proxy_url: &str,
        application_id: &str,
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

        super::db_proxy::create_command(
            db_proxy_url,
            application_id,
            command_name,
            command_type,
            &type_value,
            &format!("module:{}", module_name),
        )
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
fn step_to_task_json(
    step_id_prefix: &str,
    step_index: usize,
    step: &ManifestWorkflowStep,
    resolved: &ResolvedWorkflowStep,
) -> serde_json::Value {
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
    task.insert("parameters".to_string(), step.parameters.clone());
    task.insert(
        "$ref".to_string(),
        serde_json::Value::String(resolved.action_ref.clone()),
    );
    serde_json::Value::Object(task)
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
        composite_module_key: &str,
        db_proxy_url: &str,
        application_id: &str,
        resolved_trigger: &ResolvedWorkflowTrigger,
        resolved_steps: &[ResolvedWorkflowStep],
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
            .map(|(i, s)| step_to_task_json(&step_id_prefix, i, s, &resolved_steps[i]))
            .collect();

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

        // `created_by_ref` carries the composite moduleKey so the engine
        // can derive the UI projectionKey
        // (`{moduleKey}:workflow:{manifestId}`) symmetrically with the
        // trigger / action rows. `manifest_id` is the workflow's
        // manifest-local id (e.g. `follow-workflow`).
        let request = woofx3::db::workflow::CreateWorkflowRequest {
            name: format!("{}/{}", module_name, self.name),
            description: format!(
                "Module workflow: {} (trigger: {}, steps: {})",
                self.name,
                self.trigger,
                self.steps.len()
            ),
            application_id: application_id.to_string(),
            created_by: format!("module:{}", module_name),
            enabled: true,
            variables: std::collections::HashMap::new(),
            on_success: String::new(),
            on_failure: String::new(),
            max_retries: 0,
            timeout_seconds: 0,
            created_by_type: "MODULE".to_string(),
            created_by_ref: composite_module_key.to_string(),
            steps_json: steps_json_string,
            trigger_json: trigger_json_string,
            manifest_id: self.id.clone(),
        };

        let client = woofx3_twirp::WorkflowServiceClient::new(db_proxy_url);
        let response = client.create_workflow(request).await.map_err(|e| {
            anyhow!(
                "Failed to create workflow {}: {} (trigger={})",
                self.id,
                e,
                self.trigger
            )
        })?;

        if let Some(status) = response.status {
            if status.code != 0 {
                return Err(anyhow!(
                    "CreateWorkflow failed for {}: {}",
                    self.id,
                    status.message
                ));
            }
        }

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
    fn trigger_register_category_prefers_manifest_category() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "category": "platform.twitch"
        }))
        .expect("parse");
        assert_eq!(t.register_category(), "platform.twitch");
    }

    #[test]
    fn trigger_register_category_falls_back_to_type() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus"
        }))
        .expect("parse");
        assert_eq!(t.register_category(), "eventbus");
    }

    #[test]
    fn trigger_register_category_ignores_blank_category() {
        let t: ManifestTrigger = serde_json::from_value(serde_json::json!({
            "id": "twitch.foo",
            "name": "Foo",
            "description": "d",
            "type": "eventbus",
            "category": "   "
        }))
        .expect("parse");
        assert_eq!(t.register_category(), "eventbus");
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
                    "acceptedEvents": ["twitch_platform:trigger:raid.user.twitch"],
                    "settingsSchema": {
                        "fields": [
                            {
                                "key": "minViewers",
                                "fieldType": "number",
                                "label": "Minimum viewers",
                                "defaultValue": 1
                            },
                            {
                                "key": "accentColor",
                                "fieldType": "color",
                                "label": "Accent color",
                                "defaultValue": "#ff5e3a"
                            }
                        ]
                    }
                }
            ]
        }"##;
        let m: ModuleManifest = serde_json::from_str(j).expect("parse");
        assert_eq!(m.widgets.len(), 1);
        let w = &m.widgets[0];
        assert_eq!(w.id, "raid_counter");
        assert_eq!(w.entry.as_deref(), Some("widgets/raid_counter/index.html"));
        assert_eq!(w.assets.as_deref(), Some("widgets/raid_counter"));
        assert_eq!(w.accepted_events, vec!["twitch_platform:trigger:raid.user.twitch"]);
        let schema = w.settings_schema.as_ref().expect("settings_schema present");
        let fields = schema.get("fields").and_then(|v| v.as_array()).expect("fields array");
        assert_eq!(fields.len(), 2);
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
                    "acceptedEvents": ["twitch_platform:trigger:follow.user.twitch"]
                },
                {
                    "id": "alert_feed",
                    "name": "Alert Feed",
                    "entry": "widgets/alert_feed/index.html",
                    "assets": "widgets/alert_feed",
                    "acceptedEvents": [
                        "twitch_platform:trigger:follow.user.twitch",
                        "twitch_platform:trigger:cheer.user.twitch",
                        "twitch_platform:trigger:raid.user.twitch"
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
            "acceptedEvents": ["twitch_platform:trigger:follow.user.twitch"],
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
                "twitch_platform:trigger:follow.user.twitch",
                "twitch_platform:trigger:raid.user.twitch",
                "twitch_platform:trigger:cheer.user.twitch"
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
                "twitch_platform:trigger:follow.user.twitch"
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
                "twitch_platform:trigger:follow.user.twitch",
                "twitch_platform:trigger:follow.user.twitch"
            ]
        }))
        .expect("parse");
        assert_eq!(w.resolved_alert_types(), vec!["follow"]);
    }

    #[test]
    fn alert_type_for_canonical_recognizes_full_alert_set() {
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:follow.user.twitch"), Some("follow"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:cheer.user.twitch"), Some("cheer"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:subscribe.user.twitch"), Some("subscribe"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:subscription.gift.twitch"), Some("sub_gift"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:hypetrain.channel.twitch"), Some("hypetrain"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:raid.user.twitch"), Some("raid"));
        assert_eq!(alert_type_for_canonical("twitch_platform:trigger:online.user.twitch"), Some("stream_online"));
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
            "acceptedEvents": ["twitch_platform:trigger:raid.user.twitch"],
            "settingsSchema": {
                "fields": [
                    { "key": "minViewers", "fieldType": "number", "label": "Minimum viewers", "defaultValue": 1 }
                ]
            }
        }))
        .expect("parse");
        let input = w.to_input();
        assert_eq!(input.manifest_id, "raid_counter");
        assert_eq!(input.name, "Raid Counter");
        assert_eq!(input.description, "Counts incoming raids.");
        assert_eq!(input.directory, "widgets/raid_counter");
        assert_eq!(input.alert_types, vec!["raid"]);
        // settings_schema is serialized JSON of the original Value.
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
        // No settings_schema -> default "{}" (parses cleanly server-side).
        assert_eq!(input.settings_schema, "{}");
        assert!(input.alert_types.is_empty());
    }

    #[test]
    fn widget_round_trips_through_serialization() {
        let j = r#"{
            "id": "raid_counter",
            "name": "Raid Counter",
            "entry": "widgets/raid_counter/index.html",
            "assets": "widgets/raid_counter",
            "acceptedEvents": ["twitch_platform:trigger:raid.user.twitch"]
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
}
