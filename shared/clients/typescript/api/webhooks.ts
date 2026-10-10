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

import type { RelayConfig, StreamSession, StreamSessionTotals, WorkflowHealth } from "./api";
/**
 * Canonical event-type strings for every engine callback. Prefer
 * `EngineEventType.MODULE_INSTALLED` over the raw string in application
 * code so renames surface as compile errors instead of silent string drift.
 */
import type { ConfigField, WidgetSurface } from "./ui-schema";
import type { WorkflowDefinition } from "./workflow-definition";

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
  MODULE_RESOURCE_INSTANCE_UPDATED: "module.resource.instance.updated",
  MODULE_RESOURCE_INSTANCE_DELETED: "module.resource.instance.deleted",
  MODULE_STORAGE_CHANGED: "module.storage.changed",
  ENGINE_RESPONSE_RECEIVED: "engine.response.received",
  WORKFLOW_CREATED: "workflow.created",
  WORKFLOW_UPDATED: "workflow.updated",
  WORKFLOW_DELETED: "workflow.deleted",
  WORKFLOW_RUN_STARTED: "workflow.run.started",
  WORKFLOW_RUN_COMPLETED: "workflow.run.completed",
  WORKFLOW_RUN_FAILED: "workflow.run.failed",
  WORKFLOW_RUN_CANCELLED: "workflow.run.cancelled",
  WORKFLOW_HEALTH_CHANGED: "workflow.health.changed",
  WORKFLOW_HEALTH_SNAPSHOT: "workflow.health.snapshot",
  // Persisted run history, projected from the db-proxy outbox. Distinct from
  // the three above on purpose: those are live lifecycle notifications for a
  // caller waiting on one run, these are database rows for the history nobody
  // was watching. Same subject prefix, different source and different fate.
  WORKFLOW_RUN_RECORDED: "workflow.run.recorded",
  WORKFLOW_RUN_UPDATED: "workflow.run.updated",
  WORKFLOW_RUN_STEP_RECORDED: "workflow.run.step.recorded",
  SCENE_CREATED: "scene.created",
  SCENE_UPDATED: "scene.updated",
  SCENE_DELETED: "scene.deleted",
  ALERT_RECORDED: "alert.recorded",
  ALERT_PLAYING: "alert.playing",
  ALERT_REPLAYED: "alert.replayed",
  ALERT_COMPLETED: "alert.completed",
  ALERT_FAILED: "alert.failed",
  ALERT_TIMED_OUT: "alert.timed_out",
  ALERT_SKIPPED: "alert.skipped",
  WIDGET_STATUS_CHANGED: "module.widget.status.changed",
  STREAM_ONLINE: "stream.online",
  STREAM_OFFLINE: "stream.offline",
  SESSION_STARTED: "session.started",
  SESSION_SUMMARY: "session.summary",
  OVERLAY_TOKEN_MINTED: "overlay.token.minted",
  OVERLAY_TOKEN_REVOKED: "overlay.token.revoked",
  COMMAND_CREATED: "command.created",
  COMMAND_UPDATED: "command.updated",
  COMMAND_DELETED: "command.deleted",
  GROUP_CREATED: "group.created",
  GROUP_UPDATED: "group.updated",
  GROUP_DELETED: "group.deleted",
  GROUP_MEMBER_ADDED: "group.member_added",
  GROUP_MEMBER_REMOVED: "group.member_removed",
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
   * UI-projection identity: `{modulePrefix}:trigger:{manifestId}`. The UI
   * uses this — not `id`, a per-engine UUID — to dedupe definitions across
   * multiple engine instances projected into the same UI.
   *
   * Deliberately NOT version-pinned: an upgrade upserts the trigger row in
   * place, so a workflow referencing it keeps resolving. Use the event's
   * `moduleKey` when you need to know which version is installed.
   * (FunctionDefinition.projectionKey is the one exception — see there.)
   *
   * Optional because non-MODULE triggers (SYSTEM built-ins, future
   * integrations) and legacy event deliveries don't carry one.
   */
  projectionKey?: string;
  /**
   * Open, multi-valued UI classification — dotted hierarchical strings
   * (e.g. `"platform.twitch.chat"`). Multiple entries express independent
   * classification axes on the same trigger. Not validated against a
   * fixed vocabulary. Replaces the legacy single-value `category` field.
   */
  taxonomy: string[];
  name: string;
  description: string;
  event: string;
  configSchema: string;
  /**
   * JSON-encoded `DataShape` naming what `trigger.data` carries when this
   * trigger fires: `{"fields":[{"path","type","description?","example?"}]}`.
   *
   * Not a schema and not validated against — it answers "which paths can be
   * referenced". Distinct from `configSchema`, which is the configuration
   * form: only config fields carrying an `eventPath` become workflow
   * variables, so a trigger emitting payload keys it does not also expose as
   * config fields has no other way to advertise them. Absent means fall back
   * to the configSchema derivation. Parse with `parseDataShape` from
   * `./ui-schema`.
   */
  emits?: string;
  /**
   * The module author's one-line English template for a configured instance
   * of this trigger, e.g. `"{reward} is redeemed"`. Each `{fieldId}` names a
   * field in `configSchema`; render it by substituting the configured value,
   * that field's `anyText` when it is set to "any", or its `missingText` while
   * a required field has no value. Barkloader guarantees at install that the
   * braces are balanced and every placeholder names a field. Absent means the
   * author declared none.
   */
  sentence?: string;
  allowVariants: boolean;
  createdByType: string;
  createdByRef: string;
  /**
   * The manifest trigger `type`. `"webhook"` marks a trigger fired by inbound
   * HTTP through its module's handler: nothing binds to it, so the workflow
   * builder hides it. Absent on events from engines that predate the field;
   * treat that as `"eventbus"`.
   */
  transport?: string;
}

