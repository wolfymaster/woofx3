// Engine → callback webhook event types. CloudEvents 1.0 envelope + the
// discriminated union of every event the engine POSTs to a registered
// client's callbackUrl.
//
// Source of truth for both sides:
//   - Engine runtime (api/src/webhook-client.ts) constructs envelopes using
//     these types and the EngineEventType constants.
//   - External clients (e.g. woofx3-ui's Convex webhook handler) import
//     from "@woofx3/api/webhooks" and narrow on event.type.
//
// The TypeScript subject list here mirrors the Go constants in
// shared/common/golang/cloudevents/subjects.go — keep them in sync when
// adding or renaming event types.

import type { WorkflowDefinition } from "./workflow-definition";

/**
 * Canonical event-type strings for every engine callback. Prefer
 * `EngineEventType.MODULE_INSTALLED` over the raw string in application
 * code so renames surface as compile errors instead of silent string drift.
 */
export const EngineEventType = {
  MODULE_INSTALLED: "module.installed",
  MODULE_INSTALL_FAILED: "module.install_failed",
  MODULE_DELETED: "module.deleted",
  MODULE_DELETE_FAILED: "module.delete_failed",
  MODULE_TRIGGER_REGISTERED: "module.trigger.registered",
  MODULE_ACTION_REGISTERED: "module.action.registered",
  MODULE_FUNCTION_REGISTERED: "module.function.registered",
  MODULE_WIDGET_REGISTERED: "module.widget.registered",
  MODULE_TRIGGER_DEREGISTERED: "module.trigger.deregistered",
  MODULE_ACTION_DEREGISTERED: "module.action.deregistered",
  MODULE_FUNCTION_DEREGISTERED: "module.function.deregistered",
  MODULE_WIDGET_DEREGISTERED: "module.widget.deregistered",
  MODULE_ASSET_REGISTERED: "module.asset.registered",
  MODULE_ASSET_DEREGISTERED: "module.asset.deregistered",
  MODULE_RESOURCE_INSTANCE_CREATED: "module.resource.instance.created",
  MODULE_RESOURCE_INSTANCE_DELETED: "module.resource.instance.deleted",
  MODULE_STORAGE_CHANGED: "module.storage.changed",
  ENGINE_RESPONSE_RECEIVED: "engine.response.received",
  WORKFLOW_CREATED: "workflow.created",
  WORKFLOW_UPDATED: "workflow.updated",
  WORKFLOW_DELETED: "workflow.deleted",
  SCENE_CREATED: "scene.created",
  SCENE_UPDATED: "scene.updated",
  SCENE_DELETED: "scene.deleted",
  ALERT_RECORDED: "alert.recorded",
  ALERT_REPLAYED: "alert.replayed",
} as const;

export type EngineEventType = (typeof EngineEventType)[keyof typeof EngineEventType];

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface TriggerDefinition {
  id: string;
  /** Canonical id `{moduleId}:trigger:{event}`. Populated on
   * deregistration events; eventually on registration events too. */
  canonicalId?: string;
  /**
   * Composite UI-projection identity: `{moduleKey}:trigger:{manifestId}`.
   * Stable across engine instances (the moduleKey hash is SHA-256 of the
   * zip, so identical installs produce identical keys), and version-pinned
   * (v1 and v2 of the same module produce distinct projectionKeys). The
   * UI uses this — not `id` (a per-engine UUID) and not `canonicalId`
   * (which omits version) — to dedupe definitions across multiple engine
   * instances projected into the same UI.
   *
   * Optional because non-MODULE triggers (SYSTEM built-ins, future
   * integrations) and legacy event deliveries don't carry one.
   */
  projectionKey?: string;
  category: string;
  name: string;
  description: string;
  event: string;
  configSchema: string;
  allowVariants: boolean;
  createdByType: string;
  createdByRef: string;
}

