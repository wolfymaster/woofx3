import type {
  ActionDefinition,
  FunctionDefinition,
  ModuleActionDeregisteredEvent,
  ModuleActionRegisteredEvent,
  ModuleFunctionDeregisteredEvent,
  ModuleFunctionRegisteredEvent,
  ModuleTriggerDeregisteredEvent,
  ModuleTriggerRegisteredEvent,
  TriggerDefinition,
} from "./webhook-client";

interface RawTrigger {
  id?: unknown;
  canonical_id?: unknown;
  projection_key?: unknown;
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
  canonical_id?: unknown;
  projection_key?: unknown;
  name?: unknown;
  description?: unknown;
  call?: unknown;
  params_schema?: unknown;
  created_by_type?: unknown;
  created_by_ref?: unknown;
}

interface RawFunction {
  id?: unknown;
  canonical_id?: unknown;
  projection_key?: unknown;
  module_id?: unknown;
  manifest_id?: unknown;
  name?: unknown;
  file_name?: unknown;
  entry_point?: unknown;
  runtime?: unknown;
}

interface RawModuleRegistered {
  module_key?: unknown;
  module_name?: unknown;
  version?: unknown;
  triggers?: unknown;
  actions?: unknown;
  functions?: unknown;
}

interface RawModuleResourceDeregistered {
  // Trigger / action dereg events use `module_prefix` (the manifest id);
  // function dereg events carry the full `module_key` plus name/version
  // because they're emitted on full-module-delete and the parent module
  // row's metadata is still in scope.
  module_prefix?: unknown;
  module_key?: unknown;
  module_name?: unknown;
  version?: unknown;
  triggers?: unknown;
  actions?: unknown;
  functions?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asBool = (v: unknown): boolean => v === true;

function mapTrigger(raw: RawTrigger): TriggerDefinition {
  const def: TriggerDefinition = {
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
  const canonicalId = asString(raw.canonical_id);
  if (canonicalId !== "") {
    def.canonicalId = canonicalId;
  }
  const projectionKey = asString(raw.projection_key);
  if (projectionKey !== "") {
    def.projectionKey = projectionKey;
  }
  return def;
}

function mapAction(raw: RawAction): ActionDefinition {
  const def: ActionDefinition = {
    id: asString(raw.id),
    name: asString(raw.name),
    description: asString(raw.description),
    call: asString(raw.call),
    paramsSchema: asString(raw.params_schema),
    createdByType: asString(raw.created_by_type),
    createdByRef: asString(raw.created_by_ref),
  };
  const canonicalId = asString(raw.canonical_id);
  if (canonicalId !== "") {
    def.canonicalId = canonicalId;
  }
  const projectionKey = asString(raw.projection_key);
  if (projectionKey !== "") {
    def.projectionKey = projectionKey;
  }
  return def;
}

function mapFunction(raw: RawFunction): FunctionDefinition {
  const def: FunctionDefinition = {
    id: asString(raw.id),
    moduleId: asString(raw.module_id),
    manifestId: asString(raw.manifest_id),
    name: asString(raw.name),
    fileName: asString(raw.file_name),
    entryPoint: asString(raw.entry_point),
    runtime: asString(raw.runtime),
  };
  const canonicalId = asString(raw.canonical_id);
  if (canonicalId !== "") {
    def.canonicalId = canonicalId;
  }
  const projectionKey = asString(raw.projection_key);
  if (projectionKey !== "") {
    def.projectionKey = projectionKey;
  }
  return def;
}

function readPayload(ce: Record<string, unknown>): RawModuleRegistered {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as RawModuleRegistered;
  }
  return ce as RawModuleRegistered;
}

function readDeregPayload(ce: Record<string, unknown>): RawModuleResourceDeregistered {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as RawModuleResourceDeregistered;
  }
  return ce as RawModuleResourceDeregistered;
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

export function parseModuleFunctionRegistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleFunctionRegisteredEvent;
} {
  const payload = readPayload(ce);
  const rawFunctions = Array.isArray(payload.functions) ? payload.functions : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: "module.function.registered",
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      functions: rawFunctions.map((f) => mapFunction(f as RawFunction)),
    },
  };
}

export function parseModuleTriggerDeregistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleTriggerDeregisteredEvent;
} {
  const payload = readDeregPayload(ce);
  const rawTriggers = Array.isArray(payload.triggers) ? payload.triggers : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: "module.trigger.deregistered",
      modulePrefix: asString(payload.module_prefix),
      triggers: rawTriggers.map((t) => mapTrigger(t as RawTrigger)),
    },
  };
}

export function parseModuleActionDeregistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleActionDeregisteredEvent;
} {
  const payload = readDeregPayload(ce);
  const rawActions = Array.isArray(payload.actions) ? payload.actions : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: "module.action.deregistered",
      modulePrefix: asString(payload.module_prefix),
      actions: rawActions.map((a) => mapAction(a as RawAction)),
    },
  };
}

export function parseModuleFunctionDeregistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleFunctionDeregisteredEvent;
} {
  const payload = readDeregPayload(ce);
  const rawFunctions = Array.isArray(payload.functions) ? payload.functions : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: "module.function.deregistered",
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      functions: rawFunctions.map((f) => mapFunction(f as RawFunction)),
    },
  };
}
