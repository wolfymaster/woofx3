import type {
  ActionDefinition,
  AssetDefinition,
  FunctionDefinition,
  ModuleActionDeregisteredEvent,
  ModuleActionRegisteredEvent,
  ModuleAssetDeregisteredEvent,
  ModuleAssetRegisteredEvent,
  ModuleDeletedEvent,
  ModuleDeleteFailedEvent,
  ModuleFunctionDeregisteredEvent,
  ModuleFunctionRegisteredEvent,
  ModuleInstalledEvent,
  ModuleInstallFailedEvent,
  ModuleResourceInstanceCreatedEvent,
  ModuleResourceInstanceDeletedEvent,
  ModuleResourceUsage,
  ModuleTriggerDeregisteredEvent,
  ModuleTriggerRegisteredEvent,
  ModuleWidgetDeregisteredEvent,
  ModuleWidgetRegisteredEvent,
  ResourceInstanceDefinition,
  TriggerDefinition,
  WebhookClient,
  WidgetDefinition,
  WidgetSettingDefinition,
} from "./webhook-client";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";

interface RawTrigger {
  id?: unknown;
  canonical_id?: unknown;
  projection_key?: unknown;
  taxonomy?: unknown;
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
  taxonomy?: unknown;
  name?: unknown;
  description?: unknown;
  call?: unknown;
  params_schema?: unknown;
  output_schema?: unknown;
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

interface RawWidgetSetting {
  key?: unknown;
  field_type?: unknown;
  fieldType?: unknown;
  label?: unknown;
  default_value?: unknown;
  defaultValue?: unknown;
  options?: unknown;
}

interface RawWidget {
  id?: unknown;
  canonical_id?: unknown;
  projection_key?: unknown;
  manifest_id?: unknown;
  name?: unknown;
  description?: unknown;
  directory?: unknown;
  alert_types?: unknown;
  alertTypes?: unknown;
  settings?: unknown;
  surface?: unknown;
  created_by_type?: unknown;
  created_by_ref?: unknown;
}

interface RawModuleRegistered {
  module_prefix?: unknown;
  module_key?: unknown;
  module_name?: unknown;
  version?: unknown;
  triggers?: unknown;
  actions?: unknown;
  functions?: unknown;
  widgets?: unknown;
  assets?: unknown;
}

interface RawAsset {
  id?: unknown;
  canonical_id?: unknown;
  projection_key?: unknown;
  manifest_id?: unknown;
  name?: unknown;
  description?: unknown;
  manifest_path?: unknown;
  repository_key?: unknown;
  kind?: unknown;
  content_type?: unknown;
  created_by_type?: unknown;
  created_by_ref?: unknown;
}

interface RawModuleResourceDeregistered {
  // Trigger / action / asset dereg events use `module_prefix` (the
  // manifest id); function and widget dereg events carry the full
  // `module_key` plus name/version because they're emitted on
  // full-module-delete and the parent module row's metadata is still
  // in scope.
  module_prefix?: unknown;
  module_key?: unknown;
  module_name?: unknown;
  version?: unknown;
  triggers?: unknown;
  actions?: unknown;
  functions?: unknown;
  widgets?: unknown;
  assets?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asBool = (v: unknown): boolean => v === true;
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function mapTrigger(raw: RawTrigger): TriggerDefinition {
  const def: TriggerDefinition = {
    id: asString(raw.id),
    taxonomy: asStringArray(raw.taxonomy),
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
    taxonomy: asStringArray(raw.taxonomy),
    name: asString(raw.name),
    description: asString(raw.description),
    call: asString(raw.call),
    paramsSchema: asString(raw.params_schema),
    outputSchema: asString(raw.output_schema),
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

function mapWidgetSetting(raw: RawWidgetSetting): WidgetSettingDefinition {
  // Accept both snake_case (NATS payload) and camelCase (manifest pass-through)
  // for tolerance during the producer rollout.
  const fieldType = asString(raw.field_type) || asString(raw.fieldType);
  const defaultValue = raw.default_value !== undefined ? raw.default_value : raw.defaultValue;
  const setting: WidgetSettingDefinition = {
    key: asString(raw.key),
    fieldType,
    label: asString(raw.label),
    defaultValue: defaultValue ?? null,
  };
  if (Array.isArray(raw.options)) {
    const opts: Array<{ label: string; value: string }> = [];
    for (const o of raw.options) {
      if (o && typeof o === "object") {
        const obj = o as { label?: unknown; value?: unknown };
        opts.push({ label: asString(obj.label), value: asString(obj.value) });
      }
    }
    setting.options = opts;
  }
  return setting;
}

function mapWidget(raw: RawWidget): WidgetDefinition {
  const alertTypesRaw = (Array.isArray(raw.alert_types) ? raw.alert_types : raw.alertTypes) ?? [];
  const alertTypes = Array.isArray(alertTypesRaw) ? alertTypesRaw.map((a) => asString(a)) : [];
  const settingsRaw = Array.isArray(raw.settings) ? raw.settings : [];
  const def: WidgetDefinition = {
    id: asString(raw.id),
    manifestId: asString(raw.manifest_id),
    name: asString(raw.name),
    directory: asString(raw.directory),
    alertTypes,
    settings: settingsRaw.map((s) => mapWidgetSetting(s as RawWidgetSetting)),
    createdByType: asString(raw.created_by_type),
    createdByRef: asString(raw.created_by_ref),
  };
  const description = asString(raw.description);
  if (description !== "") {
    def.description = description;
  }
  const canonicalId = asString(raw.canonical_id);
  if (canonicalId !== "") {
    def.canonicalId = canonicalId;
  }
  const projectionKey = asString(raw.projection_key);
  if (projectionKey !== "") {
    def.projectionKey = projectionKey;
  }
  // Pass through the manifest's `surface` declaration. The UI defaults
  // omitted values to "scene"; only forward the discriminator when the
  // manifest explicitly opts into a non-default surface so the wire
  // payload stays minimal for the common case.
  const surface = asString(raw.surface);
  if (surface === "dashboard" || surface === "scene") {
    def.surface = surface;
  }
  return def;
}

function mapAsset(raw: RawAsset): AssetDefinition {
  const def: AssetDefinition = {
    id: asString(raw.id),
    canonicalId: asString(raw.canonical_id),
    projectionKey: asString(raw.projection_key),
    manifestId: asString(raw.manifest_id),
    name: asString(raw.name),
    repositoryKey: asString(raw.repository_key),
    manifestPath: asString(raw.manifest_path),
    createdByType: asString(raw.created_by_type),
    createdByRef: asString(raw.created_by_ref),
  };
  const description = asString(raw.description);
  if (description !== "") {
    def.description = description;
  }
  const kind = asString(raw.kind);
  if (kind !== "") {
    def.kind = kind;
  }
  const contentType = asString(raw.content_type);
  if (contentType !== "") {
    def.contentType = contentType;
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
      modulePrefix: asString(payload.module_prefix),
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
      modulePrefix: asString(payload.module_prefix),
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
      modulePrefix: asString(payload.module_prefix),
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
      moduleKey: asString(payload.module_key),
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
      moduleKey: asString(payload.module_key),
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
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      functions: rawFunctions.map((f) => mapFunction(f as RawFunction)),
    },
  };
}

export function parseModuleWidgetRegistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleWidgetRegisteredEvent;
} {
  const payload = readPayload(ce);
  const rawWidgets = Array.isArray(payload.widgets) ? payload.widgets : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: "module.widget.registered",
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      widgets: rawWidgets.map((w) => mapWidget(w as RawWidget)),
    },
  };
}

export function parseModuleWidgetDeregistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleWidgetDeregisteredEvent;
} {
  const payload = readDeregPayload(ce);
  const rawWidgets = Array.isArray(payload.widgets) ? payload.widgets : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: "module.widget.deregistered",
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      widgets: rawWidgets.map((w) => mapWidget(w as RawWidget)),
    },
  };
}

export function parseModuleAssetRegistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleAssetRegisteredEvent;
} {
  const payload = readPayload(ce);
  const rawAssets = Array.isArray(payload.assets) ? payload.assets : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: EngineEventType.MODULE_ASSET_REGISTERED,
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      assets: rawAssets.map((a) => mapAsset(a as RawAsset)),
    },
  };
}

export function parseModuleAssetDeregistered(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleAssetDeregisteredEvent;
} {
  const payload = readDeregPayload(ce);
  const rawAssets = Array.isArray(payload.assets) ? payload.assets : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: EngineEventType.MODULE_ASSET_DEREGISTERED,
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      assets: rawAssets.map((a) => mapAsset(a as RawAsset)),
    },
  };
}

// ---------------------------------------------------------------------
// Module resource instances — runtime-created rows of a kind that some
// installed module declared it provides. Single instance per event
// (distinct from the trigger / action / widget batch shape) since the
// underlying CreateResourceInstance / DeleteResourceInstance RPCs each
// touch one row.
// ---------------------------------------------------------------------