export interface ActionDefinition {
  id: string;
  /** Canonical id `{moduleId}:action:{manifest_id}`. Optional: not yet
   * derivable from the action row alone — see the deregistration payload
   * builder in db/app/services/module_event_payload.go for context. */
  canonicalId?: string;
  /**
   * Composite UI-projection identity: `{moduleKey}:action:{manifestId}`.
   * See TriggerDefinition.projectionKey for the rationale. Optional for
   * the same reasons (non-MODULE registrations, legacy events).
   */
  projectionKey?: string;
  name: string;
  description: string;
  call: string;
  paramsSchema: string;
  createdByType: string;
  createdByRef: string;
}

export interface ModuleUsageRef {
  sourceType: string;
  sourceId: string;
  sourceName: string;
  context: string;
}

export interface ModuleResourceUsage {
  resourceId: string;
  resourceType: string;
  /**
   * Canonical id for the in-use resource (e.g.
   * `twitch_platform:trigger:twitch.channel.cheer`). Stable identity,
   * not user-friendly — UI should display `resourceDisplayName`
   * instead and keep `resourceName` for tooltips / diagnostics.
   */
  resourceName: string;
  /**
   * Underlying row's `name` column resolved at check time
   * (e.g. "Channel Cheer" for a trigger). Empty when the engine
   * couldn't resolve a row — UI should fall back to `resourceName`
   * in that case.
   */
  resourceDisplayName?: string;
  usedBy: ModuleUsageRef[];
}

export interface ModuleTriggerRegisteredEvent {
  type: typeof EngineEventType.MODULE_TRIGGER_REGISTERED;
  moduleKey: string;
  moduleName: string;
  version: string;
  triggers: TriggerDefinition[];
}

export interface ModuleActionRegisteredEvent {
  type: typeof EngineEventType.MODULE_ACTION_REGISTERED;
  moduleKey: string;
  moduleName: string;
  version: string;
  actions: ActionDefinition[];
}

/**
 * One sandbox function exposed by an installed module. Mirrors the
 * Go-side ModuleFunction proto. Convex stores these in moduleFunctions
 * to power the chat-command function-type dropdown.
 */
export interface FunctionDefinition {
  id: string;
  /** Canonical id `{moduleId}:function:{manifestId}`. Populated on
   * deregistration events; eventually on registration events too. */
  canonicalId?: string;
  /**
   * Composite UI-projection identity: `{moduleKey}:function:{manifestId}`.
   * See TriggerDefinition.projectionKey. Functions are always
   * MODULE-owned today, so this is populated on every event from
   * sources that have the moduleKey context.
   */
  projectionKey?: string;
  moduleId: string;
  /** Stable manifest-local function id (e.g. "play_alert"). Used for
   * canonical id construction and as the path segment in barkloader
   * invocation (`{moduleName}/{manifestId}`). */
  manifestId: string;
  /** Display name for UI presentation; never used as an identifier. */
  name: string;
  fileName: string;
  entryPoint: string;
  runtime: string;
}

export interface ModuleFunctionRegisteredEvent {
  type: typeof EngineEventType.MODULE_FUNCTION_REGISTERED;
  moduleKey: string;
  moduleName: string;
  version: string;
  functions: FunctionDefinition[];
}

/**
 * One configurable setting on a widget — surfaced to the scene editor so the
 * user can tune behaviour per widget instance (e.g. minimum bits to display
 * for a cheer-feed widget). Field shape matches the UI's
 * `moduleWidgets.settings` schema verbatim.
 *
 * `fieldType` is a string (not a union) for forward-compat with custom field
 * types; the UI maps known values ("text", "number", "select", "color",
 * "boolean") to inputs and falls back to a text input for unknowns.
 */
export interface WidgetSettingDefinition {
  key: string;
  fieldType: string;
  label: string;
  defaultValue: unknown;
  options?: Array<{ label: string; value: string }>;
}

/**
 * One widget exposed by an installed module. Widgets are placeable
 * components for the Convex scene manager — the engine never renders them.
 * The UI persists these in `moduleWidgets` and lets the user drop them into
 * scenes (where they receive `AlertContext` events filtered by `alertTypes`).
 *
 * `directory` is the path inside the module zip that holds the widget's
 * frontend assets (HTML/JS/CSS bundle). The UI fetches this via the
 * widget-asset HTTP endpoint at render time.
 *
 * `alertTypes` declares which `AlertContext.type` values this widget knows
 * how to render. `["*"]` means "any alert" (subject to scene config).
 */
