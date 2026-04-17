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
} as const;

export type EngineEventType = (typeof EngineEventType)[keyof typeof EngineEventType];

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface TriggerDefinition {
  id: string;
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
  resourceName: string;
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

export interface ModuleInstalledEvent {
  type: typeof EngineEventType.MODULE_INSTALLED;
  moduleName: string;
  version: string;
  moduleKey: string;
  alreadyInstalled?: boolean;
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
 * Discriminated union of every event the engine can deliver via webhook.
 * Consumers should narrow on `event.type` — TypeScript will pick the right
 * branch without casts.
 */
export type CallbackEvent =
  | ModuleTriggerRegisteredEvent
  | ModuleActionRegisteredEvent
  | ModuleInstalledEvent
  | ModuleInstallFailedEvent
  | ModuleDeletedEvent
  | ModuleDeleteFailedEvent;

/**
 * Lookup from event-type string → payload type. Useful for emitter code
 * that knows its type at compile time and wants to validate the payload.
 */
export type CallbackEventByType = {
  [EngineEventType.MODULE_TRIGGER_REGISTERED]: ModuleTriggerRegisteredEvent;
  [EngineEventType.MODULE_ACTION_REGISTERED]: ModuleActionRegisteredEvent;
  [EngineEventType.MODULE_INSTALLED]: ModuleInstalledEvent;
  [EngineEventType.MODULE_INSTALL_FAILED]: ModuleInstallFailedEvent;
  [EngineEventType.MODULE_DELETED]: ModuleDeletedEvent;
  [EngineEventType.MODULE_DELETE_FAILED]: ModuleDeleteFailedEvent;
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
  time: string = new Date().toISOString(),
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