interface RawResourceInstance {
  id?: unknown;
  module_id?: unknown;
  module_name?: unknown;
  kind?: unknown;
  instance_id?: unknown;
  display_name?: unknown;
  canonical_id?: unknown;
  module_prefix?: unknown;
  module_key?: unknown;
}

function mapResourceInstance(raw: RawResourceInstance): ResourceInstanceDefinition {
  return {
    id: asString(raw.id),
    moduleId: asString(raw.module_id),
    moduleName: asString(raw.module_name),
    kind: asString(raw.kind),
    instanceId: asString(raw.instance_id),
    displayName: asString(raw.display_name),
    canonicalId: asString(raw.canonical_id),
    moduleKey: asString(raw.module_key),
  };
}

export function parseModuleResourceInstanceCreated(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleResourceInstanceCreatedEvent;
} {
  const payload = readPayload(ce) as RawResourceInstance;
  return {
    clientId: asString(ce.client_id),
    event: {
      type: EngineEventType.MODULE_RESOURCE_INSTANCE_CREATED,
      instance: mapResourceInstance(payload),
    },
  };
}

export function parseModuleResourceInstanceDeleted(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleResourceInstanceDeletedEvent;
} {
  const payload = readPayload(ce) as RawResourceInstance;
  return {
    clientId: asString(ce.client_id),
    event: {
      type: EngineEventType.MODULE_RESOURCE_INSTANCE_DELETED,
      instance: mapResourceInstance(payload),
    },
  };
}

// ---------------------------------------------------------------------
// Module install/delete lifecycle — unlike the registration events
// above, the db proxy's `db.module.{installed,deleted,delete_failed,
// install_failed}.*` outbox carries a flat payload with no nested
// definition arrays, so there's no per-field mapper to share.
// ---------------------------------------------------------------------

interface RawModuleInstalled {
  module_name?: unknown;
  module_prefix?: unknown;
  module_key?: unknown;
  version?: unknown;
  author?: unknown;
  taxonomy?: unknown;
  description?: unknown;
}

interface RawModuleDeleted {
  module_name?: unknown;
  module_prefix?: unknown;
  module_key?: unknown;
}

interface RawModuleUsageRef {
  source_type?: unknown;
  source_id?: unknown;
  source_name?: unknown;
  context?: unknown;
}

interface RawModuleResourceUsage {
  resource_id?: unknown;
  resource_type?: unknown;
  resource_name?: unknown;
  resource_display_name?: unknown;
  used_by?: unknown;
}

interface RawModuleDeleteFailed {
  module_name?: unknown;
  module_prefix?: unknown;
  module_key?: unknown;
  error?: unknown;
  in_use_resources?: unknown;
}

interface RawModuleInstallFailed {
  module_name?: unknown;
  module_prefix?: unknown;
  module_key?: unknown;
  version?: unknown;
  error?: unknown;
}

function mapModuleUsageRef(raw: RawModuleUsageRef): ModuleResourceUsage["usedBy"][number] {
  return {
    sourceType: asString(raw.source_type),
    sourceId: asString(raw.source_id),
    sourceName: asString(raw.source_name),
    context: asString(raw.context),
  };
}

function mapModuleResourceUsage(raw: RawModuleResourceUsage): ModuleResourceUsage {
  const usedByRaw = Array.isArray(raw.used_by) ? raw.used_by : [];
  const usage: ModuleResourceUsage = {
    resourceId: asString(raw.resource_id),
    resourceType: asString(raw.resource_type),
    resourceName: asString(raw.resource_name),
    usedBy: usedByRaw.map((u) => mapModuleUsageRef(u as RawModuleUsageRef)),
  };
  const displayName = asString(raw.resource_display_name);
  if (displayName !== "") {
    usage.resourceDisplayName = displayName;
  }
  return usage;
}

export function parseModuleInstalled(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleInstalledEvent;
} {
  const payload = readPayload(ce) as RawModuleInstalled;
  const taxonomyRaw = payload.taxonomy;
  return {
    clientId: asString(ce.client_id),
    event: {
      type: EngineEventType.MODULE_INSTALLED,
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
      author: asString(payload.author),
      taxonomy: Array.isArray(taxonomyRaw) ? taxonomyRaw.filter((x): x is string => typeof x === "string") : [],
      description: asString(payload.description),
    },
  };
}