export interface WidgetDefinition {
  id: string;
  /**
   * Canonical id `{moduleId}:widget:{manifestId}`. Populated on
   * deregistration; eventually on registration too. Mirrors the
   * trigger/action/function precedent.
   */
  canonicalId?: string;
  /**
   * Composite UI-projection identity: `{moduleKey}:widget:{manifestId}`.
   * Stable across engine instances installing the same zip and
   * version-pinned (v1 / v2 distinct). The UI dedupes on this when the
   * same module is registered with multiple engines projected into one
   * Convex tenant. See `TriggerDefinition.projectionKey` for the full
   * rationale. Optional during rollout.
   */
  projectionKey?: string;
  /**
   * Stable manifest-local widget id (e.g. "raid_counter"). Used for
   * canonical id construction and as the path segment in widget-asset
   * URLs (`{moduleName}/widgets/{manifestId}`).
   */
  manifestId: string;
  /** Display name for UI presentation; never used as an identifier. */
  name: string;
  description?: string;
  /** Path inside the module zip that holds the widget's bundled assets. */
  directory: string;
  /**
   * Alert context types this widget consumes. `["*"]` = any. Empty array
   * means the widget does not render alerts (e.g. a static dashboard
   * widget driven by polled data only).
   */
  alertTypes: string[];
  /** Configuration surface offered to the scene editor. */
  settings: WidgetSettingDefinition[];
  createdByType: string;
  createdByRef: string;
}

export interface ModuleWidgetRegisteredEvent {
  type: typeof EngineEventType.MODULE_WIDGET_REGISTERED;
  moduleKey: string;
  moduleName: string;
  version: string;
  widgets: WidgetDefinition[];
}

/**
 * Symmetric counterpart to `ModuleTriggerRegisteredEvent` — fired when a
 * module's triggers are removed (most commonly during a module delete).
 * `modulePrefix` is the manifest id (the moduleId segment of the
 * canonical id) — sufficient on its own for subscribers to drop every
 * cached trigger belonging to that module wholesale.
 */
export interface ModuleTriggerDeregisteredEvent {
  type: typeof EngineEventType.MODULE_TRIGGER_DEREGISTERED;
  modulePrefix: string;
  triggers: TriggerDefinition[];
}

/** Symmetric counterpart to `ModuleActionRegisteredEvent`. */
export interface ModuleActionDeregisteredEvent {
  type: typeof EngineEventType.MODULE_ACTION_DEREGISTERED;
  modulePrefix: string;
  actions: ActionDefinition[];
}

/**
 * Symmetric counterpart to `ModuleFunctionRegisteredEvent`. Fired during
 * module delete after the module row (and its function rows via FK
 * cascade) has been removed.
 */
export interface ModuleFunctionDeregisteredEvent {
  type: typeof EngineEventType.MODULE_FUNCTION_DEREGISTERED;
  moduleKey: string;
  moduleName: string;
  version: string;
  functions: FunctionDefinition[];
}

/**
 * Symmetric counterpart to `ModuleWidgetRegisteredEvent`. Fired during
 * module delete after the module row (and its widget rows via FK cascade)
 * has been removed. Carries `moduleKey` rather than `modulePrefix` because
 * widgets are always emitted on full-module-delete — see the function
 * dereg precedent.
 */
export interface ModuleWidgetDeregisteredEvent {
  type: typeof EngineEventType.MODULE_WIDGET_DEREGISTERED;
  moduleKey: string;
  moduleName: string;
  version: string;
  widgets: WidgetDefinition[];
}

/**
 * One asset declared by a module's manifest, after the engine has
 * persisted it to its repository. Action `schema` fields with
 * `type: "asset"` reference assets by `canonicalId`; the editor maps
 * canonical id → public URL at config time and bakes that URL into the
 * saved workflow definition.
 *
 * URL resolution is the deployer's concern — the engine doesn't carry
 * a public URL on this row. `repositoryKey` is what the engine wrote
 * the bytes under; the deployer's CDN / storage adapter knows how to
 * turn that key into a fetchable URL.
 */