export interface ActionDefinition {
  id: string;
  /** Canonical id `{moduleId}:action:{manifest_id}`. Optional: not yet
   * derivable from the action row alone — see the deregistration payload
   * builder in db/app/services/module_event_payload.go for context. */
  canonicalId?: string;
  /**
   * UI-projection identity: `{modulePrefix}:action:{manifestId}`. See
   * TriggerDefinition.projectionKey for the rationale — likewise not
   * version-pinned. Optional for the same reasons (non-MODULE
   * registrations, legacy events).
   */
  projectionKey?: string;
  /** See TriggerDefinition.taxonomy. */
  taxonomy: string[];
  name: string;
  description: string;
  call: string;
  /**
   * Engine action handler this action dispatches through (`function`,
   * `alert`, `print`). A `function` action carries the canonical function id
   * in `call`; a native action names its handler here and leaves `call`
   * empty, so consumers must read this rather than infer from `call`.
   */
  type: string;
  paramsSchema: string;
  /**
   * JSON-encoded `DataShape` naming what this action's function hands back
   * (e.g. the counter module's increment action returns `{next, previous}`).
   * Powers the workflow builder's `${stepId.field}` variable autocomplete.
   *
   * Replaces `outputSchema`, which said the same thing in ConfigField shape.
   * Not a schema: the engine treats a function result as opaque at runtime and
   * never validates it against this. Absent means nothing was declared. Parse
   * with `parseDataShape` from `./ui-schema`.
   */
  returns?: string;
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
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). This is what the
   * engine keys the underlying rows on, so it stays stable across module
   * upgrades — pair it with `moduleKey` when you need the exact version.
   */
  modulePrefix: string;
  moduleKey: string;
  moduleName: string;
  version: string;
  triggers: TriggerDefinition[];
}

export interface ModuleActionRegisteredEvent {
  type: typeof EngineEventType.MODULE_ACTION_REGISTERED;
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). This is what the
   * engine keys the underlying rows on, so it stays stable across module
   * upgrades — pair it with `moduleKey` when you need the exact version.
   */
  modulePrefix: string;
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
   * UI-projection identity: `{moduleKey}:function:{manifestId}`.
   *
   * Unlike every other surface this one IS version-pinned, deliberately: a
   * function's source can change while its manifest id stays the same, so
   * v1 and v2 of the same function must project as distinct rows.
   * Functions are always MODULE-owned today, so this is populated on every
   * event from sources that have the moduleKey context.
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
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). This is what the
   * engine keys the underlying rows on, so it stays stable across module
   * upgrades — pair it with `moduleKey` when you need the exact version.
   */
  modulePrefix: string;
  moduleKey: string;
  moduleName: string;
  version: string;
  functions: FunctionDefinition[];
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
  /**
   * The fields a user fills in when placing this widget on a scene — the same
   * `ConfigField` vocabulary a trigger's or action's schema uses. It was once
   * its own shape (`key` / `fieldType`), which is how a widget declaring five
   * settings in the trigger-style container came to render none of them.
   */
  settings: ConfigField[];
  /** Where this widget may be placed. */
  surfaces: WidgetSurface[];
  /**
   * The surface this widget's placements host, when it is a host: an
   * `"alert"` widget is the area of a scene that plays alert layouts.
   */
  hostsSurface?: WidgetSurface;
  /**
   * Open, multi-valued dotted classification (`["media.video"]`), the same
   * axis triggers and actions carry. A catalog groups on it rather than on
   * the module that shipped the widget. Empty when none was declared.
   */
  taxonomy: string[];
  /**
   * Transition types the widget plays on its own content, offered beside the
   * generic ones when a placement picks how it enters and leaves. Empty when
   * it declares none.
   */
  transitions: WidgetTransitionDefinition[];
  createdByType: string;
  createdByRef: string;
}

/** A transition type a widget declares: `id` is what a placement names. */
export interface WidgetTransitionDefinition {
  id: string;
  label: string;
}

export interface ModuleWidgetRegisteredEvent {
  type: typeof EngineEventType.MODULE_WIDGET_REGISTERED;
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). This is what the
   * engine keys the underlying rows on, so it stays stable across module
   * upgrades — pair it with `moduleKey` when you need the exact version.
   */
  modulePrefix: string;
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
  /**
   * Composite `{moduleId}:{version}:{hash}` of the module the rows belong
   * to — the same identity `module.installed` / `module.deleted` carry, so
   * a consumer that indexes modules by those events can match this one.
   */
  moduleKey: string;
  triggers: TriggerDefinition[];
}

/** Symmetric counterpart to `ModuleActionRegisteredEvent`. */
export interface ModuleActionDeregisteredEvent {
  type: typeof EngineEventType.MODULE_ACTION_DEREGISTERED;
  modulePrefix: string;
  /**
   * Composite `{moduleId}:{version}:{hash}` of the module the rows belong
   * to — the same identity `module.installed` / `module.deleted` carry, so
   * a consumer that indexes modules by those events can match this one.
   */
  moduleKey: string;
  actions: ActionDefinition[];
}

/**
 * Symmetric counterpart to `ModuleFunctionRegisteredEvent`. Fired during
 * module delete after the module row (and its function rows via FK
 * cascade) has been removed.
 */
