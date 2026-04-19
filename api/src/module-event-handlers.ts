import type {
  ActionDefinition,
  ModuleActionRegisteredEvent,
  ModuleTriggerRegisteredEvent,
  TriggerDefinition,
} from "./webhook-client";

interface RawTrigger {
  id?: unknown;
  category?: unknown;
  name?: unknown;
  description?: unknown;
  event?: unknown;
  config_schema?: unknown;
  allow_variants?: unknown;
  created_by_type?: unknown;
  created_by_ref?: unknown;
}

interface RawAction {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  call?: unknown;
  params_schema?: unknown;
  created_by_type?: unknown;
  created_by_ref?: unknown;
}

interface RawModuleRegistered {
  module_key?: unknown;
  module_name?: unknown;
  version?: unknown;
  triggers?: unknown;
  actions?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asBool = (v: unknown): boolean => v === true;

function mapTrigger(raw: RawTrigger): TriggerDefinition {
  return {
    id: asString(raw.id),
    category: asString(raw.category),
    name: asString(raw.name),
    description: asString(raw.description),
    event: asString(raw.event),
    configSchema: asString(raw.config_schema),
    allowVariants: asBool(raw.allow_variants),
    createdByType: asString(raw.created_by_type),
    createdByRef: asString(raw.created_by_ref),
  };
}

function mapAction(raw: RawAction): ActionDefinition {
  return {
    id: asString(raw.id),
    name: asString(raw.name),
    description: asString(raw.description),
    call: asString(raw.call),
    paramsSchema: asString(raw.params_schema),
    createdByType: asString(raw.created_by_type),
    createdByRef: asString(raw.created_by_ref),
  };
}

function readPayload(ce: Record<string, unknown>): RawModuleRegistered {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as RawModuleRegistered;
  }
  return ce as RawModuleRegistered;
}

export function parseModuleTriggerRegistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleTriggerRegisteredEvent;
} {
  const payload = readPayload(ce);
  const rawTriggers = Array.isArray(payload.triggers) ? payload.triggers : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: "module.trigger.registered",
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      triggers: rawTriggers.map((t) => mapTrigger(t as RawTrigger)),
    },
  };
}

export function parseModuleActionRegistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleActionRegisteredEvent;
} {
  const payload = readPayload(ce);
  const rawActions = Array.isArray(payload.actions) ? payload.actions : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: "module.action.registered",
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      actions: rawActions.map((a) => mapAction(a as RawAction)),
    },
  };
}