export interface AssetDefinition {
  /** Engine UUID. */
  id: string;
  /** Canonical id `{moduleId}:asset:{manifestId}`. */
  canonicalId: string;
  /** Composite UI-projection identity:
   *  `{moduleKey}:asset:{manifestId}`. See `TriggerDefinition.projectionKey`
   *  for rationale. */
  projectionKey: string;
  /** Stable manifest-local id. */
  manifestId: string;
  /** Display name for the editor's asset picker. */
  name: string;
  /** Optional human description. */
  description?: string;
  /** Engine-relative key under which the asset bytes were written
   *  (e.g. `modules/<moduleKey>/assets/<path>`). The deployer's
   *  storage adapter resolves this to a fetchable URL. */
  repositoryKey: string;
  /** Original path from the manifest, preserved so the editor can
   *  show it alongside the canonical id when useful. */
  manifestPath: string;
  /** Optional broad-category hint (`image` / `audio` / `video` /
   *  `font` / `data`). The editor uses this to filter the asset
   *  picker when an action's schema field declares
   *  `kinds: ["image"]`. */
  kind?: string;
  /** Optional MIME type override declared in the manifest. */
  contentType?: string;
  /** Provenance — same shape used on every other module-extension
   *  registration event. */
  createdByType: string;
  createdByRef: string;
}

/**
 * Fired during module install once the engine has persisted every
 * asset declared in `manifest.assets[]` to its repository. Carries
 * the same `(moduleKey, moduleName, version)` triplet as the function
 * / widget registration events for projection-key consistency.
 */
export interface ModuleAssetRegisteredEvent {
  type: typeof EngineEventType.MODULE_ASSET_REGISTERED;
  moduleKey: string;
  moduleName: string;
  version: string;
  assets: AssetDefinition[];
}

/**
 * Symmetric counterpart to `ModuleAssetRegisteredEvent`. Fired during
 * module delete after the module row (and its asset rows via FK
 * cascade) has been removed.
 */
export interface ModuleAssetDeregisteredEvent {
  type: typeof EngineEventType.MODULE_ASSET_DEREGISTERED;
  moduleKey: string;
  moduleName: string;
  version: string;
  assets: AssetDefinition[];
}

/**
 * Definition of a runtime-created module resource instance — the wire
 * shape projected from `module_resource_instances` rows. UI consumers
 * use `canonicalId` as the stable handle (it's what `resource_ref`
 * ConfigField values store) and `displayName` for human-readable labels.
 */
export interface ResourceInstanceDefinition {
  id: string;
  /** Owning module's UUID. */
  moduleId: string;
  /** Owning module's manifest id (e.g. `"counter"`). */
  moduleName: string;
  /** Module-declared kind (e.g. `"counter"`). Open namespace. */
  kind: string;
  /** Instance-local id. Forms canonical id `{moduleName}:{kind}:{instanceId}`. */
  instanceId: string;
  /** User-facing label. */
  displayName: string;
  /** Fully-formed canonical id. */
  canonicalId: string;
}

/**
 * Fired when a module command creates a runtime instance of a kind it
 * declared in `manifest.resources[]` (e.g. `counter.createCounter`).
 * UI pickers backed by `resource_ref(kind=...)` ConfigFields use this
 * to refresh live without polling.
 */
export interface ModuleResourceInstanceCreatedEvent {
  type: typeof EngineEventType.MODULE_RESOURCE_INSTANCE_CREATED;
  instance: ResourceInstanceDefinition;
}

/**
 * Symmetric counterpart to `ModuleResourceInstanceCreatedEvent`. Fired
 * when an instance is removed (via the owning module's delete command,
 * or as a future cascade from module uninstall).
 */
export interface ModuleResourceInstanceDeletedEvent {
  type: typeof EngineEventType.MODULE_RESOURCE_INSTANCE_DELETED;
  instance: ResourceInstanceDefinition;
}

/**
 * Fired when a module function writes to its persistent storage via
 * `ctx.storage.set()`. The engine auto-emits this on every successful
 * write — module authors don't opt in. UI consumers route this to widget
 * instances scoped on `(moduleId, key)`.
 *
 * `value` is the post-write value (already JSON-decoded). `previousValue`
 * is best-effort: emitted when the host had a cached prior read for the
 * same key. Subscribers must tolerate it being absent.
 */