export interface ModuleFunctionDeregisteredEvent {
  type: typeof EngineEventType.MODULE_FUNCTION_DEREGISTERED;
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). This is what the
   * engine keys the underlying rows on, so it stays stable across module
   * upgrades — pair it with `moduleKey` when you need the exact version.
   */
  modulePrefix: string;
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
  modulePrefix: string;
  moduleName: string;
  version: string;
  /**
   * Composite `{moduleId}:{version}:{hash}` of the module the rows belong
   * to — the same identity `module.installed` / `module.deleted` carry, so
   * a consumer that indexes modules by those events can match this one.
   */
  moduleKey: string;
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
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). This is what the
   * engine keys the underlying rows on, so it stays stable across module
   * upgrades — pair it with `moduleKey` when you need the exact version.
   */
  modulePrefix: string;
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
  modulePrefix: string;
  /**
   * Composite `{moduleId}:{version}:{hash}` of the module the rows belong
   * to — the same identity `module.installed` / `module.deleted` carry, so
   * a consumer that indexes modules by those events can match this one.
   */
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
  /**
   * Owning module's stable composite key (`{moduleId}:{version}:{hash}`).
   * Unlike `moduleId` (a raw engine UUID) or `moduleName` (ambiguous across
   * multiple installs/instances sharing a name), this is what consumers
   * should resolve the owning module by — mirrors widget snapshots'
   * `createdByRef`.
   */
  moduleKey: string;
  /**
   * What the instance was created with: the values of its kind's `schema`
   * fields. The engine keeps them without interpreting them.
   */
  settings: Record<string, unknown>;
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
 * Fired when an instance is renamed or its settings change. Identity never
 * changes, so consumers keyed on the canonical id patch in place.
 */
export interface ModuleResourceInstanceUpdatedEvent {
  type: typeof EngineEventType.MODULE_RESOURCE_INSTANCE_UPDATED;
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
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). Matches the
   * `modulePrefix` on this module's definition events, so a consumer can
   * tie them together without parsing the composite key.
   */
  modulePrefix: string;
  moduleName: string;
  version: string;
  moduleKey: string;
  alreadyInstalled?: boolean;
  /**
   * Catalog metadata extracted from the stored manifest at install
   * completion. `author` is guaranteed non-empty by the engine —
   * "Unknown" when the manifest omitted the field. `taxonomy` is the
   * manifest's `taxonomy` array (falling back to the legacy single-value
   * `category` when present, otherwise empty — see moduleCatalogFields in
   * db/app/services/module_event_payload.go). `description` may be
   * blank. All fields are optional on the wire so older engines that
   * pre-date this contract still validate.
   */
  author?: string;
  taxonomy?: string[];
  description?: string;
}

export interface ModuleInstallFailedEvent {
  type: typeof EngineEventType.MODULE_INSTALL_FAILED;
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). Matches the
   * `modulePrefix` on this module's definition events, so a consumer can
   * tie them together without parsing the composite key.
   */
  modulePrefix: string;
  moduleName: string;
  version: string;
  moduleKey: string;
  error: string;
}

export interface ModuleDeletedEvent {
  type: typeof EngineEventType.MODULE_DELETED;
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). Matches the
   * `modulePrefix` on this module's definition events, so a consumer can
   * tie them together without parsing the composite key.
   */
  modulePrefix: string;
  moduleName: string;
  moduleKey: string;
}

export interface ModuleDeleteFailedEvent {
  type: typeof EngineEventType.MODULE_DELETE_FAILED;
  /**
   * Version-free manifest id (e.g. `"twitch_platform"`). Matches the
   * `modulePrefix` on this module's definition events, so a consumer can
   * tie them together without parsing the composite key.
   */
  modulePrefix: string;
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
  /** See TriggerDefinition.taxonomy. Set at creation time only. */
  taxonomy: string[];
}

export interface WorkflowCreatedEvent {
  type: typeof EngineEventType.WORKFLOW_CREATED;
  correlationKey?: string;
  workflow: WorkflowSnapshot;
}

export interface WorkflowUpdatedEvent {
  type: typeof EngineEventType.WORKFLOW_UPDATED;
  correlationKey?: string;
  workflow: WorkflowSnapshot;
}

export interface WorkflowDeletedEvent {
  type: typeof EngineEventType.WORKFLOW_DELETED;
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
  correlationKey?: string;
  scene: SceneSnapshot;
}

export interface SceneUpdatedEvent {
  type: typeof EngineEventType.SCENE_UPDATED;
  correlationKey?: string;
  scene: SceneSnapshot;
}

export interface SceneDeletedEvent {
  type: typeof EngineEventType.SCENE_DELETED;
  correlationKey?: string;
  sceneId: string;
}

// ---------------------------------------------------------------------------
// Command events
// ---------------------------------------------------------------------------

/**
 * Snapshot of a chat command row at the point a webhook was emitted.
 * Mirrors `CommandSnapshot` in `./api` field-for-field (kept as a separate
 * local type, same precedent as `WorkflowSnapshot`/`SceneSnapshot`, to avoid
 * a circular import between this file and `./api`).
 */
export interface CommandWebhookSnapshot {
  id: string;
  command: string;
  /** The actions this command runs, in order -- `ActionStep` in api.ts. */
  actions: Array<{
    id?: string;
    action: string;
    function?: string;
    parameters?: Record<string, unknown>;
    $ref?: string;
    dependsOn?: string[];
  }>;
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: "public" | "restricted";
  groupIds: string[];
  usernames: string[];
  argumentPattern: string;
}

export interface CommandCreatedEvent {
  type: typeof EngineEventType.COMMAND_CREATED;
  correlationKey?: string;
  command: CommandWebhookSnapshot;
}

export interface CommandUpdatedEvent {
  type: typeof EngineEventType.COMMAND_UPDATED;
  correlationKey?: string;
  command: CommandWebhookSnapshot;
}

export interface CommandDeletedEvent {
  type: typeof EngineEventType.COMMAND_DELETED;
  correlationKey?: string;
  commandId: string;
}

