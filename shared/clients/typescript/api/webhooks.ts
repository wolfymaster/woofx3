// Engine → callback webhook event types.
// Source of truth for the shape of every event the engine POSTs to a
// registered client's callbackUrl. The engine runtime (api/src/webhook-client.ts)
// re-exports these; external clients (e.g. the woofx3-ui Convex webhook handler)
// import them directly from "@woofx3/api/webhooks".

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
  type: "module.trigger.registered";
  moduleKey: string;
  moduleName: string;
  version: string;
  triggers: TriggerDefinition[];
}

export interface ModuleActionRegisteredEvent {
  type: "module.action.registered";
  moduleKey: string;
  moduleName: string;
  version: string;
  actions: ActionDefinition[];
}

export interface ModuleInstalledEvent {
  type: "module.installed";
  moduleName: string;
  version: string;
  moduleKey: string;
  alreadyInstalled?: boolean;
}

export interface ModuleInstallFailedEvent {
  type: "module.install_failed";
  moduleName: string;
  version: string;
  moduleKey: string;
  error: string;
}

export interface ModuleDeletedEvent {
  type: "module.deleted";
  moduleName: string;
  moduleKey: string;
}

export interface ModuleDeleteFailedEvent {
  type: "module.delete_failed";
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
 * Outer envelope for every webhook delivery. The engine sets `source: "engine"`
 * and a unique `id` per delivery; `type` mirrors `data.type` for convenience
 * when a receiver only reads the envelope.
 */
export interface CallbackEnvelope {
  id: string;
  source: "engine";
  type: string;
  time: string;
  data: CallbackEvent;
}