export interface ModuleStorageChangedEvent {
  type: typeof EngineEventType.MODULE_STORAGE_CHANGED;
  moduleId: string;
  key: string;
  value: unknown;
  previousValue?: unknown;
  occurredAt: string;
}

/**
 * Generic reply envelope: the engine forwards a response to a request it
 * dispatched on behalf of a Convex action. Carried through to the UI via
 * the transientEvents row keyed on `correlationKey`.
 *
 * `data` is whatever the worker put in its NATS reply — opaque at this
 * boundary, the originating action knows the schema. `error` is set
 * instead of `data` when the dispatch failed (NATS timeout, no
 * subscriber, worker error, etc.).
 */
export interface EngineResponseReceivedEvent {
  type: typeof EngineEventType.ENGINE_RESPONSE_RECEIVED;
  correlationKey: string;
  status: "success" | "error";
  data?: unknown;
  error?: string;
}

export interface ModuleInstalledEvent {
  type: typeof EngineEventType.MODULE_INSTALLED;
  moduleName: string;
  version: string;
  moduleKey: string;
  alreadyInstalled?: boolean;
  /**
   * Catalog metadata extracted from the stored manifest at install
   * completion. `author` / `category` are guaranteed non-empty by the
   * engine — "Unknown" when the manifest omitted the field. `description`
   * may be blank. All three are optional on the wire so older engines
   * that pre-date this contract still validate.
   */
  author?: string;
  category?: string;
  description?: string;
}

export interface ModuleInstallFailedEvent {
  type: typeof EngineEventType.MODULE_INSTALL_FAILED;
  moduleName: string;
  version: string;
  moduleKey: string;
  error: string;
}

export interface ModuleDeletedEvent {
  type: typeof EngineEventType.MODULE_DELETED;
  moduleName: string;
  moduleKey: string;
}

export interface ModuleDeleteFailedEvent {
  type: typeof EngineEventType.MODULE_DELETE_FAILED;
  moduleName: string;
  moduleKey: string;
  error: string;
  inUseResources: ModuleResourceUsage[];
}

/**
 * Snapshot of a workflow row at the point a webhook was emitted. Echoed
 * back to Convex verbatim so it can upsert without re-fetching.
 */
export interface WorkflowSnapshot {
  id: string;
  definition: WorkflowDefinition;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * Composite UI-projection identity for module-installed workflows:
   * `{moduleKey}:workflow:{manifestId}`. Empty / undefined for
   * USER-authored workflows. See TriggerDefinition.projectionKey for
   * the full rationale — same role here for the workflow surface.
   */
  projectionKey?: string;
}

export interface WorkflowCreatedEvent {
  type: typeof EngineEventType.WORKFLOW_CREATED;
  applicationId: string;
  correlationKey?: string;
  workflow: WorkflowSnapshot;
}

export interface WorkflowUpdatedEvent {
  type: typeof EngineEventType.WORKFLOW_UPDATED;
  applicationId: string;
  correlationKey?: string;
  workflow: WorkflowSnapshot;
}

export interface WorkflowDeletedEvent {
  type: typeof EngineEventType.WORKFLOW_DELETED;
  applicationId: string;
  correlationKey?: string;
  workflowId: string;
  /**
   * Echoed for module-installed workflows so the UI can dedupe a delete
   * arriving from multiple engine instances pointing at the same
   * projection row. Empty / undefined for USER-authored workflows.
   */
  projectionKey?: string;
}

// ---------------------------------------------------------------------------
// Scene events
// ---------------------------------------------------------------------------

/**
 * Snapshot of a scene row at the point a webhook was emitted. Mirrors
 * `WorkflowSnapshot` in shape — the engine treats `widgetsJson` and
 * `layoutJson` as opaque strings; consumers parse them into typed
 * widget-instance arrays as needed.
 */