// ---------------------------------------------------------------------------
// Group ("user group" / role) events
// ---------------------------------------------------------------------------

/** Snapshot of a group row at the point a webhook was emitted. Mirrors
 * `GroupSnapshot` in `./api` field-for-field. */
export interface GroupWebhookSnapshot {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  /** See GroupSnapshot.isBuiltIn in ./api. The group.* webhooks carry the full
   *  snapshot, so this was always on the wire — it was simply missing here. */
  isBuiltIn: boolean;
}

export interface GroupCreatedEvent {
  type: typeof EngineEventType.GROUP_CREATED;
  correlationKey?: string;
  group: GroupWebhookSnapshot;
}

export interface GroupUpdatedEvent {
  type: typeof EngineEventType.GROUP_UPDATED;
  correlationKey?: string;
  group: GroupWebhookSnapshot;
}

export interface GroupDeletedEvent {
  type: typeof EngineEventType.GROUP_DELETED;
  correlationKey?: string;
  groupId: string;
}

/**
 * Fired when a user is added to a group via `addUserToGroup`. Carries just
 * the ids/username, not a full membership list — consumers that show a
 * member roster should refetch via `listGroupMembers(groupId)` on receipt
 * rather than trying to reconstruct the list from a stream of these events.
 */
export interface GroupMemberAddedEvent {
  type: typeof EngineEventType.GROUP_MEMBER_ADDED;
  correlationKey?: string;
  groupId: string;
  username: string;
}

/** Symmetric counterpart to `GroupMemberAddedEvent`. */
export interface GroupMemberRemovedEvent {
  type: typeof EngineEventType.GROUP_MEMBER_REMOVED;
  correlationKey?: string;
  groupId: string;
  username: string;
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
  /**
   * Lifecycle. The engine writes:
   *   `"sent"`      — recorded as the engine published it; nothing has
   *                   reported it since
   *   `"playing"`   — an overlay started playing it: the in-progress signal
   *   `"completed"` — an overlay finished playing it
   *   `"failed"`    — it could not play (no overlay to play it on, or an
   *                   overlay reported a render / playback error)
   *   `"skipped"`   — an operator skipped or cleared it
   *   `"replayed"`  — an operator re-fired this row; the re-fire is a row of
   *                   its own
   * A row only moves forward through these, and the first verdict
   * (`completed`, `failed`, `timed_out`, `skipped`) wins, with two
   * exceptions. `completed` replaces any other verdict: an alert plays on
   * every widget that answers to its target, and one widget playing it to the
   * end means viewers saw it. `failed` and `skipped` replace `timed_out`,
   * because a timeout is the engine giving up on hearing back and a late
   * report is the truth. `replayed` may follow any status but itself. Every
   * other write is refused and publishes nothing: one that would move the row
   * back, repeat its status, replace a verdict otherwise, or replay a row
   * already replayed. `"timed_out"` has a callback (`alert.timed_out`) but no
   * engine service writes it yet.
   *
   * A report names the alert's envelope, and moves only the newest row for
   * it: an earlier row with the same envelope id is an earlier play and keeps
   * the status it reached.
   */
  status: string;
  /**
   * Denormalised AlertPayload envelope id (`payload->>'id'`). Stable
   * across the alert's lifetime; the overlay's status reports key on
   * this. Empty for legacy / manual rows that pre-date the column.
   */
  envelopeId?: string;
  /** Set when the engine published the envelope to NATS. */
  dispatchedAt?: string;
  /** Set when the overlay reported `playing`. */
  playedAt?: string;
  /** Set by the first verdict. */
  completedAt?: string;
  /** Failure reason captured with a `failed` or `timed_out` verdict. Absent
   *  otherwise: `completed` or `skipped` replacing such a verdict clears it. */
  error?: string;
  /**
   * Counts the writes applied to the row, starting at 1 when it is recorded.
   * The database increments it with every write it publishes, so each
   * snapshot of an alert carries a distinct version, in the order the writes
   * were applied.
   *
   * Lifecycle callbacks are retried independently and can arrive out of
   * order: a receiver keeps the snapshot with the highest version. An equal
   * version is the same write delivered again, and a lower one is a write the
   * receiver has already moved past. The engine alone enforces the lifecycle
   * rule (see `status`) and publishes only the writes it applied, so a
   * receiver does not re-check it.
   *
   * A snapshot may lack a version; a receiver then orders it by the lifecycle
   * stage and `updatedAt`.
   */
  version?: number;
  /** Every timestamp in a snapshot is RFC 3339 in UTC with nine fractional
   *  digits. */
  createdAt: string;
  /**
   * When the engine last wrote the row, by the database's clock. Order
   * snapshots by `version`, which cannot tie; this is the fallback for a
   * snapshot without one.
   */
  updatedAt: string;
}

/**
 * Fired when the engine begins a workflow run.
 *
 * Worth as much as the terminal events: nothing else acknowledges that an
 * event matched a workflow at all, so a caller waiting on an outcome cannot
 * otherwise tell a slow run from one that never started.
 *
 * `triggerId` is echoed unchanged from the event that caused the run and is
 * the only join back to whoever asked for it. Absent whenever nobody is
 * waiting, which is nearly every run.
 */
export interface WorkflowRunStartedEvent {
  type: typeof EngineEventType.WORKFLOW_RUN_STARTED;
  workflowId: string;
  executionId: string;
  triggerId?: string;
  triggeredBy?: string;
  occurredAt: string;
}

/** Fired when a workflow run finishes with every task succeeding. */
export interface WorkflowRunCompletedEvent {
  type: typeof EngineEventType.WORKFLOW_RUN_COMPLETED;
  workflowId: string;
  executionId: string;
  triggerId?: string;
  triggeredBy?: string;
  occurredAt: string;
}

