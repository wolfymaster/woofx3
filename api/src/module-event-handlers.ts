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
} from "./webhook-client";
import { asString } from "./outbox";
import { subscribeProjections } from "./projection";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { ConfigField } from "@woofx3/api/ui-schema";
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
  emits?: unknown;
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
  returns?: unknown;
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

interface RawConfigField {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  [key: string]: unknown;
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
  // Only carried when the module declared one. An empty object is what the
  // db column defaults to, and forwarding it would make every trigger look
  // like it declares a shape naming nothing — which would stop the UI falling
  // back to the configFields derivation it uses today.
  const emits = asString(raw.emits);
  if (emits !== "" && emits !== "{}") {
    def.emits = emits;
  }
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
    createdByType: asString(raw.created_by_type),
    createdByRef: asString(raw.created_by_ref),
  };
  // Same "{}" rule as a trigger's emits, above.
  const returns = asString(raw.returns);
  if (returns !== "" && returns !== "{}") {
    def.returns = returns;
  }
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

/**
 * Map one declared field onto the shared ConfigField shape.
 *
 * There is a single spelling for every property now, so this no longer has to
 * accept `field_type` alongside `fieldType` or `key` alongside `id` — anything
 * else was rejected at install. Unrecognised properties are carried through
 * rather than dropped: the engine does not own presentation, and a consumer
 * that understands a newer property should still receive it.
 */
function mapConfigField(raw: RawConfigField): ConfigField {
  const { id, label, type, ...rest } = raw;
  return {
    ...(rest as Omit<ConfigField, "id" | "label" | "type">),
    id: asString(id),
    label: asString(label),
    type: asString(type) as ConfigField["type"],
  };
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
    settings: settingsRaw.map((s) => mapConfigField(s as RawConfigField)),
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
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: "db.module.action.registered.*",
      name: "db.module.action.registered",
      parse: (ce) => {
        const { clientId, event } = parseModuleActionRegistered(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.function.registered.*",
      name: "db.module.function.registered",
      parse: (ce) => {
        const { clientId, event } = parseModuleFunctionRegistered(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.action.deregistered.*",
      name: "db.module.action.deregistered",
      parse: (ce) => {
        const { clientId, event } = parseModuleActionDeregistered(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.function.deregistered.*",
      name: "db.module.function.deregistered",
      parse: (ce) => {
        const { clientId, event } = parseModuleFunctionDeregistered(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.widget.registered.*",
      name: "db.module.widget.registered",
      parse: (ce) => {
        const { clientId, event } = parseModuleWidgetRegistered(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.widget.deregistered.*",
      name: "db.module.widget.deregistered",
      parse: (ce) => {
        const { clientId, event } = parseModuleWidgetDeregistered(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.asset.registered.*",
      name: "db.module.asset.registered",
      parse: (ce) => {
        const { clientId, event } = parseModuleAssetRegistered(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.asset.deregistered.*",
      name: "db.module.asset.deregistered",
      parse: (ce) => {
        const { clientId, event } = parseModuleAssetDeregistered(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.resource.instance.created.*",
      name: "db.module.resource.instance.created",
      parse: (ce) => {
        const { clientId, event } = parseModuleResourceInstanceCreated(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.resource.instance.deleted.*",
      name: "db.module.resource.instance.deleted",
      parse: (ce) => {
        const { clientId, event } = parseModuleResourceInstanceDeleted(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.installed.*",
      name: "db.module.installed",
      parse: (ce) => {
        const { clientId, event } = parseModuleInstalled(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.deleted.*",
      name: "db.module.deleted",
      parse: (ce) => {
        const { clientId, event } = parseModuleDeleted(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.delete_failed.*",
      name: "db.module.delete_failed",
      parse: (ce) => {
        const { clientId, event } = parseModuleDeleteFailed(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.module.install_failed.*",
      name: "db.module.install_failed",
      parse: (ce) => {
        const { clientId, event } = parseModuleInstallFailed(ce);
        return event ? { event, clientId } : null;
      },
    },
  ]);
}