export interface SceneSnapshot {
  id: string;
  applicationId: string;
  name: string;
  description: string;
  /** JSON-encoded array of placed widget instances. Persisted in
   *  `scenes.widgets_json`; the engine never inspects the contents. */
  widgetsJson: string;
  /** JSON-encoded layout object (canvas dimensions, theme). */
  layoutJson: string;
  /** Origin metadata. `USER` for UI-authored scenes; `MODULE` if a
   *  future manifest surface ships preset scenes. */
  createdByType: string;
  createdByRef: string;
  createdAt: string;
  updatedAt: string;
}

export interface SceneCreatedEvent {
  type: typeof EngineEventType.SCENE_CREATED;
  applicationId: string;
  correlationKey?: string;
  scene: SceneSnapshot;
}

export interface SceneUpdatedEvent {
  type: typeof EngineEventType.SCENE_UPDATED;
  applicationId: string;
  correlationKey?: string;
  scene: SceneSnapshot;
}

export interface SceneDeletedEvent {
  type: typeof EngineEventType.SCENE_DELETED;
  applicationId: string;
  correlationKey?: string;
  sceneId: string;
}

// ---------------------------------------------------------------------------
// Alert log events
// ---------------------------------------------------------------------------

/**
 * One row in the engine's alert log. Captured every time the
 * workflow `alert` action publishes to `ui.notify.alert`. The
 * `payload` is the verbatim AlertPayload envelope (`{ id,
 * parameters, event }`) — same JSON streamware broadcasts to overlay
 * clients — so replay re-fires it identically.
 */
