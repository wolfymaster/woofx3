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
  MODULE_TRIGGER_DEREGISTERED: "module.trigger.deregistered",
  MODULE_ACTION_DEREGISTERED: "module.action.deregistered",
  MODULE_FUNCTION_DEREGISTERED: "module.function.deregistered",
  ENGINE_RESPONSE_RECEIVED: "engine.response.received",
  WORKFLOW_CREATED: "workflow.created",
  WORKFLOW_UPDATED: "workflow.updated",
  WORKFLOW_DELETED: "workflow.deleted",
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

/**
 * Discriminated union of every event the engine can deliver via webhook.
 * Consumers should narrow on `event.type` — TypeScript will pick the right
 * branch without casts.
 */
export type CallbackEvent =
  | ModuleTriggerRegisteredEvent
  | ModuleActionRegisteredEvent
  | ModuleFunctionRegisteredEvent
  | ModuleTriggerDeregisteredEvent
  | ModuleActionDeregisteredEvent
  | ModuleFunctionDeregisteredEvent
  | ModuleInstalledEvent
  | ModuleInstallFailedEvent
  | ModuleDeletedEvent
  | ModuleDeleteFailedEvent
  | EngineResponseReceivedEvent
  | WorkflowCreatedEvent
  | WorkflowUpdatedEvent
  | WorkflowDeletedEvent;

/**
 * Lookup from event-type string → payload type. Useful for emitter code
 * that knows its type at compile time and wants to validate the payload.
 */
export type CallbackEventByType = {
  [EngineEventType.MODULE_TRIGGER_REGISTERED]: ModuleTriggerRegisteredEvent;
  [EngineEventType.MODULE_ACTION_REGISTERED]: ModuleActionRegisteredEvent;
  [EngineEventType.MODULE_FUNCTION_REGISTERED]: ModuleFunctionRegisteredEvent;
  [EngineEventType.MODULE_TRIGGER_DEREGISTERED]: ModuleTriggerDeregisteredEvent;
  [EngineEventType.MODULE_ACTION_DEREGISTERED]: ModuleActionDeregisteredEvent;
  [EngineEventType.MODULE_FUNCTION_DEREGISTERED]: ModuleFunctionDeregisteredEvent;
  [EngineEventType.MODULE_INSTALLED]: ModuleInstalledEvent;
  [EngineEventType.MODULE_INSTALL_FAILED]: ModuleInstallFailedEvent;
  [EngineEventType.MODULE_DELETED]: ModuleDeletedEvent;
  [EngineEventType.MODULE_DELETE_FAILED]: ModuleDeleteFailedEvent;
  [EngineEventType.ENGINE_RESPONSE_RECEIVED]: EngineResponseReceivedEvent;
  [EngineEventType.WORKFLOW_CREATED]: WorkflowCreatedEvent;
  [EngineEventType.WORKFLOW_UPDATED]: WorkflowUpdatedEvent;
  [EngineEventType.WORKFLOW_DELETED]: WorkflowDeletedEvent;
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