/**
 * Fired when a workflow run ends without completing.
 *
 * `error` is the engine's own reason, which for a refused alert step is the
 * message `validateAlertParams` produced -- the same vocabulary the dashboard
 * already turns into readable copy.
 */
export interface WorkflowRunFailedEvent {
  type: typeof EngineEventType.WORKFLOW_RUN_FAILED;
  workflowId: string;
  executionId: string;
  triggerId?: string;
  triggeredBy?: string;
  error: string;
  occurredAt: string;
}

/**
 * Fired when a run ends because somebody cancelled it. `reason` is the
 * engine's own wording, "cancelled: <reason given>".
 */
export interface WorkflowRunCancelledEvent {
  type: typeof EngineEventType.WORKFLOW_RUN_CANCELLED;
  workflowId: string;
  executionId: string;
  triggerId?: string;
  triggeredBy?: string;
  reason: string;
  occurredAt: string;
}

/**
 * Fired when one workflow's health changes: an error appears, its reason
 * changes, or it clears. Sent on change only, never on every retry, so each
 * one is news. An `"ok"` also arrives when an errored workflow is disabled or
 * deleted. A workflow that loads fine and never had an error sends nothing.
 *
 * Apply on top of the latest WorkflowHealthSnapshotEvent. Changes to one
 * workflow can arrive out of order; keep the one with the later `since`.
 */
export interface WorkflowHealthChangedEvent extends WorkflowHealth {
  type: typeof EngineEventType.WORKFLOW_HEALTH_CHANGED;
}

/**
 * The whole health picture, authoritative: replace every stored health with
 * this. `workflows` lists only workflows in error; any workflow not listed is
 * ok.
 *
 * Sent once when the engine finishes loading its workflows after it starts,
 * and by the api when it starts or its message-bus connection comes back, so
 * errors from before a restart or a gap in delivery do not linger.
 */
export interface WorkflowHealthSnapshotEvent {
  type: typeof EngineEventType.WORKFLOW_HEALTH_SNAPSHOT;
  /** Errors only. */
  workflows: WorkflowHealth[];
  /** ISO 8601. When the engine took the snapshot. */
  at: string;
}

/**
 * A persisted run, as the database holds it.
 *
 * `triggerEvent` is the originating CloudEvent verbatim, the same way
 * AlertSnapshot.payload carries an alert envelope: opaque here, and the thing
 * a replay re-feeds to the engine unchanged.
 */