export interface AlertSnapshot {
  id: string;
  applicationId: string;
  /** Full AlertPayload envelope as a JSON string. The engine treats
   *  this as opaque on round-trip; callers parse into typed
   *  `parameters` (text / mediaUrl / audioUrl / duration / options /
   *  widget) as needed for display. */
  payload: string;
  /** Workflow execution id that fired the alert, when known. Empty
   *  string for manual / debug dispatches. */
  workflowId: string;
  /** Originating CloudEvent id from the trigger, when known. */
  sourceEventId: string;
  /** Lifecycle: `"sent"` (initial) | `"replayed"` | `"failed"`
   *  (reserved). */
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fired immediately after the engine records a freshly dispatched
 * alert. Lets the UI populate its alert-log page in real time
 * without polling.
 */
export interface AlertRecordedEvent {
  type: typeof EngineEventType.ALERT_RECORDED;
  applicationId: string;
  alert: AlertSnapshot;
}

/**
 * Fired after a previously recorded alert is replayed. Carries the
 * same row (with `status: "replayed"`) so the UI can update its log
 * entry without a separate fetch.
 */
export interface AlertReplayedEvent {
  type: typeof EngineEventType.ALERT_REPLAYED;
  applicationId: string;
  alert: AlertSnapshot;
}

/**
 * Discriminated union of every event the engine can deliver via webhook.
 * Consumers should narrow on `event.type` — TypeScript will pick the right
 * branch without casts.
 */
export type CallbackEvent =
  | ModuleTriggerRegisteredEvent
  | ModuleActionRegisteredEvent
  | ModuleFunctionRegisteredEvent
  | ModuleWidgetRegisteredEvent
  | ModuleTriggerDeregisteredEvent
  | ModuleActionDeregisteredEvent
  | ModuleFunctionDeregisteredEvent
  | ModuleWidgetDeregisteredEvent
  | ModuleAssetRegisteredEvent
  | ModuleAssetDeregisteredEvent
  | ModuleResourceInstanceCreatedEvent
  | ModuleResourceInstanceDeletedEvent
  | ModuleStorageChangedEvent
  | ModuleInstalledEvent
  | ModuleInstallFailedEvent
  | ModuleDeletedEvent
  | ModuleDeleteFailedEvent
  | EngineResponseReceivedEvent
  | WorkflowCreatedEvent
  | WorkflowUpdatedEvent
  | WorkflowDeletedEvent
  | SceneCreatedEvent
  | SceneUpdatedEvent
  | SceneDeletedEvent
  | AlertRecordedEvent
  | AlertReplayedEvent;

/**
 * Lookup from event-type string → payload type. Useful for emitter code
 * that knows its type at compile time and wants to validate the payload.
 */
export type CallbackEventByType = {
  [EngineEventType.MODULE_TRIGGER_REGISTERED]: ModuleTriggerRegisteredEvent;
  [EngineEventType.MODULE_ACTION_REGISTERED]: ModuleActionRegisteredEvent;
  [EngineEventType.MODULE_FUNCTION_REGISTERED]: ModuleFunctionRegisteredEvent;
  [EngineEventType.MODULE_WIDGET_REGISTERED]: ModuleWidgetRegisteredEvent;
  [EngineEventType.MODULE_TRIGGER_DEREGISTERED]: ModuleTriggerDeregisteredEvent;
  [EngineEventType.MODULE_ACTION_DEREGISTERED]: ModuleActionDeregisteredEvent;
  [EngineEventType.MODULE_FUNCTION_DEREGISTERED]: ModuleFunctionDeregisteredEvent;
  [EngineEventType.MODULE_WIDGET_DEREGISTERED]: ModuleWidgetDeregisteredEvent;
  [EngineEventType.MODULE_ASSET_REGISTERED]: ModuleAssetRegisteredEvent;
  [EngineEventType.MODULE_ASSET_DEREGISTERED]: ModuleAssetDeregisteredEvent;
  [EngineEventType.MODULE_RESOURCE_INSTANCE_CREATED]: ModuleResourceInstanceCreatedEvent;
  [EngineEventType.MODULE_RESOURCE_INSTANCE_DELETED]: ModuleResourceInstanceDeletedEvent;
  [EngineEventType.MODULE_STORAGE_CHANGED]: ModuleStorageChangedEvent;
  [EngineEventType.MODULE_INSTALLED]: ModuleInstalledEvent;
  [EngineEventType.MODULE_INSTALL_FAILED]: ModuleInstallFailedEvent;
  [EngineEventType.MODULE_DELETED]: ModuleDeletedEvent;
  [EngineEventType.MODULE_DELETE_FAILED]: ModuleDeleteFailedEvent;
  [EngineEventType.ENGINE_RESPONSE_RECEIVED]: EngineResponseReceivedEvent;
  [EngineEventType.WORKFLOW_CREATED]: WorkflowCreatedEvent;
  [EngineEventType.WORKFLOW_UPDATED]: WorkflowUpdatedEvent;
  [EngineEventType.WORKFLOW_DELETED]: WorkflowDeletedEvent;
  [EngineEventType.SCENE_CREATED]: SceneCreatedEvent;
  [EngineEventType.SCENE_UPDATED]: SceneUpdatedEvent;
  [EngineEventType.SCENE_DELETED]: SceneDeletedEvent;
  [EngineEventType.ALERT_RECORDED]: AlertRecordedEvent;
  [EngineEventType.ALERT_REPLAYED]: AlertReplayedEvent;
};

// ---------------------------------------------------------------------------
// CloudEvents 1.0 envelope
// ---------------------------------------------------------------------------

/**
 * CloudEvents 1.0 envelope specialized for woofx3 engine webhooks. Conforms
 * to the CNCF CloudEvents spec (https://github.com/cloudevents/spec) so the
 * payload is portable across NATS, HTTP, and future transports.
 *
 * `specversion` is the literal "1.0" — this field's presence is how a
 * receiver identifies a CloudEvent. `type` mirrors `data.type` for
 * envelope-level routing without parsing `data`.
 */
export interface CallbackEnvelope {
  specversion: "1.0";
  id: string;
  source: string;
  type: EngineEventType;
  time: string;
  datacontenttype?: string;
  subject?: string;
  data: CallbackEvent;
}

/**
 * Constructor for a CloudEvents-compliant envelope. Validates that the
 * outer `type` matches `data.type` at compile time — pass a typed event
 * and the correct type literal is inferred.
 */
export function makeCallbackEnvelope<E extends CallbackEvent>(
  event: E,
  source = "engine",
  id: string = globalThis.crypto?.randomUUID() ?? "",
  time: string = new Date().toISOString()
): CallbackEnvelope {
  return {
    specversion: "1.0",
    id,
    source,
    type: event.type,
    time,
    datacontenttype: "application/json",
    data: event,
  };
}