export function parseModuleDeleted(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleDeletedEvent;
} {
  const payload = readPayload(ce) as RawModuleDeleted;
  return {
    clientId: asString(ce.client_id),
    event: {
      type: EngineEventType.MODULE_DELETED,
      moduleName: asString(payload.module_name),
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
    },
  };
}

export function parseModuleDeleteFailed(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleDeleteFailedEvent;
} {
  const payload = readPayload(ce) as RawModuleDeleteFailed;
  const inUseRaw = Array.isArray(payload.in_use_resources) ? payload.in_use_resources : [];
  return {
    clientId: asString(ce.client_id),
    event: {
      type: EngineEventType.MODULE_DELETE_FAILED,
      moduleName: asString(payload.module_name),
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
      error: asString(payload.error) || "Unknown error",
      inUseResources: inUseRaw.map((r) => mapModuleResourceUsage(r as RawModuleResourceUsage)),
    },
  };
}

export function parseModuleInstallFailed(ce: Record<string, unknown>): {
  clientId: string;
  event: ModuleInstallFailedEvent;
} {
  const payload = readPayload(ce) as RawModuleInstallFailed;
  return {
    clientId: asString(ce.client_id),
    event: {
      type: EngineEventType.MODULE_INSTALL_FAILED,
      moduleName: asString(payload.module_name),
      version: asString(payload.version),
      modulePrefix: asString(payload.module_prefix),
      moduleKey: asString(payload.module_key),
      error: asString(payload.error) || "Unknown error",
    },
  };
}

/**
 * Initialise NATS subscriptions for the module event outbox and project
 * each onto webhook callbacks. Covers action/function/widget/asset
 * registration and deregistration, resource-instance lifecycle, and
 * install/delete lifecycle — everything in the `db.module.*` outbox
 * except trigger registration/deregistration, which stays on
 * `ApiRouteHost` because it also has to notify in-process trigger
 * subscribers (`notifyTriggerChange`), not just project to a webhook.
 */
export async function initModuleHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await nats.subscribe("db.module.action.registered.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleActionRegistered(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.action.registered NATS event", { err });
    }
  });

  await nats.subscribe("db.module.function.registered.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleFunctionRegistered(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.function.registered NATS event", { err });
    }
  });

  await nats.subscribe("db.module.action.deregistered.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleActionDeregistered(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.action.deregistered NATS event", { err });
    }
  });

  await nats.subscribe("db.module.function.deregistered.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleFunctionDeregistered(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.function.deregistered NATS event", { err });
    }
  });

  await nats.subscribe("db.module.widget.registered.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleWidgetRegistered(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.widget.registered NATS event", { err });
    }
  });

  await nats.subscribe("db.module.widget.deregistered.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleWidgetDeregistered(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.widget.deregistered NATS event", { err });
    }
  });

  // Module asset registration / deregistration outbox. Mirror of the
  // widget rails: db proxy publishes after RegisterAssets /
  // DeleteAssetsByModuleId; api forwards to the registered callback so
  // the editor can refresh its asset picker.
  await nats.subscribe("db.module.asset.registered.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleAssetRegistered(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.asset.registered NATS event", { err });
    }
  });

  await nats.subscribe("db.module.asset.deregistered.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleAssetDeregistered(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.asset.deregistered NATS event", { err });
    }
  });

  // Module resource instance lifecycle — fired by db-proxy after each
  // CreateResourceInstance / DeleteResourceInstance RPC. Forwarded to
  // the registered Convex webhook so UI pickers backed by
  // `resource_ref(kind=...)` ConfigFields refresh live.
  await nats.subscribe("db.module.resource.instance.created.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleResourceInstanceCreated(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.resource.instance.created NATS event", { err });
    }
  });

  await nats.subscribe("db.module.resource.instance.deleted.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleResourceInstanceDeleted(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module.resource.instance.deleted NATS event", { err });
    }
  });

  await nats.subscribe("db.module.installed.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleInstalled(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module installed NATS event", { err });
    }
  });

  await nats.subscribe("db.module.deleted.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleDeleted(ce);
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module deleted NATS event", { err });
    }
  });

  await nats.subscribe("db.module.delete_failed.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleDeleteFailed(ce);
      logger.info("Module delete failed", { moduleKey: event.moduleKey, error: event.error, clientId });
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module delete_failed NATS event", { err });
    }
  });

  await nats.subscribe("db.module.install_failed.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseModuleInstallFailed(ce);
      logger.error("Module install failed", { moduleKey: event.moduleKey, error: event.error, clientId });
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle module install_failed NATS event", { err });
    }
  });

  logger.info("Module event NATS handlers initialized");
}