export interface WorkflowRunSnapshot {
  id: string;
  workflowId: string;
  status: string;
  /** What caused the run ("twitch", "chat", ...). Never "dashboard": those are not recorded. */
  triggeredBy?: string;
  /** JSON of the originating CloudEvent. */
  triggerEvent?: string;
  /**
   * True for a dry run: its side-effecting steps recorded what they would
   * have done (`{ dryRun: true, wouldDo }` in their outputs) instead of doing
   * it. Absent for a real run.
   */
  dryRun?: boolean;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One task's outcome within a persisted run.
 *
 * `inputs` is the parameters as resolved at run time, which the definition
 * cannot reproduce; `outputs` is the task's exports, which is what later steps
 * resolved against and therefore what a resume restores. Both are JSON strings
 * rather than objects: they are arbitrarily nested engine values and nothing
 * between here and the timeline needs to read inside them.
 */
export interface WorkflowRunStepSnapshot {
  id: string;
  executionId: string;
  taskId: string;
  name?: string;
  status: string;
  attempt: number;
  stepIndex: number;
  inputs?: string;
  outputs?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
}

/** Fired when the engine records a run it has started. */
export interface WorkflowRunRecordedEvent {
  type: typeof EngineEventType.WORKFLOW_RUN_RECORDED;
  run: WorkflowRunSnapshot;
}

/** Fired when a recorded run reaches its terminal state. */
export interface WorkflowRunUpdatedEvent {
  type: typeof EngineEventType.WORKFLOW_RUN_UPDATED;
  run: WorkflowRunSnapshot;
}

/** Fired when a step within a recorded run settles. */
export interface WorkflowRunStepRecordedEvent {
  type: typeof EngineEventType.WORKFLOW_RUN_STEP_RECORDED;
  step: WorkflowRunStepSnapshot;
}

/**
 * Fired immediately after the engine records a freshly dispatched
 * alert. Lets the UI populate its alert-log page in real time
 * without polling.
 */
export interface AlertRecordedEvent {
  type: typeof EngineEventType.ALERT_RECORDED;
  alert: AlertSnapshot;
}

/**
 * Fired when an alert's row moves to `playing`: an overlay reported it started
 * playing. Lets a receiver tell an alert that is on screen from one the engine
 * lost track of, without waiting for the verdict. Sent once per alert: when
 * several overlays play it, only the first start moves the row.
 */
export interface AlertPlayingEvent {
  type: typeof EngineEventType.ALERT_PLAYING;
  alert: AlertSnapshot;
}

/**
 * Fired after a previously recorded alert is replayed. Carries the
 * same row (with `status: "replayed"`) so the UI can update its log
 * entry without a separate fetch.
 */
export interface AlertReplayedEvent {
  type: typeof EngineEventType.ALERT_REPLAYED;
  alert: AlertSnapshot;
}

/**
 * Fired when the overlay reports an alert finished playing
 * (`status: "completed"`). Lets the dashboard show terminal state
 * for an alert without polling. The `alert.completedAt` and
 * `alert.playedAt` timestamps narrate the full lifecycle.
 */
export interface AlertCompletedEvent {
  type: typeof EngineEventType.ALERT_COMPLETED;
  alert: AlertSnapshot;
}

/**
 * Fired when the overlay reports an alert failed to render or play
 * (`status: "failed"`). `alert.error` carries the captured reason
 * (autoplay block, missing media, codec issue, etc.).
 */
export interface AlertFailedEvent {
  type: typeof EngineEventType.ALERT_FAILED;
  alert: AlertSnapshot;
}

/**
 * Fired when the api's AlertQueueManager (Phase 2) gives up on a
 * dispatched alert because the overlay never reported `playing` /
 * `completed` within the lease window (typically `duration + 5s`).
 * Reasons include: no overlay connected, browser tab frozen,
 * autoplay block with no error event. The queue advances to the
 * next pending alert; operators can `replayAlert(id)` to retry.
 */
export interface AlertTimedOutEvent {
  type: typeof EngineEventType.ALERT_TIMED_OUT;
  alert: AlertSnapshot;
}

/**
 * Fired when an operator skips the currently-playing alert or
 * clears pending alerts via the Phase 3 controls
 * (`skipCurrentAlert` / `clearAlertQueue`). The alert row's
 * lifecycle ends at `skipped` rather than `completed` /
 * `timed_out`. Useful for the dashboard's alert log so it can
 * distinguish operator-driven dismissals from natural completion.
 */
export interface AlertSkippedEvent {
  type: typeof EngineEventType.ALERT_SKIPPED;
  alert: AlertSnapshot;
}

/**
 * Fired when a scene widget reports a status update via
 * `widgetHost.reportStatus(key, value)` /
 * `widgetHost.reportComplete(reason?)` (Phase 4). Generic surface for
 * counters, timers, goals, anything the widget wants to surface to
 * the dashboard.
 *
 * `value` is whatever the widget chose to send — opaque at this
 * boundary. The dashboard renders it based on the widget's known
 * schema (e.g. raid_counter publishes `key: "count"` with `value:
 * number`).
 */
export interface WidgetStatusChangedEvent {
  type: typeof EngineEventType.WIDGET_STATUS_CHANGED;
  moduleId: string;
  instanceId: string;
  /** Canonical `{moduleId}:widget:{manifestId}`. Optional because
   *  some scene placements may not surface the canonical id today. */
  widgetCanonicalId?: string;
  key: string;
  value: unknown;
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// Overlay token events
// ---------------------------------------------------------------------------

/**
 * Fired when an overlay token is minted (`mintOverlayToken` /
 * `rotateOverlayToken` RPCs). Deliberately does NOT carry the
 * plaintext token — the mint RPC response is the only channel that
 * ever returns it. `tokenPrefix` (e.g. `ovl_abcd`) is for operator
 * display and log correlation only.
 */
export interface OverlayTokenMintedEvent {
  type: typeof EngineEventType.OVERLAY_TOKEN_MINTED;
  tokenId: string;
  sceneId: string;
  /** Operator bookkeeping label; empty string when unset. */
  label: string;
  /** Short non-secret prefix of the token for display (`ovl_abcd`).
   *  NEVER the full plaintext token. */
  tokenPrefix: string;
}

/**
 * Fired when an overlay token is revoked (`revokeOverlayToken`, or
 * the revoke half of `rotateOverlayToken`). Revocation is a tombstone
 * (`status='revoked'`), never a row deletion. Same field set and same
 * no-plaintext rule as the minted event.
 */
export interface OverlayTokenRevokedEvent {
  type: typeof EngineEventType.OVERLAY_TOKEN_REVOKED;
  tokenId: string;
  sceneId: string;
  /** Operator bookkeeping label; empty string when unset. */
  label: string;
  /** Short non-secret prefix of the token for display (`ovl_abcd`).
   *  NEVER the full plaintext token. */
  tokenPrefix: string;
}

// ---------------------------------------------------------------------------
// Stream lifecycle events (Twitch EventSub bridge)
// ---------------------------------------------------------------------------

/**
 * Fired when the engine's Twitch EventSub listener observes
 * `stream.online` for the bootstrapped broadcaster. Carries enough
 * context for the UI to flip its header pill to LIVE and start a
 * client-side uptime ticker.
 *
 * `startedAt` is the absolute Twitch start timestamp (ISO-8601),
 * authoritative over local clocks.
 *
 * `viewerCount`, `streamTitle`, `gameName` are best-effort — the raw
 * `stream.online` EventSub payload doesn't include them, so the
 * engine either omits them or backfills via a follow-up Helix
 * `getStreamByUserId` lookup before emitting. UI consumers must
 * tolerate any of them being absent.
 */
export interface StreamOnlineEvent {
  type: typeof EngineEventType.STREAM_ONLINE;
  twitchUserId: string;
  startedAt: string;
  streamTitle?: string;
  gameName?: string;
  viewerCount?: number;
}

/**
 * Fired when the engine's Twitch EventSub listener observes
 * `stream.offline` for the bootstrapped broadcaster. The UI flips
 * to OFFLINE and clears uptime / viewer count.
 */
export interface StreamOfflineEvent {
  type: typeof EngineEventType.STREAM_OFFLINE;
  twitchUserId: string;
}

/**
 * Names the stream session the engine is currently stamping events with.
 *
 * A session is the *logical* span a broadcast belongs to: it survives brief
 * dropouts, so it is not the same thing as `stream.online`. This is emitted by
 * the resolver that owns that decision, in the same step where it adopts the
 * session — deliberately not folded into `stream.online`, because both
 * subscribe to the same bus subject with no ordering between them, and a split
 * would then report the previous session.
 *
 * Re-sent when the engine restarts, so a consumer that missed the original
 * still converges. Treat it as "the current session is this one", not as a
 * boundary: receiving the same id twice is expected.
 *
 * A session *ending* is not delivered here. `instanceLiveState` is a
 * latest-value row, so a reader can see the session change but never that one
 * ended; an ending arrives as `SessionSummaryEvent`.
 */
export interface SessionStartedEvent {
  type: typeof EngineEventType.SESSION_STARTED;
  sessionId: string;
  /** ISO-8601. When the session began, which may predate the current stream. */
  startedAt: string;
}

/** What a session added up to: `StreamSessionTotals` without its id. */
export type SessionSummaryTotals = Omit<StreamSessionTotals, "sessionId">;

/** Bumped when a field of `SessionSummaryEvent` changes meaning or shape. */
export const SESSION_SUMMARY_SCHEMA_VERSION = 1;

/**
 * A finished session and what it added up to, sent when the session ends.
 *
 * Summaries, never per-viewer detail: this is the copy of a stream's history
 * that leaves the streamer's machine, so it carries channel figures only. Who
 * gave what stays in the engine, readable over `getLeaderboard` and
 * `getViewerTotals`.
 *
 * A session ends when the next broadcast past the grace window starts, not
 * when its own stream goes offline, so this can arrive hours after the stream
 * it describes. A session that was never live still ends; its summary has no
 * segments, all-zero counts and null viewer figures, and that is a real
 * answer.
 *
 * Every delivery is a whole snapshot, never a delta. Store it keyed on
 * `sessionId`, replacing a stored summary whose `generatedAt` is older and
 * ignoring one that is newer. The engine may send the same session more than
 * once -- a redelivery, or a re-summary after its bounds moved -- and that
 * rule makes every repeat harmless.
 */
export interface SessionSummaryEvent {
  type: typeof EngineEventType.SESSION_SUMMARY;
  /** The stable key. Equal to `session.id`. */
  sessionId: string;
  /** `SESSION_SUMMARY_SCHEMA_VERSION` at the time the engine built it. */
  schemaVersion: number;
  /** ISO 8601. When the engine computed this snapshot; orders repeats. */
  generatedAt: string;
  /** The session, closed, with its segments oldest first. */
  session: StreamSession;
  totals: SessionSummaryTotals;
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
  | ModuleResourceInstanceUpdatedEvent
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
  | WorkflowRunStartedEvent
  | WorkflowRunCompletedEvent
  | WorkflowRunFailedEvent
  | WorkflowRunCancelledEvent
  | WorkflowHealthChangedEvent
  | WorkflowHealthSnapshotEvent
  | WorkflowRunRecordedEvent
  | WorkflowRunUpdatedEvent
  | WorkflowRunStepRecordedEvent
  | SceneCreatedEvent
  | SceneUpdatedEvent
  | SceneDeletedEvent
  | AlertRecordedEvent
  | AlertPlayingEvent
  | AlertReplayedEvent
  | AlertCompletedEvent
  | AlertFailedEvent
  | AlertTimedOutEvent
  | AlertSkippedEvent
  | WidgetStatusChangedEvent
  | StreamOnlineEvent
  | StreamOfflineEvent
  | SessionStartedEvent
  | SessionSummaryEvent
  | OverlayTokenMintedEvent
  | OverlayTokenRevokedEvent
  | CommandCreatedEvent
  | CommandUpdatedEvent
  | CommandDeletedEvent
  | GroupCreatedEvent
  | GroupUpdatedEvent
  | GroupDeletedEvent
  | GroupMemberAddedEvent
  | GroupMemberRemovedEvent;

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
  [EngineEventType.MODULE_RESOURCE_INSTANCE_UPDATED]: ModuleResourceInstanceUpdatedEvent;
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
  [EngineEventType.WORKFLOW_RUN_STARTED]: WorkflowRunStartedEvent;
  [EngineEventType.WORKFLOW_RUN_COMPLETED]: WorkflowRunCompletedEvent;
  [EngineEventType.WORKFLOW_RUN_FAILED]: WorkflowRunFailedEvent;
  [EngineEventType.WORKFLOW_RUN_CANCELLED]: WorkflowRunCancelledEvent;
  [EngineEventType.WORKFLOW_HEALTH_CHANGED]: WorkflowHealthChangedEvent;
  [EngineEventType.WORKFLOW_HEALTH_SNAPSHOT]: WorkflowHealthSnapshotEvent;
  [EngineEventType.WORKFLOW_RUN_RECORDED]: WorkflowRunRecordedEvent;
  [EngineEventType.WORKFLOW_RUN_UPDATED]: WorkflowRunUpdatedEvent;
  [EngineEventType.WORKFLOW_RUN_STEP_RECORDED]: WorkflowRunStepRecordedEvent;
  [EngineEventType.SCENE_CREATED]: SceneCreatedEvent;
  [EngineEventType.SCENE_UPDATED]: SceneUpdatedEvent;
  [EngineEventType.SCENE_DELETED]: SceneDeletedEvent;
  [EngineEventType.ALERT_RECORDED]: AlertRecordedEvent;
  [EngineEventType.ALERT_PLAYING]: AlertPlayingEvent;
  [EngineEventType.ALERT_REPLAYED]: AlertReplayedEvent;
  [EngineEventType.ALERT_COMPLETED]: AlertCompletedEvent;
  [EngineEventType.ALERT_FAILED]: AlertFailedEvent;
  [EngineEventType.ALERT_TIMED_OUT]: AlertTimedOutEvent;
  [EngineEventType.ALERT_SKIPPED]: AlertSkippedEvent;
  [EngineEventType.WIDGET_STATUS_CHANGED]: WidgetStatusChangedEvent;
  [EngineEventType.STREAM_ONLINE]: StreamOnlineEvent;
  [EngineEventType.STREAM_OFFLINE]: StreamOfflineEvent;
  [EngineEventType.SESSION_STARTED]: SessionStartedEvent;
  [EngineEventType.SESSION_SUMMARY]: SessionSummaryEvent;
  [EngineEventType.OVERLAY_TOKEN_MINTED]: OverlayTokenMintedEvent;
  [EngineEventType.OVERLAY_TOKEN_REVOKED]: OverlayTokenRevokedEvent;
  [EngineEventType.COMMAND_CREATED]: CommandCreatedEvent;
  [EngineEventType.COMMAND_UPDATED]: CommandUpdatedEvent;
  [EngineEventType.COMMAND_DELETED]: CommandDeletedEvent;
  [EngineEventType.GROUP_CREATED]: GroupCreatedEvent;
  [EngineEventType.GROUP_UPDATED]: GroupUpdatedEvent;
  [EngineEventType.GROUP_DELETED]: GroupDeletedEvent;
  [EngineEventType.GROUP_MEMBER_ADDED]: GroupMemberAddedEvent;
  [EngineEventType.GROUP_MEMBER_REMOVED]: GroupMemberRemovedEvent;
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

// ==================== Requests ====================
//
// A request travels to the dashboard the way a callback does (same URL, same
// Bearer token, same envelope), but the engine waits for the dashboard's
// answer in the response body instead of treating any 2xx as delivered.

export const EngineRequestType = {
  /**
   * The engine needs a current Twitch access token for the linked account.
   * The dashboard owns the Twitch app and the refresh token: it refreshes
   * when needed and answers with the access token alone.
   */
  TWITCH_TOKEN_REQUESTED: "twitch.token.requested",
  /**
   * The engine needs a short-lived credential for the companion's bridge.
   * The dashboard mints it, and answers with the relay configuration it is
   * valid for.
   */
  RELAY_CREDENTIAL_REQUESTED: "relay.credential.requested",
  /**
   * Add a Twitch shoutout to the dashboard's shoutout queue. Twitch allows one
   * shoutout per channel every 2 minutes, so every shoutout the engine is
   * asked for joins the same queue the dashboard's shoutout widget feeds,
   * which spaces them out and retries refusals, instead of competing with it.
   */
  SHOUTOUT_ENQUEUE_REQUESTED: "shoutout.enqueue.requested",
} as const;

export type EngineRequestType = (typeof EngineRequestType)[keyof typeof EngineRequestType];

export interface TwitchTokenRequestedEvent {
  type: typeof EngineRequestType.TWITCH_TOKEN_REQUESTED;
}

export interface RelayCredentialRequestedEvent {
  type: typeof EngineRequestType.RELAY_CREDENTIAL_REQUESTED;
}

/**
 * Who to shout out, already looked up by the twitch service so the dashboard
 * can queue them without asking Twitch again.
 */
export interface ShoutoutEnqueueRequestedEvent {
  type: typeof EngineRequestType.SHOUTOUT_ENQUEUE_REQUESTED;
  twitchUserId: string;
  /** Lowercase login. */
  login: string;
  displayName: string;
  profileImageUrl?: string;
  /** "partner", "affiliate" or "" for neither. */
  broadcasterType?: string;
}

/**
 * The dashboard's answer to `shoutout.enqueue.requested`. `position` is
 * 1-based. `alreadyQueued`: that user was waiting already, and stays where
 * they were rather than being queued twice. `not_linked`: no Twitch account is
 * linked to this instance, so nothing can send the queue.
 */
export type ShoutoutEnqueueRequestedResponse =
  | { queued: true; position: number; alreadyQueued: boolean }
  | { queued: false; reason: "not_linked" };

export type EngineRequest = TwitchTokenRequestedEvent | RelayCredentialRequestedEvent | ShoutoutEnqueueRequestedEvent;

/**
 * A Twitch access token as the dashboard hands it to an engine. It carries
 * the client id of the Twitch app that issued it, because Helix rejects a
 * token presented with any other app's id, and no refresh token: only the
 * dashboard refreshes.
 */
export interface TwitchTokenGrant {
  userId: string;
  accessToken: string;
  scope: string[];
  /** Seconds the token was valid for at `obtainmentTimestamp`. */
  expiresIn: number;
  /** Milliseconds since the epoch. */
  obtainmentTimestamp: number;
  clientId: string;
}

/**
 * The dashboard's answer to `twitch.token.requested`. `not_linked`: no Twitch
 * account is linked to this instance. `relink_required`: the dashboard can no
 * longer refresh the token, and the streamer has to link Twitch again.
 */
export type TwitchTokenRequestedResponse =
  | { token: TwitchTokenGrant }
  | { token: null; reason: "not_linked" | "relink_required" };

/**
 * The dashboard's answer to `relay.credential.requested`: a short-lived
 * credential for the bridge, with the configuration it is valid for.
 * `expiresAt` is in milliseconds since the epoch. `relay: null` means the
 * instance no longer routes anything through a companion; the engine clears
 * its relay configuration.
 */
export type RelayCredentialRequestedResponse =
  | { relay: RelayConfig & { credential: string; expiresAt: number } }
  | { relay: null };

export interface RequestEnvelope {
  specversion: "1.0";
  id: string;
  source: string;
  type: EngineRequestType;
  time: string;
  datacontenttype?: string;
  data: EngineRequest;
}

export function makeRequestEnvelope<E extends EngineRequest>(
  request: E,
  source = "engine",
  id: string = globalThis.crypto?.randomUUID() ?? "",
  time: string = new Date().toISOString()
): RequestEnvelope {
  return {
    specversion: "1.0",
    id,
    source,
    type: request.type,
    time,
    datacontenttype: "application/json",
    data: request,
  };
}
