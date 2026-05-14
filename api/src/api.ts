import type {
  AvailableFunction,
  CommandSnapshot,
  CommandType,
  CreateCommandInput,
  CreateWorkflowInput,
  FieldOptionsDescriptor,
  PingResponse,
  Scene,
  StorageConfig,
  UpdateCommandInput,
  UpdateWorkflowInput,
  Woofx3EngineApi,
  WorkflowDefinition,
  WorkflowMutationResult,
} from "@woofx3/api";
import type {
  ActionDefinition,
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneSnapshot,
  SceneUpdatedEvent,
  TriggerDefinition,
  WorkflowCreatedEvent,
  WorkflowDeletedEvent,
  WorkflowUpdatedEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type * as command from "@woofx3/db/command.pb";
import type { Action } from "@woofx3/db/module_action.pb";
import type { Trigger } from "@woofx3/db/module_trigger.pb";
import type * as scene from "@woofx3/db/scene.pb";
import type * as treat from "@woofx3/db/treat.pb";
import type * as user from "@woofx3/db/user.pb";
import type * as workflow from "@woofx3/db/workflow.pb";
import type NATSClient from "@woofx3/nats/src/client";
import { RpcTarget } from "capnweb";
import * as protoscript from "protoscript";
import type { DbClient } from "./db-client";
import {
  parseModuleActionDeregistered,
  parseModuleActionRegistered,
  parseModuleAssetDeregistered,
  parseModuleAssetRegistered,
  parseModuleFunctionDeregistered,
  parseModuleFunctionRegistered,
  parseModuleResourceInstanceCreated,
  parseModuleResourceInstanceDeleted,
  parseModuleTriggerDeregistered,
  parseModuleTriggerRegistered,
  parseModuleWidgetDeregistered,
  parseModuleWidgetRegistered,
} from "./module-event-handlers";
import type { WebhookClient } from "./webhook-client";
import { validateWorkflowDefinition } from "./workflow/validate-definition";
import {
  parseWorkflowCreated,
  parseWorkflowDeleted,
  parseWorkflowUpdated,
} from "./workflow-event-handlers";
import {
  parseSceneCreated,
  parseSceneDeleted,
  parseSceneUpdated,
} from "./scene-event-handlers";
import {
  parseAlertCreated,
  parseAlertUpdated,
} from "./alert-log-handlers";

/**
 * Helper to create a protoscript.Timestamp from a Date
 */
function timestampFromDate(date: Date): protoscript.Timestamp {
  const seconds = Math.floor(date.getTime() / 1000);
  const nanos = (date.getTime() % 1000) * 1000000;
  return {
    seconds: BigInt(seconds),
    nanos,
  };
}

/**
 * Convert a protoscript.Timestamp (or anything shaped like one) to an ISO
 * 8601 string. Falls back to `new Date().toISOString()` when the input is
 * missing or has no `seconds` — the engine treats every workflow row as
 * having valid timestamps, so the fallback is only defensive.
 */
function timestampToIso(ts: { seconds?: bigint; nanos?: number } | undefined): string {
  if (!ts || ts.seconds === undefined) {
    return new Date().toISOString();
  }
  const ms = Number(ts.seconds) * 1000 + Math.floor((ts.nanos ?? 0) / 1_000_000);
  return new Date(ms).toISOString();
}

/**
 * Convert a db-proxy `Scene` row into the lightweight wire shape the
 * shared API exposes (`{ id, name, accountId, widgets, createdAt }`).
 * `widgets_json` is parsed best-effort — the engine never inspects it,
 * but the wire `SceneWidget[]` interface is structurally compatible
 * with the editor's instance shape (a superset is fine).
 */
function dbSceneToWire(s: scene.Scene): Scene {
  const widgets = parseSceneWidgets(s.widgetsJson ?? "");
  return {
    id: s.id ?? "",
    name: s.name ?? "",
    accountId: s.applicationId ?? "",
    widgets,
    createdAt: timestampToIso(s.createdAt),
  };
}

/**
 * Convert a db-proxy `Scene` row into the rich `SceneSnapshot` shape
 * the webhook event carries. The engine doesn't peek inside the JSON
 * columns — they round-trip verbatim so the Convex side can parse
 * them with the full widget-instance shape it knows about.
 */
function dbSceneToSnapshot(s: scene.Scene): SceneSnapshot {
  return {
    id: s.id ?? "",
    applicationId: s.applicationId ?? "",
    name: s.name ?? "",
    description: s.description ?? "",
    widgetsJson: s.widgetsJson ?? "[]",
    layoutJson: s.layoutJson ?? "{}",
    createdByType: s.createdByType ?? "USER",
    createdByRef: s.createdByRef ?? "",
    createdAt: timestampToIso(s.createdAt),
    updatedAt: timestampToIso(s.updatedAt),
  };
}

/**
 * Parse `widgetsJson` for the wire `Scene.widgets` array. Drops
 * entries that lack the minimum shape (id + position + size) — a
 * defensive call since the engine has never validated this column.
 */
function parseSceneWidgets(raw: string): Scene["widgets"] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: Scene["widgets"] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const obj = entry as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id : null;
      if (!id) {
        continue;
      }
      const positionRaw = obj.position as Record<string, unknown> | undefined;
      const sizeRaw = obj.size as Record<string, unknown> | undefined;
      const x = positionRaw && typeof positionRaw.x === "number" ? positionRaw.x : 0;
      const y = positionRaw && typeof positionRaw.y === "number" ? positionRaw.y : 0;
      const w = sizeRaw && typeof sizeRaw.w === "number" ? sizeRaw.w : 0;
      const h = sizeRaw && typeof sizeRaw.h === "number" ? sizeRaw.h : 0;
      const type = typeof obj.type === "string" ? obj.type : "";
      out.push({ id, type, position: { x, y }, size: { w, h } });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Rebuild a `WorkflowDefinition` from the engine-shape JSON columns
 * persisted on a Workflow proto. Returns `null` when the workflow has
 * no trigger (an unrecoverable shape — the engine refuses to register
 * a workflow without a trigger anyway).
 *
 * The pre-Phase-C path stored the full WorkflowDefinition as a single
 * `_definition` variable; that's gone now and the canonical source is
 * `stepsJson` + `triggerJson` straight off the workflow row.
 */
function rebuildWorkflowDefinition(wf: {
  id?: string;
  name?: string;
  description?: string;
  stepsJson?: string;
  triggerJson?: string;
}): WorkflowDefinition | null {
  if (!wf.triggerJson) {
    return null;
  }
  let trigger: WorkflowDefinition["trigger"];
  let tasks: WorkflowDefinition["tasks"];
  try {
    trigger = JSON.parse(wf.triggerJson) as WorkflowDefinition["trigger"];
    tasks = wf.stepsJson ? (JSON.parse(wf.stepsJson) as WorkflowDefinition["tasks"]) : [];
  } catch {
    return null;
  }
  return {
    id: wf.id ?? "",
    name: wf.name ?? "",
    description: wf.description,
    trigger,
    tasks,
  };
}

/**
 * Narrow the engine's protobuf Command type to the shared API
 * CommandSnapshot. The proto's `type` field is a free-form string but the
 * UI only ever creates one of three known values; we cast through
 * `CommandType` so consumers don't have to re-validate.
 */
function commandToSnapshot(c: command.Command): CommandSnapshot {
  return {
    id: c.id,
    applicationId: c.applicationId,
    command: c.command,
    type: c.type as CommandType,
    typeValue: c.typeValue,
    cooldown: c.cooldown,
    priority: c.priority,
    enabled: c.enabled,
  };
}

/**
 * Extract the catalog-facing fields the UI surfaces for an installed module
 * from the manifest JSON the engine stores on `modules.manifest`.
 *
 * Author and category come straight from the manifest authored by the
 * module developer. Both fall back to "Unknown" when missing, blank, or
 * when the stored manifest is malformed — the UI must always have a
 * concrete string to render.
 */
export function readModuleCatalogFields(rawManifest: string | undefined): {
  author: string;
  category: string;
} {
  const fallback = { author: "Unknown", category: "Unknown" };
  if (!rawManifest) {
    return fallback;
  }
  let parsed: { author?: unknown; category?: unknown } = {};
  try {
    const v = JSON.parse(rawManifest);
    if (v && typeof v === "object") {
      parsed = v as { author?: unknown; category?: unknown };
    }
  } catch {
    return fallback;
  }
  const pick = (val: unknown, key: "author" | "category"): string => {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed !== "") {
        return trimmed;
      }
    }
    return fallback[key];
  };
  return {
    author: pick(parsed.author, "author"),
    category: pick(parsed.category, "category"),
  };
}

/**
 * Response payload returned by uninstallModule / uninstallEngineModule.
 * The actual removal runs asynchronously in the engine; the caller receives
 * `requested: true` immediately, then learns the outcome via the webhook
 * events `module.deleted` or `module.delete_failed`, both of which carry
 * `moduleKey` for correlation with the originating install.
 */
export interface UninstallModuleResponse {
  requested: boolean;
}

interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  accountId: string;
  isEnabled: boolean;
  definition: WorkflowDefinition | null;
  stats: { runsToday: number; successRate: number };
  createdAt: string;
  updatedAt: string;
}

/**
 * UI-focused API interface exposed via capnweb.
 * Methods represent user actions and use cases rather than database operations.
 */
interface ApiOptions {
  db: DbClient;
  nats: NATSClient | null;
  barkloaderUrl: string;
  /**
   * Streamware service URL, used in `getEngineInfo()` to tell the UI
   * where to load scene overlays from. Optional in tests; defaults
   * to empty string when omitted (callers should provide it in real
   * deployments).
   */
  streamwareUrl?: string;
  logger: SharedLogger;
}

export class Api extends RpcTarget implements Woofx3EngineApi {
  private triggerSubscribers = new Set<{
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }>();
  private webhookClient: WebhookClient | null = null;
  private authInvalidate: (() => void) | null = null;

  private db: DbClient;
  private nats: NATSClient | null;
  private applicationId: string | null = null;
  private barkloaderUrl: string;
  private streamwareUrl: string;
  private logger: SharedLogger;

  constructor(opts: ApiOptions) {
    super();
    if (!opts.db) {
      throw new Error("ApiOptions.db is required");
    }
    if (!opts.barkloaderUrl) {
      throw new Error("ApiOptions.barkloaderUrl is required");
    }
    this.db = opts.db;
    this.nats = opts.nats;
    this.barkloaderUrl = opts.barkloaderUrl;
    this.streamwareUrl = opts.streamwareUrl ?? "";
    this.logger = opts.logger;
  }

  async ping(): Promise<PingResponse> {
    return { status: "ok", instanceId: this.applicationId ?? "pending" };
  }

  /**
   * Surface deployment URLs to the UI so it can compose iframe
   * sources and asset URLs deterministically. Called once per UI
   * session and cached.
   *
   * `widgetAssetBaseUrl` is sourced from the engine's settings
   * (`widget_asset_base_url`), which the operator configures to point
   * at whatever storage backend hosts module assets — Convex
   * storage, an S3/R2 public bucket, a CDN, or a local static
   * server in dev. Barkloader only writes to the configured
   * repository; serving the files is the repository's concern, not
   * a barkloader HTTP route.
   *
   * `engineSceneOverlayBaseUrl` is the streamware URL (always
   * served by streamware itself — overlay HTML is engine-owned).
   *
   * Both URLs strip trailing slashes so callers can join with `/`
   * without worrying about double-slashes. An empty
   * `widgetAssetBaseUrl` is a valid response — it signals to the UI
   * that storage isn't configured yet, and the editor renders the
   * "widget unavailable" placeholder instead of a broken iframe.
   */
  async getEngineInfo(): Promise<{
    widgetAssetBaseUrl: string;
    engineSceneOverlayBaseUrl: string;
  }> {
    const applicationId = await this.ensureApplicationId();
    const configured = (await this.db.getSetting("widget_asset_base_url", applicationId)) ?? "";
    const streamware = this.streamwareUrl.replace(/\/+$/, "");
    return {
      widgetAssetBaseUrl: configured.replace(/\/+$/, ""),
      engineSceneOverlayBaseUrl: `${streamware}/overlay/scene`,
    };
  }

  /**
   * Update the engine-stored widget asset base URL. Used by the UI
   * settings form; the operator points it at whichever storage
   * backend they've configured barkloader's repository to write to
   * (Convex storage signed URL pattern, R2 public bucket, S3 with
   * CloudFront, etc.).
   *
   * Empty string is allowed and clears the setting — the UI
   * displays widgets as unavailable until a URL is configured.
   */
  async setWidgetAssetBaseUrl(value: string): Promise<{ success: boolean }> {
    const applicationId = await this.ensureApplicationId();
    const normalized = value.trim().replace(/\/+$/, "");
    const response = await this.db.setSetting("widget_asset_base_url", normalized, applicationId);
    return { success: response.status?.code === "OK" };
  }

  /**
   * Read the active storage backend configuration. Returns the
   * provider plus whichever fields are populated; missing values
   * are returned as undefined. Secret values (`accessKey`,
   * `secretKey`) are masked — read returns `"***"` when set, empty
   * when unset. Writes pass through directly via setStorageConfig.
   */
  async getStorageConfig(): Promise<StorageConfig> {
    // Storage settings are not application-scoped — the repository
    // is a process-wide singleton in barkloader, so we read with an
    // empty applicationId which the db-proxy treats as the default
    // application (same convention barkloader uses on read).
    const applicationId = "";
    const provider = (await this.db.getSetting("storage.provider", applicationId)) || "file";
    if (provider !== "file" && provider !== "s3") {
      throw new Error(`Unknown storage.provider value: ${provider}`);
    }
    const result: StorageConfig = {
      provider: provider as "file" | "s3",
    };
    if (provider === "file") {
      const dest = await this.db.getSetting("storage.file.destination", applicationId);
      if (dest) {
        result.destination = dest;
      }
    } else {
      const [bucket, prefix, region, endpoint, accessKey, secretKey, forcePathStyle] =
        await Promise.all([
          this.db.getSetting("storage.s3.bucket", applicationId),
          this.db.getSetting("storage.s3.prefix", applicationId),
          this.db.getSetting("storage.s3.region", applicationId),
          this.db.getSetting("storage.s3.endpoint", applicationId),
          this.db.getSetting("storage.s3.access_key", applicationId),
          this.db.getSetting("storage.s3.secret_key", applicationId),
          this.db.getSetting("storage.s3.force_path_style", applicationId),
        ]);
      if (bucket) result.bucket = bucket;
      if (prefix) result.prefix = prefix;
      if (region) result.region = region;
      if (endpoint) result.endpoint = endpoint;
      // Mask credentials on read so a curious UI doesn't leak them.
      // The form sends the literal "***" back unchanged when the user
      // didn't touch the field, and we treat that as "leave unchanged"
      // in setStorageConfig.
      if (accessKey) result.accessKey = "***";
      if (secretKey) result.secretKey = "***";
      result.forcePathStyle = forcePathStyle === "true";
    }
    return result;
  }

  /**
   * Persist storage backend configuration to engine settings. Empty
   * strings clear individual fields. The literal `"***"` for
   * accessKey / secretKey means "leave the existing value alone" —
   * the operator can edit endpoint/bucket/region without re-typing
   * credentials every time.
   */
  async setStorageConfig(config: StorageConfig): Promise<{ success: boolean }> {
    const applicationId = "";
    if (config.provider !== "file" && config.provider !== "s3") {
      throw new Error(`Unknown provider: ${config.provider}`);
    }
    const updates: Array<[string, string]> = [["storage.provider", config.provider]];
    if (config.provider === "file") {
      updates.push(["storage.file.destination", config.destination ?? ""]);
    } else {
      updates.push(["storage.s3.bucket", config.bucket ?? ""]);
      updates.push(["storage.s3.prefix", config.prefix ?? ""]);
      updates.push(["storage.s3.region", config.region ?? ""]);
      updates.push(["storage.s3.endpoint", config.endpoint ?? ""]);
      if (config.accessKey !== undefined && config.accessKey !== "***") {
        updates.push(["storage.s3.access_key", config.accessKey]);
      }
      if (config.secretKey !== undefined && config.secretKey !== "***") {
        updates.push(["storage.s3.secret_key", config.secretKey]);
      }
      updates.push(["storage.s3.force_path_style", config.forcePathStyle ? "true" : "false"]);
    }
    for (const [key, value] of updates) {
      const response = await this.db.setSetting(key, value, applicationId);
      if (response.status?.code !== "OK") {
        return { success: false };
      }
    }
    return { success: true };
  }

  async deleteClient(clientId: string): Promise<{ success: boolean; message: string }> {
    this.logger.info("Deleting client", { clientId });
    const resp = await this.db.getClientByClientID(clientId);
    if (!resp.client) {
      return { success: false, message: "Client not found" };
    }
    await this.db.deleteClient(resp.client.id);
    if (this.authInvalidate) {
      this.authInvalidate();
    }
    if (this.webhookClient) {
      await this.webhookClient.refreshCallbackUrls();
    }
    this.logger.info("Client deleted", { clientId });
    return { success: true, message: "Client deleted" };
  }

  setWebhookClient(client: WebhookClient): void {
    this.webhookClient = client;
    if (this.applicationId) {
      client.setApplicationId(this.applicationId);
    }
  }

  setAuthInvalidate(fn: () => void): void {
    this.authInvalidate = fn;
  }

  setApplicationId(applicationId: string): void {
    this.applicationId = applicationId;
    if (this.webhookClient) {
      this.webhookClient.setApplicationId(applicationId);
    }
  }

  private async ensureApplicationId(): Promise<string> {
    if (this.applicationId) {
      return this.applicationId;
    }
    const app = await this.db.getDefaultApplication();
    if (!app) {
      throw new Error("No default application; complete UI onboarding first");
    }
    this.applicationId = app.id;
    if (this.webhookClient) {
      this.webhookClient.setApplicationId(app.id);
      void this.webhookClient.refreshCallbackUrls();
    }
    return app.id;
  }

  async initSubscriptions(): Promise<void> {
    if (!this.nats) {
      this.logger.warn("NATS client not available, skipping subscriptions");
      return;
    }

    this.logger.info("Initializing NATS subscriptions for module events");

    // R1: orchestration relocated to streamware. The api keeps only
    // db-outbox → webhook projection (its boundary role). Streamware
    // now subscribes to `ui.notify.alert`, `ui.widget.status`, and
    // `module.widget.status.changed`; see streamware/src/widget-event-
    // handlers.ts. The api subscribes below to the resulting outbox
    // events (`db.alert.{created,updated}.*`,
    // `db.widget_status.updated.*`) and projects them to webhooks.
    //
    // applicationId resolution that used to live here also moved to
    // the orchestrator. The api still tracks `this.applicationId` for
    // its own RPC paths (e.g. resolving default app on operator
    // controls) but doesn't need to consult it here.

    await this.nats.subscribe("db.module.trigger.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.trigger.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleTriggerRegistered(ce);
        this.logger.info("Parsed module.trigger.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          triggerCount: event.triggers.length,
          clientId,
        });

        await this.notifyTriggerChange(event.moduleKey);

        if (this.webhookClient) {
          this.logger.info("Sending module.trigger.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.trigger.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.trigger.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.action.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.action.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleActionRegistered(ce);
        this.logger.info("Parsed module.action.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          actionCount: event.actions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.action.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.action.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.action.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.function.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.function.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleFunctionRegistered(ce);
        this.logger.info("Parsed module.function.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          functionCount: event.functions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.function.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.function.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.function.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.trigger.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.trigger.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleTriggerDeregistered(ce);
        this.logger.info("Parsed module.trigger.deregistered", {
          modulePrefix: event.modulePrefix,
          triggerCount: event.triggers.length,
          clientId,
        });

        await this.notifyTriggerChange(event.modulePrefix);

        if (this.webhookClient) {
          this.logger.info("Sending module.trigger.deregistered to webhook client", {
            modulePrefix: event.modulePrefix,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.trigger.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.trigger.deregistered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.action.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.action.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleActionDeregistered(ce);
        this.logger.info("Parsed module.action.deregistered", {
          modulePrefix: event.modulePrefix,
          actionCount: event.actions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.action.deregistered to webhook client", {
            modulePrefix: event.modulePrefix,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.action.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.action.deregistered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.function.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.function.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleFunctionDeregistered(ce);
        this.logger.info("Parsed module.function.deregistered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          functionCount: event.functions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.function.deregistered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.function.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.function.deregistered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.widget.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.widget.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleWidgetRegistered(ce);
        this.logger.info("Parsed module.widget.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          widgetCount: event.widgets.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.widget.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.widget.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.widget.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.widget.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.widget.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleWidgetDeregistered(ce);
        this.logger.info("Parsed module.widget.deregistered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          widgetCount: event.widgets.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.widget.deregistered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.widget.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.widget.deregistered NATS event", { err });
      }
    });

    // Module asset registration / deregistration outbox. Mirror of the
    // widget rails: db proxy publishes after RegisterAssets /
    // DeleteAssetsByModuleId; api forwards to the registered callback
    // so the editor can refresh its asset picker.
    await this.nats.subscribe("db.module.asset.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.asset.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleAssetRegistered(ce);
        this.logger.info("Parsed module.asset.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          assetCount: event.assets.length,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.asset.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.asset.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.asset.deregistered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.asset.deregistered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleAssetDeregistered(ce);
        this.logger.info("Parsed module.asset.deregistered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          assetCount: event.assets.length,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.asset.deregistered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.asset.deregistered NATS event", { err });
      }
    });

    // Module resource instance lifecycle — fired by db-proxy after each
    // CreateResourceInstance / DeleteResourceInstance RPC. Forwarded to
    // the registered Convex webhook so UI pickers backed by
    // `resource_ref(kind=...)` ConfigFields refresh live.
    await this.nats.subscribe("db.module.resource.instance.created.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.resource.instance.created.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleResourceInstanceCreated(ce);
        this.logger.info("Parsed module.resource.instance.created", {
          canonicalId: event.instance.canonicalId,
          kind: event.instance.kind,
          displayName: event.instance.displayName,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.resource.instance.created");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.resource.instance.created NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.resource.instance.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.resource.instance.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleResourceInstanceDeleted(ce);
        this.logger.info("Parsed module.resource.instance.deleted", {
          canonicalId: event.instance.canonicalId,
          kind: event.instance.kind,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.resource.instance.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.resource.instance.deleted NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.installed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.installed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          version?: string;
          author?: string;
          category?: string;
          description?: string;
        };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.installed event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleVersion = payload.version ?? "";
        const moduleKey = payload.module_key ?? "";
        // Catalog metadata extracted server-side from the stored
        // manifest. The engine guarantees author/category are non-empty
        // ("Unknown" when absent); description may be blank when the
        // manifest declared none.
        const author = payload.author ?? "";
        const category = payload.category ?? "";
        const description = payload.description ?? "";

        if (this.webhookClient) {
          this.logger.info("Sending module.installed to webhook client", {
            moduleName,
            moduleVersion,
            moduleKey,
            clientId,
          });
          await this.webhookClient.send(
            {
              type: "module.installed",
              moduleName,
              version: moduleVersion,
              moduleKey,
              author,
              category,
              description,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.installed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module installed NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as { module_id?: string; module_name?: string; module_key?: string };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.deleted event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleKey = payload.module_key ?? "";
        if (this.webhookClient) {
          await this.webhookClient.send(
            {
              type: "module.deleted",
              moduleName,
              moduleKey,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle module deleted NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.delete_failed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.delete_failed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          error?: string;
          in_use_resources?: Array<{
            resource_id?: string;
            resource_type?: string;
            resource_name?: string;
            resource_display_name?: string;
            used_by?: Array<{ source_type?: string; source_id?: string; source_name?: string; context?: string }>;
          }>;
        };
        const clientId = (ce.client_id as string) ?? "";
        const moduleName = payload.module_name ?? "";
        const moduleKey = payload.module_key ?? "";
        const error = payload.error ?? "Unknown error";
        const inUseResources = (payload.in_use_resources ?? []).map((r) => ({
          resourceId: r.resource_id ?? "",
          resourceType: r.resource_type ?? "",
          resourceName: r.resource_name ?? "",
          resourceDisplayName: r.resource_display_name ?? "",
          usedBy: (r.used_by ?? []).map((u) => ({
            sourceType: u.source_type ?? "",
            sourceId: u.source_id ?? "",
            sourceName: u.source_name ?? "",
            context: u.context ?? "",
          })),
        }));
        this.logger.info("Parsed module.delete_failed event", {
          moduleName,
          moduleKey,
          error,
          inUseCount: inUseResources.length,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(
            {
              type: "module.delete_failed",
              moduleName,
              moduleKey,
              error,
              inUseResources,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.delete_failed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module delete_failed NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.install_failed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.install_failed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          version?: string;
          error?: string;
        };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.install_failed event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleVersion = payload.version ?? "";
        const moduleKey = payload.module_key ?? "";
        const errorMsg = payload.error ?? "Unknown error";
        this.logger.error("Module install failed", { moduleName, moduleVersion, moduleKey, error: errorMsg, clientId });

        if (this.webhookClient) {
          this.logger.info("Sending module.install_failed to webhook client", {
            moduleName,
            moduleVersion,
            moduleKey,
            error: errorMsg,
            clientId,
          });
          await this.webhookClient.send(
            {
              type: "module.install_failed",
              moduleName,
              version: moduleVersion,
              moduleKey,
              error: errorMsg,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.install_failed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module install_failed NATS event", { err });
      }
    });

    // Workflow lifecycle events from the db proxy. Required so workflows
    // created by side-channels other than the api's own createWorkflow
    // RPC reach the UI — most notably the workflows declared in a
    // module manifest, which barkloader registers via Twirp directly
    // against the db proxy and never flow through api.ts:createWorkflow.
    // The inline emits in createWorkflow / updateWorkflow / deleteWorkflow
    // remain for now; the UI's webhook handler upserts on workflow id
    // so the duplicate is idempotent.
    await this.nats.subscribe("db.workflow.created.*", async (msg) => {
      this.logger.info("Received NATS message on db.workflow.created.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseWorkflowCreated(ce);
        if (!event) {
          this.logger.warn("workflow.created payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed workflow.created", {
          applicationId,
          clientId,
          workflowId: event.workflow.id,
          name: event.workflow.definition?.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for workflow.created");
        }
      } catch (err) {
        this.logger.error("Failed to handle workflow.created NATS event", { err });
      }
    });

    await this.nats.subscribe("db.workflow.updated.*", async (msg) => {
      this.logger.info("Received NATS message on db.workflow.updated.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseWorkflowUpdated(ce);
        if (!event) {
          this.logger.warn("workflow.updated payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed workflow.updated", {
          applicationId,
          clientId,
          workflowId: event.workflow.id,
          name: event.workflow.definition?.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for workflow.updated");
        }
      } catch (err) {
        this.logger.error("Failed to handle workflow.updated NATS event", { err });
      }
    });

    await this.nats.subscribe("db.workflow.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.workflow.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseWorkflowDeleted(ce);
        if (!event) {
          this.logger.warn("workflow.deleted payload missing workflow id, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed workflow.deleted", {
          applicationId,
          clientId,
          workflowId: event.workflowId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for workflow.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle workflow.deleted NATS event", { err });
      }
    });

    // Scene CRUD outbox — db proxy publishes on
    // `db.scene.{created,updated,deleted}.<applicationId>` after every
    // scene mutation. Forward each through the Bearer-auth callback
    // channel so Convex can sync its scene editor without polling.
    await this.nats.subscribe("db.scene.created.*", async (msg) => {
      this.logger.info("Received NATS message on db.scene.created.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseSceneCreated(ce);
        if (!event) {
          this.logger.warn("scene.created payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed scene.created", {
          applicationId,
          clientId,
          sceneId: event.scene.id,
          name: event.scene.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for scene.created");
        }
      } catch (err) {
        this.logger.error("Failed to handle scene.created NATS event", { err });
      }
    });

    await this.nats.subscribe("db.scene.updated.*", async (msg) => {
      this.logger.info("Received NATS message on db.scene.updated.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseSceneUpdated(ce);
        if (!event) {
          this.logger.warn("scene.updated payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed scene.updated", {
          applicationId,
          clientId,
          sceneId: event.scene.id,
          name: event.scene.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for scene.updated");
        }
      } catch (err) {
        this.logger.error("Failed to handle scene.updated NATS event", { err });
      }
    });

    await this.nats.subscribe("db.scene.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.scene.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseSceneDeleted(ce);
        if (!event) {
          this.logger.warn("scene.deleted payload missing scene id, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed scene.deleted", {
          applicationId,
          clientId,
          sceneId: event.sceneId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for scene.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle scene.deleted NATS event", { err });
      }
    });

    // Alert log outbox. db proxy publishes when a row is created
    // (every recorded ui.notify.alert dispatch) or updated (today
    // only the replay status flip surfaces). We project both into
    // webhook events so the Convex alert-log page sees new rows in
    // real time without polling.
    await this.nats.subscribe("db.alert.created.*", async (msg) => {
      this.logger.info("Received NATS message on db.alert.created.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseAlertCreated(ce);
        if (!event) {
          this.logger.warn("alert.created payload missing required fields, skipping", {
            applicationId,
            clientId,
          });
          return;
        }
        this.logger.info("Parsed alert.recorded", {
          applicationId,
          clientId,
          alertId: event.alert.id,
          status: event.alert.status,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for alert.recorded");
        }
      } catch (err) {
        this.logger.error("Failed to handle alert.created NATS event", { err });
      }
    });

    await this.nats.subscribe("db.alert.updated.*", async (msg) => {
      this.logger.info("Received NATS message on db.alert.updated.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { applicationId, clientId, event } = parseAlertUpdated(ce);
        if (!event) {
          // Lifecycle transitions that don't have a webhook surface
          // (today: `"playing"`) intentionally drop here — see
          // `parseAlertUpdated` for the projection map.
          return;
        }
        this.logger.info("Parsed alert lifecycle update", {
          applicationId,
          clientId,
          alertId: event.alert.id,
          eventType: event.type,
          status: event.alert.status,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback", {
            eventType: event.type,
          });
        }
      } catch (err) {
        this.logger.error("Failed to handle alert.updated NATS event", { err });
      }
    });

    // db.widget_status.updated.{appId} — db proxy outbox event fired
    // by `widgetStatusService.publishChange` whenever the streamware
    // orchestrator upserts a widget_status row. Project to the
    // dashboard via the WIDGET_STATUS_CHANGED webhook. Same boundary
    // pattern as the alert / module / scene / workflow projections.
    await this.nats.subscribe("db.widget_status.updated.*", async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        const data = (ce.data as Record<string, unknown> | undefined) ?? (ce as Record<string, unknown>);
        const moduleId = typeof data.module_id === "string"
          ? (data.module_id as string)
          : typeof data.ModuleID === "string"
            ? (data.ModuleID as string)
            : "";
        const instanceId = typeof data.instance_id === "string"
          ? (data.instance_id as string)
          : typeof data.InstanceID === "string"
            ? (data.InstanceID as string)
            : "";
        const key = typeof data.key === "string"
          ? (data.key as string)
          : typeof data.Key === "string"
            ? (data.Key as string)
            : "";
        if (!moduleId || !instanceId || !key) {
          this.logger.warn("db.widget_status.updated: missing required fields; dropping", {
            moduleId,
            instanceId,
            key,
          });
          return;
        }
        const widgetCanonicalId = typeof data.widget_canonical_id === "string"
          ? (data.widget_canonical_id as string)
          : typeof data.WidgetCanonicalID === "string"
            ? (data.WidgetCanonicalID as string)
            : "";
        const occurredAt = typeof data.occurred_at === "string"
          ? (data.occurred_at as string)
          : typeof data.OccurredAt === "string"
            ? (data.OccurredAt as string)
            : new Date().toISOString();
        const applicationId = typeof ce.application_id === "string"
          ? (ce.application_id as string)
          : typeof data.application_id === "string"
            ? (data.application_id as string)
            : "";
        if (!applicationId) {
          this.logger.warn("db.widget_status.updated: missing applicationId; dropping", {
            moduleId,
            instanceId,
            key,
          });
          return;
        }
        // The db proxy serialises `value` as a JSONB-stringified form.
        // Round-trip parse so the webhook payload carries the typed
        // shape consumers expect.
        let parsedValue: unknown = null;
        const rawValue = data.value ?? data.Value;
        if (typeof rawValue === "string") {
          try {
            parsedValue = JSON.parse(rawValue);
          } catch {
            parsedValue = rawValue;
          }
        } else if (rawValue !== undefined) {
          parsedValue = rawValue;
        }
        if (this.webhookClient) {
          await this.webhookClient.send({
            type: EngineEventType.WIDGET_STATUS_CHANGED,
            applicationId,
            moduleId,
            instanceId,
            widgetCanonicalId: widgetCanonicalId || undefined,
            key,
            value: parsedValue,
            occurredAt,
          });
        }
        this.logger.info("widget status webhook dispatched", {
          applicationId,
          moduleId,
          instanceId,
          key,
        });
      } catch (err) {
        this.logger.error("db.widget_status.updated: handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Twitch stream lifecycle. The twitch service publishes
    // `online.user.twitch` / `offline.user.twitch` cloudevents from
    // its EventSub listener; we translate them to the webhook
    // `stream.online` / `stream.offline` events the UI subscribes to.
    //
    // applicationId is resolved lazily from the default application —
    // the engine is single-broadcaster-per-deployment today, so every
    // emitted event scopes to the same id. The `_d` is the raw
    // CloudEvent data; we read the broadcaster fields directly.
    await this.nats.subscribe("online.user.twitch", async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        const data = (ce.data as Record<string, unknown> | undefined) ?? ce;
        const twitchUserId =
          typeof data.broadcasterUserId === "string"
            ? (data.broadcasterUserId as string)
            : typeof data.broadcaster_user_id === "string"
              ? (data.broadcaster_user_id as string)
              : "";
        const startedAt =
          typeof data.startedAt === "string"
            ? (data.startedAt as string)
            : typeof data.started_at === "string"
              ? (data.started_at as string)
              : new Date().toISOString();
        if (!this.webhookClient) {
          return;
        }
        // Best-effort enrichment via the live-state RPC path so the UI
        // can render title / game / viewer count on the same event.
        // Failures degrade silently — the minimal payload is still
        // useful (the UI polls every minute as backup).
        let enrichment: Awaited<ReturnType<typeof this.getStreamStatus>> | null = null;
        try {
          enrichment = await this.getStreamStatus("");
        } catch (err) {
          this.logger.warn("stream.online enrichment failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        let applicationId = this.applicationId;
        if (!applicationId) {
          try {
            applicationId = await this.ensureApplicationId();
          } catch {
            this.logger.warn("stream.online: no applicationId yet; skipping webhook");
            return;
          }
        }
        await this.webhookClient.send({
          type: EngineEventType.STREAM_ONLINE,
          applicationId,
          twitchUserId,
          startedAt: enrichment?.startedAt ?? startedAt,
          streamTitle: enrichment?.streamTitle,
          gameName: enrichment?.gameName,
          viewerCount: enrichment?.viewerCount,
        });
      } catch (err) {
        this.logger.error("online.user.twitch: handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await this.nats.subscribe("offline.user.twitch", async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        const data = (ce.data as Record<string, unknown> | undefined) ?? ce;
        const twitchUserId =
          typeof data.broadcasterUserId === "string"
            ? (data.broadcasterUserId as string)
            : typeof data.broadcaster_user_id === "string"
              ? (data.broadcaster_user_id as string)
              : "";
        if (!this.webhookClient) {
          return;
        }
        let applicationId = this.applicationId;
        if (!applicationId) {
          try {
            applicationId = await this.ensureApplicationId();
          } catch {
            this.logger.warn("stream.offline: no applicationId yet; skipping webhook");
            return;
          }
        }
        await this.webhookClient.send({
          type: EngineEventType.STREAM_OFFLINE,
          applicationId,
          twitchUserId,
        });
      } catch (err) {
        this.logger.error("offline.user.twitch: handler failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this.logger.info("NATS subscriptions initialized for module events");
  }

  async subscribeTriggerChanges(callback: {
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }): Promise<void> {
    this.triggerSubscribers.add(callback);
  }

  private async notifyTriggerChange(moduleName: string): Promise<void> {
    type Subscriber = { onTriggerChange(event: { type: string; moduleName: string }): Promise<void> };
    const dead: Subscriber[] = [];
    for (const cb of this.triggerSubscribers) {
      try {
        await cb.onTriggerChange({ type: "registered", moduleName });
      } catch {
        dead.push(cb);
      }
    }
    for (const cb of dead) {
      this.triggerSubscribers.delete(cb);
    }
  }

  // ==================== Workflows ====================

  /**
   * Get available workflows for the UI to display.
   * Returns workflows with their current status and recent execution info.
   */
  async getAvailableWorkflows(): Promise<{
    workflows: Array<{
      id: string;
      name: string;
      description: string;
      enabled: boolean;
      lastExecution?: {
        id: string;
        status: string;
        startedAt: string;
      };
    }>;
  }> {
    this.logger.debug("Getting available workflows");
    const applicationId = await this.ensureApplicationId();
    const req: workflow.ListWorkflowsRequest = {
      applicationId,
      includeDisabled: false,
      page: 1,
      pageSize: 1000,
      sortBy: "name",
      sortDesc: false,
    };
    const response = await this.db.listWorkflows(req);
    if (response.status?.code !== "OK") {
      this.logger.error("Failed to get workflows", {
        error: response.status?.message,
        code: response.status?.code,
      });
      throw new Error(response.status?.message || "Failed to get workflows");
    }
    this.logger.info("Retrieved available workflows", {
      count: response.workflows?.length || 0,
    });

    // Get recent executions for each workflow
    const workflowsWithStatus = await Promise.all(
      (response.workflows || []).map(async (wf) => {
        const execReq: workflow.ListWorkflowExecutionsRequest = {
          workflowId: wf.id,
          applicationId,
          status: "",
          startedBy: "",
          from: protoscript.Timestamp.initialize(),
          to: protoscript.Timestamp.initialize(),
          page: 1,
          pageSize: 1,
          sortBy: "startedAt",
          sortDesc: true,
        };
        const execResponse = await this.db.listWorkflowExecutions(execReq);
        const lastExecution = execResponse.executions?.[0];

        return {
          id: wf.id,
          name: wf.name,
          description: wf.description,
          enabled: wf.enabled,
          lastExecution: lastExecution
            ? {
                id: lastExecution.id,
                status: lastExecution.status,
                startedAt: lastExecution.startedAt
                  ? new Date(
                      Number(lastExecution.startedAt.seconds) * 1000 + lastExecution.startedAt.nanos / 1000000
                    ).toISOString()
                  : "",
              }
            : undefined,
        };
      })
    );

    return { workflows: workflowsWithStatus };
  }

  /**
   * Trigger a workflow by name (user-friendly).
   * The UI can call this with a workflow name and parameters.
   */
  async triggerWorkflowByName(
    workflowName: string,
    parameters: Record<string, string> = {},
    userId?: string
  ): Promise<{
    executionId: string;
    status: string;
    message: string;
  }> {
    this.logger.info("Triggering workflow by name", {
      workflowName,
      userId,
      parametersCount: Object.keys(parameters).length,
    });
    const applicationId = await this.ensureApplicationId();
    // First, find the workflow by name
    const workflowsReq: workflow.ListWorkflowsRequest = {
      applicationId,
      includeDisabled: false,
      page: 1,
      pageSize: 1000,
      sortBy: "name",
      sortDesc: false,
    };
    const workflowsResponse = await this.db.listWorkflows(workflowsReq);
    if (workflowsResponse.status?.code !== "OK") {
      throw new Error("Failed to find workflows");
    }

    const foundWorkflow = workflowsResponse.workflows?.find(
      (wf) => wf.name.toLowerCase() === workflowName.toLowerCase()
    );
    if (!foundWorkflow) {
      throw new Error(`Workflow "${workflowName}" not found`);
    }
    if (!foundWorkflow.enabled) {
      throw new Error(`Workflow "${workflowName}" is disabled`);
    }

    // Execute the workflow
    const correlationId = crypto.randomUUID();
    const execReq: workflow.ExecuteWorkflowRequest = {
      workflowId: foundWorkflow.id,
      applicationId,
      startedBy: userId || "ui",
      inputs: parameters,
      async: true,
      correlationId,
    };
    const execResponse = await this.db.executeWorkflow(execReq);
    if (execResponse.status?.code !== "OK") {
      this.logger.error("Failed to execute workflow", {
        workflowId: foundWorkflow.id,
        workflowName,
        error: execResponse.status?.message,
        correlationId,
      });
      throw new Error(execResponse.status?.message || "Failed to trigger workflow");
    }

    this.logger.info("Workflow triggered successfully", {
      workflowId: foundWorkflow.id,
      workflowName,
      executionId: execResponse.executionId,
      correlationId,
      async: execResponse.async,
    });

    return {
      executionId: execResponse.executionId,
      status: execResponse.async ? "running" : "completed",
      message: execResponse.async ? "Workflow started successfully" : "Workflow completed",
    };
  }

  /**
   * Get workflow execution status for displaying in the UI.
   */
  async getWorkflowStatus(executionId: string): Promise<{
    id: string;
    workflowId: string;
    workflowName: string;
    status: string;
    progress: number; // 0-100
    startedAt: string;
    completedAt?: string;
    error?: string;
    steps: Array<{
      name: string;
      status: string;
      startedAt?: string;
      completedAt?: string;
    }>;
  }> {
    this.logger.debug("Getting workflow status", { executionId });
    const req: workflow.GetWorkflowExecutionRequest = {
      id: executionId,
    };
    const response = await this.db.getWorkflowExecution(req);
    if (response.status?.code !== "OK") {
      this.logger.error("Failed to get workflow execution", {
        executionId,
        error: response.status?.message,
      });
      throw new Error(response.status?.message || "Failed to get workflow status");
    }
    if (!response.execution) {
      this.logger.warn("Workflow execution not found", { executionId });
      throw new Error("Workflow execution not found");
    }

    const exec = response.execution;

    // Get workflow name
    const workflowReq: workflow.GetWorkflowRequest = {
      id: exec.workflowId,
    };
    const workflowResponse = await this.db.getWorkflow(workflowReq);
    const workflowName = workflowResponse.workflow?.name || "Unknown";

    // Calculate progress based on steps
    const steps = exec.steps || [];
    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const progress = steps.length > 0 ? (completedSteps / steps.length) * 100 : 0;

    return {
      id: exec.id,
      workflowId: exec.workflowId,
      workflowName,
      status: exec.status,
      progress: Math.round(progress),
      startedAt: exec.startedAt
        ? new Date(Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000).toISOString()
        : "",
      completedAt: exec.completedAt
        ? new Date(Number(exec.completedAt.seconds) * 1000 + exec.completedAt.nanos / 1000000).toISOString()
        : undefined,
      error: exec.error || undefined,
      steps: steps.map((step) => ({
        name: step.name,
        status: step.status,
        startedAt: step.startedAt
          ? new Date(Number(step.startedAt.seconds) * 1000 + step.startedAt.nanos / 1000000).toISOString()
          : undefined,
        completedAt: step.completedAt
          ? new Date(Number(step.completedAt.seconds) * 1000 + step.completedAt.nanos / 1000000).toISOString()
          : undefined,
      })),
    };
  }

  /**
   * Get workflow execution history for a user or workflow.
   */
  async getWorkflowHistory(options: {
    workflowName?: string;
    userId?: string;
    status?: string;
    limit?: number;
  }): Promise<{
    executions: Array<{
      id: string;
      workflowName: string;
      status: string;
      startedAt: string;
      completedAt?: string;
      startedBy: string;
    }>;
  }> {
    const applicationId = await this.ensureApplicationId();
    let workflowId: string | undefined;
    if (options.workflowName) {
      const workflowsReq: workflow.ListWorkflowsRequest = {
        applicationId,
        includeDisabled: false,
        page: 1,
        pageSize: 1000,
        sortBy: "name",
        sortDesc: false,
      };
      const workflowsResponse = await this.db.listWorkflows(workflowsReq);
      const foundWorkflow = workflowsResponse.workflows?.find(
        (wf) => wf.name.toLowerCase() === options.workflowName?.toLowerCase()
      );
      workflowId = foundWorkflow?.id;
    }

    const req: workflow.ListWorkflowExecutionsRequest = {
      workflowId: workflowId || "",
      applicationId,
      status: options.status || "",
      startedBy: options.userId || "",
      from: protoscript.Timestamp.initialize(),
      to: protoscript.Timestamp.initialize(),
      page: 1,
      pageSize: options.limit || 50,
      sortBy: "startedAt",
      sortDesc: true,
    };
    const response = await this.db.listWorkflowExecutions(req);
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to get workflow history");
    }

    // Get workflow names for each execution
    const executionsWithNames = await Promise.all(
      (response.executions || []).map(async (exec) => {
        const workflowReq: workflow.GetWorkflowRequest = {
          id: exec.workflowId,
        };
        const workflowResponse = await this.db.getWorkflow(workflowReq);
        const workflowName = workflowResponse.workflow?.name || "Unknown";

        return {
          id: exec.id,
          workflowName,
          status: exec.status,
          startedAt: exec.startedAt
            ? new Date(Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000).toISOString()
            : "",
          completedAt: exec.completedAt
            ? new Date(Number(exec.completedAt.seconds) * 1000 + exec.completedAt.nanos / 1000000).toISOString()
            : undefined,
          startedBy: exec.startedBy,
        };
      })
    );

    return { executions: executionsWithNames };
  }

  /**
   * Cancel a running workflow execution.
   */
  async cancelWorkflow(executionId: string, reason?: string): Promise<void> {
    this.logger.info("Cancelling workflow", { executionId, reason });
    const req: workflow.CancelWorkflowExecutionRequest = {
      id: executionId,
      reason: reason || "Cancelled by user",
    };
    const response = await this.db.cancelWorkflowExecution(req);
    if (response.code !== "OK") {
      this.logger.error("Failed to cancel workflow", {
        executionId,
        error: response.message,
      });
      throw new Error(response.message || "Failed to cancel workflow");
    }
    this.logger.info("Workflow cancelled successfully", { executionId });
  }

  // ==================== Commands ====================

  /**
   * Get available commands for a user.
   * Returns commands that the user can execute, with their current state.
   * @param _username - Optional username (reserved for future permission checks)
   */
  /**
   * List every chat command for the current application. Used by the
   * background sync to reconcile Convex's chatCommands mirror against
   * the engine's authoritative state.
   *
   * Distinct from `getAvailableCommands`, which exists to filter by what
   * a particular user is permitted to run — that's a different semantic.
   */
  async listCommands(): Promise<CommandSnapshot[]> {
    const applicationId = await this.ensureApplicationId();
    const response = await this.db.listCommands({
      applicationId,
      includeDisabled: true,
    });
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to list commands");
    }
    return (response.commands ?? []).map((c) => commandToSnapshot(c));
  }

  async getAvailableCommands(_username?: string): Promise<{
    commands: Array<{
      id: string;
      name: string;
      type: string;
      cooldown: number;
      enabled: boolean;
    }>;
  }> {
    this.logger.info("Getting available commands", { username: _username });
    const applicationId = await this.ensureApplicationId();
    const req: command.ListCommandsRequest = {
      applicationId,
      includeDisabled: false,
    };
    const response = await this.db.listCommands(req);
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to get commands");
    }

    return {
      commands: (response.commands || []).map((cmd) => ({
        id: cmd.id,
        name: cmd.command,
        type: cmd.type,
        cooldown: cmd.cooldown,
        enabled: cmd.enabled,
      })),
    };
  }

  /**
   * Execute a command by name.
   * This would typically trigger the command execution via events.
   */
  async executeCommand(
    commandName: string,
    username: string,
    args: Record<string, string> = {}
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.info("Executing command", { commandName, username, args: Object.keys(args) });
    const applicationId = await this.ensureApplicationId();
    // Get the command
    const cmdReq: command.GetCommandRequest = {
      command: commandName,
      applicationId,
      username,
    };
    const cmdResponse = await this.db.getCommand(cmdReq);
    if (cmdResponse.status?.code !== "OK" || !cmdResponse.command) {
      throw new Error("Command not found");
    }

    if (!cmdResponse.command.enabled) {
      throw new Error("Command is disabled");
    }

    // Publish an event to trigger the command execution
    await this.publishEvent("command.execute", {
      command: commandName,
      username,
      args,
      applicationId,
    });

    this.logger.info("Command executed", { commandName, username });
    return {
      success: true,
      message: `Command "${commandName}" executed`,
    };
  }

  /**
   * Create a chat command. Persists via dbproxy and broadcasts a
   * `command.created` cloudevent so consumers (e.g. woofwoofwoof) refresh
   * their in-memory command list without restarting.
   */
  async createCommand(input: CreateCommandInput): Promise<CommandSnapshot> {
    const applicationId = await this.ensureApplicationId();

    const response = await this.db.createCommand({
      applicationId,
      command: input.command,
      enabled: input.enabled,
      cooldown: input.cooldown,
      type: input.type,
      typeValue: input.typeValue,
      priority: input.priority ?? 0,
      createdBy: "",
      createdByType: "USER",
      createdByRef: "",
    });
    if (response.status?.code !== "OK" || !response.command) {
      throw new Error(response.status?.message || "Failed to create command");
    }

    const snapshot = commandToSnapshot(response.command);
    await this.publishEvent("command.created", { command: snapshot });
    this.logger.info("Command created", { id: snapshot.id, command: snapshot.command });
    return snapshot;
  }

  /**
   * Update a chat command. Full-replace: every field on UpdateCommandInput
   * overwrites the stored row. Emits `command.updated` on success.
   */
  async updateCommand(id: string, input: UpdateCommandInput): Promise<CommandSnapshot> {
    const response = await this.db.updateCommand({
      id,
      command: input.command,
      enabled: input.enabled,
      cooldown: input.cooldown,
      type: input.type,
      typeValue: input.typeValue,
      priority: input.priority,
    });
    if (response.status?.code !== "OK" || !response.command) {
      throw new Error(response.status?.message || "Failed to update command");
    }

    const snapshot = commandToSnapshot(response.command);
    await this.publishEvent("command.updated", { command: snapshot });
    this.logger.info("Command updated", { id: snapshot.id, command: snapshot.command });
    return snapshot;
  }

  /**
   * Persist the broadcaster's Twitch OAuth token in the engine's
   * settings table. The Twitch service reads this on bootstrap (see
   * `shared/clients/typescript/twitch/index.ts:88`).
   *
   * `convexUserId` (when supplied) is the Convex user that initiated the
   * connect flow; we resolve it to the engine-side user UUID via the
   * same `findOrCreateByWoofx3UIUserId` path registerClient uses, then
   * write that UUID to `settings.user_id` so the row is scoped to the
   * owning user. The Twitch broadcaster id stays inside the JSON value
   * because that's what Twurple's `addUserForToken` parses out of
   * `AccessTokenWithUserId` on bootstrap.
   *
   * applicationId is intentionally `""` to match the existing bootstrap
   * read; per-app scoping is the correct long-term shape but the
   * bootstrap consumer hasn't been updated yet.
   */
  async setTwitchToken(
    token: {
      accessToken: string;
      refreshToken: string;
      scope: string[];
      expiresIn: number;
      obtainmentTimestamp: number;
      userId: string;
    },
    convexUserId?: string
  ): Promise<{ ok: true }> {
    let engineUserId: string | undefined;
    if (convexUserId) {
      const engineUser = await this.db.findOrCreateByWoofx3UIUserId(convexUserId);
      engineUserId = engineUser.id;
    }

    const response = await this.db.setSetting(
      "twitch_token",
      JSON.stringify(token),
      "",
      engineUserId
    );
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to set twitch_token");
    }
    this.logger.info("Twitch token written to settings", {
      twitchUserId: token.userId,
      engineUserId: engineUserId ?? "(unscoped)",
    });

    // Notify in-process consumers (woofwoofwoof, future bots) that the
    // integration token was rewritten so they can reload their
    // RefreshingAuthProvider and pick up new scopes without a service
    // restart. Best-effort — the row is already persisted, so a missed
    // event just means a delayed pickup.
    try {
      await this.publishEvent("setting.integration.token.updated", {
        integration: "twitch",
      });
    } catch (err) {
      this.logger.warn("Failed to publish setting.integration.token.updated", { err });
    }

    return { ok: true };
  }

  /**
   * Clear the broadcaster's Twitch OAuth token. Used by the UI's
   * "Disconnect Twitch" flow. Writes an empty string rather than
   * deleting the row so the bootstrap's `if (!token)` check trips
   * cleanly without needing to handle a missing row.
   */
  async deleteTwitchToken(): Promise<{ ok: true }> {
    const response = await this.db.setSetting("twitch_token", "", "");
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to clear twitch_token");
    }
    this.logger.info("Twitch token cleared from settings");

    // Same notification as setTwitchToken — the row changed, downstream
    // consumers should re-read. Their reload path will see an empty
    // setting and back off (twitchBootstrap already throws on empty).
    try {
      await this.publishEvent("setting.integration.token.updated", {
        integration: "twitch",
      });
    } catch (err) {
      this.logger.warn("Failed to publish setting.integration.token.updated", { err });
    }

    return { ok: true };
  }

  /**
   * Aggregate every function exposed by every installed module. Used by
   * the UI to populate the function-type chat command dropdown.
   * `qualifiedName` matches barkloader's ModuleRegistry lookup path
   * (`module/function`), which is also what command rows persist as
   * `typeValue`.
   */
  async listAvailableFunctions(): Promise<AvailableFunction[]> {
    const modules = await this.db.listModules();
    const out: AvailableFunction[] = [];
    for (const m of modules) {
      const moduleName = m.name ?? "";
      const moduleId = m.id ?? "";
      for (const fn of m.functions ?? []) {
        if (!fn.manifestId) {
          continue;
        }
        out.push({
          id: fn.id,
          moduleId,
          moduleName,
          manifestId: fn.manifestId,
          name: fn.name ?? "",
          qualifiedName: moduleName ? `${moduleName}/${fn.manifestId}` : fn.manifestId,
          runtime: fn.runtime ?? "",
        });
      }
    }
    return out;
  }

  /**
   * Delete a chat command. Emits `command.deleted` with just the id —
   * downstream consumers maintain their own id→name index from
   * created/updated events.
   */
  async deleteCommand(id: string): Promise<{ deleted: boolean }> {
    const status = await this.db.deleteCommand({ id });
    if (status.code !== "OK") {
      throw new Error(status.message || "Failed to delete command");
    }

    await this.publishEvent("command.deleted", { id });
    this.logger.info("Command deleted", { id });
    return { deleted: true };
  }

  // ==================== Generic UI lookups ====================

  /**
   * Generic dynamic-options dispatch. Convex actions call this when a UI
   * field's manifest descriptor declares `kind: "internal"`. Fire-and-
   * forget on the engine side: we publish a NATS request and return
   * immediately. The reply (whenever it arrives, or a timeout) is
   * forwarded back to Convex as `engine.response.received` carrying the
   * correlationKey. Convex matches that to the originating
   * `transientEvents` row, and the UI's reactive subscription wakes up.
   *
   * Workers reply with the standard NATS pattern: `msg.respond(data)`.
   * No special envelope; the NATS client handles inbox routing.
   */
  async dispatchFieldOptionsRequest(
    descriptor: FieldOptionsDescriptor,
    correlationKey: string
  ): Promise<{ dispatched: boolean }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    if (descriptor.kind !== "internal") {
      throw new Error(`Unsupported descriptor kind: ${descriptor.kind}`);
    }

    const eventId = crypto.randomUUID();
    const requestEnvelope = {
      id: eventId,
      type: descriptor.request.event,
      source: "api",
      time: new Date().toISOString(),
      data: descriptor.request.payload ?? {},
    };
    const requestBytes = new TextEncoder().encode(JSON.stringify(requestEnvelope));
    const timeout = descriptor.timeoutMs ?? 10_000;
    const nats = this.nats;

    this.logger.info("dispatchFieldOptionsRequest dispatching", {
      correlationKey,
      subject: descriptor.request.event,
      payload: descriptor.request.payload,
      timeoutMs: timeout,
    });

    // `no responders` is NATS's immediate "zero subscribers on this
    // subject right now" reply — common in dev when a worker is still
    // booting (Twurple + EventSub setup, etc.) at the moment the user
    // opens a dropdown. Retry on `no responders` only — other errors
    // (timeout from a slow handler, malformed reply, etc.) propagate
    // immediately so we don't paper over real bugs.
    const requestWithBootRetry = async (): Promise<{ data: Uint8Array }> => {
      const backoffsMs = [250, 500, 1000, 2000];
      let lastError: unknown;
      for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
        try {
          return await nats.request(descriptor.request.event, requestBytes, { timeout });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("no responders")) {
            throw err;
          }
          lastError = err;
          if (attempt === backoffsMs.length) {
            break;
          }
          const delay = backoffsMs[attempt];
          this.logger.info("dispatchFieldOptionsRequest no responders, retrying", {
            correlationKey,
            subject: descriptor.request.event,
            attempt: attempt + 1,
            nextDelayMs: delay,
          });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    // Fire-and-forget: kick off the request, route the reply (or error)
    // through the webhook back to Convex without holding this RPC open.
    requestWithBootRetry()
      .then(async (reply) => {
        const text = new TextDecoder().decode(reply.data);
        let data: unknown;
        try {
          const parsed = JSON.parse(text);
          // Workers may reply with a CloudEvent envelope ({type, data, ...})
          // or raw data. Prefer envelope.data when present.
          data =
            parsed && typeof parsed === "object" && "data" in parsed
              ? (parsed as { data: unknown }).data
              : parsed;
        } catch {
          data = text;
        }

        // Result-shape summary mirrors the twitch worker side so the
        // request and response sides line up in the logs. An empty array
        // here usually means the worker ran fine and just returned []
        // (e.g. broadcaster has no manageable rewards) — distinct from
        // the .catch path which means the request never got a reply.
        let dataSummary: string;
        if (Array.isArray(data)) {
          dataSummary = `array(len=${data.length})${
            data.length > 0 ? ` first=${JSON.stringify(data[0]).slice(0, 200)}` : ""
          }`;
        } else if (data === null || data === undefined) {
          dataSummary = String(data);
        } else if (typeof data === "object") {
          dataSummary = `object keys=[${Object.keys(data as Record<string, unknown>).join(", ")}]`;
        } else {
          dataSummary = `${typeof data} ${JSON.stringify(data).slice(0, 200)}`;
        }
        this.logger.info("dispatchFieldOptionsRequest reply received", {
          correlationKey,
          subject: descriptor.request.event,
          dataSummary,
          willForward: !!this.webhookClient,
        });

        if (this.webhookClient) {
          await this.webhookClient.send({
            type: EngineEventType.ENGINE_RESPONSE_RECEIVED,
            correlationKey,
            status: "success",
            data,
          });
        }
      })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn("dispatchFieldOptionsRequest reply failed", {
          correlationKey,
          subject: descriptor.request.event,
          error: message,
        });
        if (this.webhookClient) {
          await this.webhookClient.send({
            type: EngineEventType.ENGINE_RESPONSE_RECEIVED,
            correlationKey,
            status: "error",
            error: message,
          });
        }
      });

    return { dispatched: true };
  }

  // ==================== User Actions ====================

  /**
   * Get user profile and stats for display in the UI.
   */
  async getUserProfile(userId: string): Promise<{
    id: string;
    username: string;
    treats: {
      total: number;
      points: number;
    };
    stats?: Record<string, unknown>;
  }> {
    // Get user
    const userReq: user.GetUserRequest = {
      id: userId,
    };
    const userResponse = await this.db.getUser(userReq);
    if (userResponse.status?.code !== "OK" || !userResponse.user) {
      throw new Error("User not found");
    }

    // Get treats summary (last 30 days)
    const applicationId = await this.ensureApplicationId();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const treatsReq: treat.GetUserTreatsSummaryRequest = {
      userId,
      applicationId,
      fromDate: timestampFromDate(thirtyDaysAgo),
      toDate: timestampFromDate(now),
    };
    const treatsResponse = await this.db.getUserTreatsSummary(treatsReq);
    const treatsSummary = treatsResponse.summary;

    return {
      id: userResponse.user.id,
      username: userResponse.user.username,
      treats: {
        total: treatsSummary?.totalTreats || 0,
        points: treatsSummary?.totalPoints || 0,
      },
    };
  }

  /**
   * Award treats to a user (UI action).
   */
  async awardTreatsToUser(
    userId: string,
    treatType: string,
    title: string,
    description: string,
    points: number,
    awardedBy: string,
    imageUrl: string = "",
    expiresInDays?: number
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const expiresAt = expiresInDays
      ? timestampFromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000))
      : protoscript.Timestamp.initialize();

    const applicationId = await this.ensureApplicationId();
    const req: treat.AwardTreatRequest = {
      userId,
      treatType,
      title,
      description,
      points,
      imageUrl,
      awardedBy,
      applicationId,
      metadata: {},
      expiresAt,
    };
    const response = await this.db.awardTreat(req);
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to award treat");
    }

    return {
      success: true,
      message: `Awarded treat "${title}" to user`,
    };
  }

  // ==================== Events ====================

  /**
   * Simulate a Twitch event for testing workflows.
   * This is useful for the UI to manually trigger workflows that respond to Twitch events.
   */
  async simulateTwitchEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.info("Simulating Twitch event", { eventType, eventData });
    const subject = `twitch.${eventType}`;
    await this.publishEvent(`twitch.${eventType}`, eventData, subject);

    this.logger.info("Twitch event simulated successfully", { eventType, subject });
    return {
      success: true,
      message: `Simulated Twitch event: ${eventType}`,
    };
  }

  /**
   * Trigger a workflow by publishing an event.
   * Useful for triggering workflows that listen to specific event types.
   */
  async triggerEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.publishEvent(eventType, eventData);

    return {
      success: true,
      message: `Published event: ${eventType}`,
    };
  }

  // ==================== Dashboard/Overview ====================

  /**
   * Get system overview for the dashboard.
   */
  async getDashboard(): Promise<{
    workflows: {
      total: number;
      enabled: number;
      running: number;
    };
    recentActivity: Array<{
      type: string;
      message: string;
      timestamp: string;
    }>;
  }> {
    // Get workflow stats
    const applicationId = await this.ensureApplicationId();
    const workflowsReq: workflow.ListWorkflowsRequest = {
      applicationId,
      includeDisabled: true,
      page: 1,
      pageSize: 1000,
      sortBy: "name",
      sortDesc: false,
    };
    const workflowsResponse = await this.db.listWorkflows(workflowsReq);
    const workflows = workflowsResponse.workflows || [];

    // Get running executions
    const runningExecReq: workflow.ListWorkflowExecutionsRequest = {
      workflowId: "",
      applicationId,
      status: "running",
      startedBy: "",
      from: protoscript.Timestamp.initialize(),
      to: protoscript.Timestamp.initialize(),
      page: 1,
      pageSize: 100,
      sortBy: "startedAt",
      sortDesc: true,
    };
    const runningExecResponse = await this.db.listWorkflowExecutions(runningExecReq);
    const runningCount = runningExecResponse.executions?.length || 0;

    return {
      workflows: {
        total: workflows.length,
        enabled: workflows.filter((w) => w.enabled).length,
        running: runningCount,
      },
      recentActivity: [], // Could be populated from event history
    };
  }

  // ==================== Users & Teams ====================

  private currentUser = {
    id: "user-1",
    email: "streamer@example.com",
    displayName: "ProStreamer",
    role: "owner",
    teamIds: ["team-1", "team-2"],
    accountIds: ["account-1", "account-2", "account-3"],
    createdAt: "2024-01-01T00:00:00Z",
  };

  async getUser(): Promise<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    teamIds: string[];
    accountIds: string[];
    createdAt: string;
  }> {
    return { ...this.currentUser };
  }

  async updateUser(input: { displayName?: string; email?: string }): Promise<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    teamIds: string[];
    accountIds: string[];
    createdAt: string;
  }> {
    if (input.displayName !== undefined) this.currentUser.displayName = input.displayName;
    if (input.email !== undefined) this.currentUser.email = input.email;
    return { ...this.currentUser };
  }

  private teams = [
    {
      id: "team-1",
      name: "Main Stream Team",
      slug: "main-stream",
      ownerId: "user-1",
      createdAt: "2024-01-15T00:00:00Z",
    },
    { id: "team-2", name: "Collab Squad", slug: "collab-squad", ownerId: "user-1", createdAt: "2024-06-01T00:00:00Z" },
  ];

  async getTeams(): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      ownerId: string;
      createdAt: string;
    }>
  > {
    return [...this.teams];
  }

  async getTeam(id: string): Promise<{
    id: string;
    name: string;
    slug: string;
    ownerId: string;
    createdAt: string;
  } | null> {
    return this.teams.find((t) => t.id === id) || null;
  }

  async getTeamMembers(teamId: string): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      status: string;
      joinedAt: string;
      avatarUrl: string;
    }>
  > {
    return [
      {
        id: "member-1",
        name: "ProStreamer",
        email: "streamer@example.com",
        role: "owner",
        status: "active",
        joinedAt: "2024-01-15T00:00:00Z",
        avatarUrl: "",
      },
      {
        id: "member-2",
        name: "ModMaster",
        email: "mod@example.com",
        role: "admin",
        status: "active",
        joinedAt: "2024-02-01T00:00:00Z",
        avatarUrl: "",
      },
      {
        id: "member-3",
        name: "NewHelper",
        email: "helper@example.com",
        role: "member",
        status: "invited",
        joinedAt: "2024-12-01T00:00:00Z",
        avatarUrl: "",
      },
    ];
  }

  // ==================== Accounts ====================

  private accounts = [
    {
      id: "account-1",
      name: "MainTwitch",
      displayName: "WoofyStream",
      slug: "woofy-stream",
      platform: "twitch",
      teamId: "team-1",
      status: "connected",
      createdAt: "2024-01-15T00:00:00Z",
    },
    {
      id: "account-2",
      name: "YouTubeGaming",
      displayName: "Woofy Gaming",
      slug: "woofy-gaming",
      platform: "youtube",
      teamId: "team-1",
      status: "connected",
      createdAt: "2024-03-01T00:00:00Z",
    },
    {
      id: "account-3",
      name: "CollabTwitch",
      displayName: "Collab Stream",
      slug: "collab-stream",
      platform: "twitch",
      teamId: "team-2",
      status: "connected",
      createdAt: "2024-06-15T00:00:00Z",
    },
  ];

  async getAccounts(teamId?: string): Promise<
    Array<{
      id: string;
      name: string;
      displayName: string;
      slug: string;
      platform: string;
      teamId: string;
      status: string;
      createdAt: string;
    }>
  > {
    const filtered = teamId ? this.accounts.filter((a) => a.teamId === teamId) : this.accounts;
    return filtered.map((a) => ({ ...a }));
  }

  async getAccount(id: string): Promise<{
    id: string;
    name: string;
    displayName: string;
    slug: string;
    platform: string;
    teamId: string;
    status: string;
    createdAt: string;
  } | null> {
    const account = this.accounts.find((a) => a.id === id);
    return account ? { ...account } : null;
  }

  async updateAccount(
    id: string,
    input: { name?: string; displayName?: string }
  ): Promise<{
    id: string;
    name: string;
    displayName: string;
    slug: string;
    platform: string;
    teamId: string;
    status: string;
    createdAt: string;
  } | null> {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) return null;
    if (input.name !== undefined) account.name = input.name;
    if (input.displayName !== undefined) account.displayName = input.displayName;
    return { ...account };
  }

  /**
   * Resolve the broadcaster's live stream state by calling Twitch
   * Helix `GET /helix/streams` with the OAuth token stored in the
   * `twitch_token` setting (same source `twitchBootstrap.ts` reads).
   *
   * `accountId` is accepted for backward compatibility with the legacy
   * mock signature but is currently unused — the engine is
   * single-broadcaster-per-deployment, so the bootstrapped Twitch user
   * is the only one to query. Per-application platform-link resolution
   * lands when the engine grows true multi-application support.
   *
   * Returns `{ isLive: false, uptime: "00:00:00", viewerCount: 0 }`
   * on any error so the UI never sees an exception just because the
   * stream is offline or the token is briefly stale — the polling
   * cron retries every minute.
   */
  async getStreamStatus(_accountId: string): Promise<{
    isLive: boolean;
    uptime: string;
    viewerCount: number;
    startedAt?: string;
    streamTitle?: string;
    gameName?: string;
    twitchUserId?: string;
  }> {
    const offline = { isLive: false as const, uptime: "00:00:00", viewerCount: 0 };

    const clientId = process.env.TWITCH_WOLFY_CLIENT_ID;
    if (!clientId) {
      this.logger.warn("getStreamStatus: TWITCH_WOLFY_CLIENT_ID not set");
      return offline;
    }

    let token: { accessToken?: string; userId?: string };
    try {
      const raw = await this.db.getSetting("twitch_token", "");
      if (!raw) {
        return offline;
      }
      token = JSON.parse(raw);
    } catch (err) {
      this.logger.warn("getStreamStatus: failed to read twitch_token", {
        error: err instanceof Error ? err.message : String(err),
      });
      return offline;
    }

    if (!token.accessToken || !token.userId) {
      return offline;
    }

    let response: Response;
    try {
      response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(token.userId)}`, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Client-Id": clientId,
        },
      });
    } catch (err) {
      this.logger.warn("getStreamStatus: helix fetch failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return offline;
    }

    if (!response.ok) {
      this.logger.warn("getStreamStatus: helix non-2xx", { status: response.status });
      return offline;
    }

    const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const stream = body.data?.[0];
    if (!stream) {
      // Empty array == offline (Twitch Helix contract).
      return { ...offline, twitchUserId: token.userId };
    }

    const startedAt = typeof stream.started_at === "string" ? stream.started_at : new Date().toISOString();
    const startedAtMs = Date.parse(startedAt);
    const elapsedSec = Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : 0;
    const hh = Math.floor(elapsedSec / 3600);
    const mm = Math.floor((elapsedSec % 3600) / 60);
    const ss = elapsedSec % 60;
    const uptime = [hh, mm, ss].map((n) => n.toString().padStart(2, "0")).join(":");

    return {
      isLive: true,
      uptime,
      viewerCount: typeof stream.viewer_count === "number" ? stream.viewer_count : 0,
      startedAt,
      streamTitle: typeof stream.title === "string" ? stream.title : undefined,
      gameName: typeof stream.game_name === "string" ? stream.game_name : undefined,
      twitchUserId: token.userId,
    };
  }

  // ==================== Modules ====================

  private getBarkloaderBaseUrl(): string {
    return this.barkloaderUrl.endsWith("/") ? this.barkloaderUrl.slice(0, -1) : this.barkloaderUrl;
  }

  private async barkloaderRequest(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.getBarkloaderBaseUrl()}${path}`, init);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Barkloader request failed (${response.status} ${response.statusText}): ${body || "empty body"}`);
    }
    return response;
  }

  async installModuleZip(
    fileName: string,
    zipBase64: string,
    context: { clientId: string; moduleKey?: string }
  ): Promise<{ success: boolean; message?: string; alreadyInstalled?: boolean }> {
    const clientId = context?.clientId;
    const moduleKey = context?.moduleKey;

    if (!clientId) {
      throw new Error("clientId is required to install a module");
    }

    this.logger.info("Installing module zip", { fileName, size: zipBase64.length, clientId, moduleKey });

    // Duplicate check: if the caller supplied a module_key, look it up first
    if (moduleKey) {
      const existing = await this.db.getModuleByModuleKey(moduleKey);
      if (existing) {
        this.logger.info("Module already installed, skipping upload", {
          clientId,
          moduleKey,
          moduleName: existing.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(
            {
              type: "module.installed",
              moduleName: existing.name,
              version: existing.version,
              moduleKey,
              alreadyInstalled: true,
            },
            clientId || undefined
          );
        }
        return { success: true, message: "Module already installed", alreadyInstalled: true };
      }
    }

    const zipBytes = Buffer.from(zipBase64, "base64");
    const formData = new FormData();
    formData.append("file", new File([zipBytes], fileName, { type: "application/zip" }));
    formData.append("client_id", clientId);
    if (moduleKey) {
      formData.append("module_key", moduleKey);
    }

    const response = await this.barkloaderRequest("/functions", {
      method: "POST",
      body: formData,
    });
    const json = (await response.json()) as { message?: string };
    this.logger.info("Module zip installed", { clientId, moduleKey, fileName, message: json.message });
    return { success: true, message: json.message ?? "Module uploaded" };
  }

  async listEngineModules(): Promise<Array<{ name: string; version: string; state: string }>> {
    this.logger.info("Listing engine modules");
    const modules = await this.db.listModules();
    const result = modules
      .filter((m) => !!m.name)
      .map((m) => ({
        name: m.name,
        version: m.version ?? "",
        state: m.state ?? "active",
      }));
    this.logger.info("Listed engine modules", { count: result.length });
    return result;
  }

  async uninstallEngineModule(
    name: string,
    context?: { clientId?: string; moduleKey?: string }
  ): Promise<UninstallModuleResponse> {
    const clientId = context?.clientId;
    const moduleKey = context?.moduleKey;
    this.logger.info("Requesting engine module uninstall", { name, clientId, moduleKey });
    const params = new URLSearchParams();
    if (clientId) params.set("client_id", clientId);
    if (moduleKey) params.set("module_key", moduleKey);
    const qs = params.toString() ? `?${params.toString()}` : "";
    await this.barkloaderRequest(`/functions/${encodeURIComponent(name)}${qs}`, { method: "DELETE" });
    this.logger.info("Engine module uninstall request acknowledged", { name, clientId, moduleKey });
    // Success/failure is delivered asynchronously via webhook
    // (module.deleted or module.delete_failed), both carrying moduleKey.
    return { requested: true };
  }

  async getModules(query?: {
    category?: string;
    search?: string;
    installed?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{
    modules: Array<{
      id: string;
      name: string;
      description: string;
      version: string;
      author: string;
      isInstalled: boolean;
      iconUrl: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    this.logger.info("Getting modules", { query });
    const dbModules = await this.db.listModules();
    this.logger.info("Got modules", { count: dbModules.length });
    const normalized = dbModules
      .filter((m) => !!m.name)
      .map((m) => {
        const { author, category } = readModuleCatalogFields(m.manifest);
        return {
          id: m.name,
          name: m.name,
          description: "",
          category,
          version: m.version ?? "",
          author,
          isInstalled: true,
          iconUrl: "",
        };
      });
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 8;
    return {
      modules: normalized.slice((page - 1) * pageSize, page * pageSize),
      total: normalized.length,
      page,
      pageSize,
    };
  }

  async getModule(id: string): Promise<{
    id: string;
    name: string;
    description: string;
    category: string;
    version: string;
    author: string;
    isInstalled: boolean;
    iconUrl: string;
  } | null> {
    const found = await this.db.getModuleByName(id);
    if (!found) return null;
    const { author, category } = readModuleCatalogFields(found.manifest);
    return {
      id: found.name,
      name: found.name,
      description: "",
      category,
      version: found.version,
      author,
      isInstalled: true,
      iconUrl: "",
    };
  }

  /**
   * Uninstall a module by its composite moduleKey
   * (`{moduleId}:{version}:{hash}`). moduleKey is the only stable
   * cross-version identifier the engine has — name + version isn't
   * unique across re-installs, and barkloader's filesystem identifier
   * shifts as the module's archive name changes. Resolving via
   * moduleKey here means the UI can stop guessing at engine-internal
   * names and pass the same moduleKey it stores in the catalog.
   *
   * `context.moduleKey` is preserved on the way to barkloader so the
   * eventual `module.deleted` / `module.delete_failed` webhook can be
   * correlated with the originating uninstall request.
   */
  async uninstallModule(
    moduleKey: string,
    context?: { clientId?: string }
  ): Promise<UninstallModuleResponse> {
    if (!moduleKey) {
      throw new Error("uninstallModule: moduleKey is required");
    }
    const found = await this.db.getModuleByModuleKey(moduleKey);
    if (!found) {
      throw new Error(`uninstallModule: no module found for moduleKey "${moduleKey}"`);
    }
    return this.uninstallEngineModule(found.name, {
      ...(context ?? {}),
      moduleKey,
    });
  }

  // ==================== Workflows (Extended) ====================

  private workflowToItem(wf: {
    id?: string;
    name?: string;
    description?: string;
    applicationId?: string;
    enabled?: boolean;
    stepsJson?: string;
    triggerJson?: string;
    createdAt?: { seconds?: bigint; nanos?: number };
    updatedAt?: { seconds?: bigint; nanos?: number };
  }): WorkflowItem {
    return {
      id: wf.id ?? "",
      name: wf.name ?? "",
      description: wf.description ?? "",
      accountId: wf.applicationId ?? "",
      isEnabled: wf.enabled ?? false,
      definition: rebuildWorkflowDefinition(wf),
      stats: { runsToday: 0, successRate: 100 },
      createdAt: timestampToIso(wf.createdAt),
      updatedAt: timestampToIso(wf.updatedAt),
    };
  }

  async getWorkflows(query?: { accountId?: string; enabled?: boolean; page?: number; pageSize?: number }): Promise<{
    workflows: WorkflowItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const applicationId = query?.accountId ?? (await this.ensureApplicationId());
    const response = await this.db.listWorkflows({
      applicationId,
      includeDisabled: query?.enabled === undefined ? true : !query.enabled,
      page,
      pageSize,
      sortBy: "",
      sortDesc: false,
    });
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to list workflows");
    }
    return {
      workflows: (response.workflows ?? []).map((wf) => this.workflowToItem(wf)),
      total: response.totalCount ?? 0,
      page: response.page ?? page,
      pageSize: response.pageSize ?? pageSize,
    };
  }

  async getWorkflow(id: string): Promise<WorkflowItem | null> {
    this.logger.info("Getting workflow", { id });
    const response = await this.db.getWorkflow({ id });
    if (response.status?.code !== "OK" || !response.workflow) {
      this.logger.warn("Workflow not found", { id });
      return null;
    }
    this.logger.info("Retrieved workflow", { id, name: response.workflow.name });
    return this.workflowToItem(response.workflow);
  }

  async createWorkflow(data: CreateWorkflowInput): Promise<WorkflowMutationResult> {
    // DB mints the id, so we can't validate with a stable id here. Run the
    // validation with a placeholder and then swap in the real id before
    // storing + emitting. All id references inside the definition (e.g.
    // dependsOn) refer to TASK ids, so the workflow id itself is inert.
    const placeholderId = "pending";
    const preValidation = validateWorkflowDefinition({ id: placeholderId, ...data.definition });
    if (!preValidation.ok) {
      throw new Error(
        `Invalid workflow definition: ${preValidation.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
      );
    }

    this.logger.info("Creating workflow", { name: data.definition.name });
    const applicationId = data.accountId || (await this.ensureApplicationId());

    // Steps and trigger are persisted as raw JSON; the engine reads
    // them directly off the workflow row. The definition's `id` is
    // assigned by the DB on insert, so the initial write uses a
    // placeholder id in the in-memory `storedDefinition`.
    const response = await this.db.createWorkflow({
      name: data.definition.name,
      description: data.definition.description ?? "",
      applicationId,
      createdBy: "",
      enabled: false,
      stepsJson: JSON.stringify(data.definition.tasks ?? []),
      triggerJson: JSON.stringify(data.definition.trigger),
      variables: {},
      onSuccess: "",
      onFailure: "",
      maxRetries: 0,
      timeoutSeconds: 0,
      createdByType: "USER",
      createdByRef: "",
    });
    if (response.status?.code !== "OK" || !response.workflow) {
      throw new Error(response.status?.message || "Failed to create workflow");
    }

    const createdId = response.workflow.id ?? "";
    const storedDefinition: WorkflowDefinition = { id: createdId, ...data.definition };

    this.logger.info("Created workflow", { id: createdId, name: storedDefinition.name });

    const createdAt = timestampToIso(response.workflow.createdAt);
    const updatedAt = timestampToIso(response.workflow.updatedAt);

    void this.emitWorkflowWebhook({
      type: EngineEventType.WORKFLOW_CREATED,
      applicationId,
      correlationKey: data.correlationKey,
      workflow: {
        id: createdId,
        definition: storedDefinition,
        isEnabled: false,
        createdAt,
        updatedAt,
      },
    });

    return { id: createdId, definition: storedDefinition, isEnabled: false };
  }

  async updateWorkflow(id: string, data: UpdateWorkflowInput): Promise<WorkflowMutationResult | null> {
    if (data.definition.id !== id) {
      throw new Error(`definition.id (${data.definition.id}) must match path id (${id})`);
    }
    const validation = validateWorkflowDefinition(data.definition);
    if (!validation.ok) {
      throw new Error(
        `Invalid workflow definition: ${validation.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
      );
    }

    this.logger.info("Updating workflow", { id });
    const existing = await this.db.getWorkflow({ id });
    if (existing.status?.code !== "OK" || !existing.workflow) {
      this.logger.warn("Workflow not found for update", { id });
      return null;
    }

    const response = await this.db.updateWorkflow({
      id,
      name: data.definition.name,
      description: data.definition.description ?? "",
      enabled: existing.workflow.enabled ?? false,
      stepsJson: JSON.stringify(data.definition.tasks ?? []),
      triggerJson: JSON.stringify(data.definition.trigger),
      variables: existing.workflow.variables ?? {},
      onSuccess: existing.workflow.onSuccess ?? "",
      onFailure: existing.workflow.onFailure ?? "",
      maxRetries: existing.workflow.maxRetries ?? 0,
      timeoutSeconds: existing.workflow.timeoutSeconds ?? 0,
    });
    if (response.status?.code !== "OK" || !response.workflow) {
      return null;
    }

    this.logger.info("Updated workflow", { id, name: response.workflow.name });

    const applicationId = await this.ensureApplicationId();
    const isEnabled = response.workflow.enabled ?? false;
    const createdAt = timestampToIso(existing.workflow.createdAt);
    const updatedAt = timestampToIso(response.workflow.updatedAt);

    void this.emitWorkflowWebhook({
      type: EngineEventType.WORKFLOW_UPDATED,
      applicationId,
      correlationKey: data.correlationKey,
      workflow: {
        id,
        definition: data.definition,
        isEnabled,
        createdAt,
        updatedAt,
      },
    });

    return { id, definition: data.definition, isEnabled };
  }

  async deleteWorkflow(id: string, correlationKey?: string): Promise<boolean> {
    const applicationId = await this.ensureApplicationId();
    this.logger.info("Deleting workflow", { id });
    const response = await this.db.deleteWorkflow({ id });
    const deleted = response.code === "OK";
    this.logger.info("Workflow deleted", { id, success: deleted });
    if (deleted) {
      void this.emitWorkflowWebhook({
        type: EngineEventType.WORKFLOW_DELETED,
        applicationId,
        correlationKey,
        workflowId: id,
      });
    }
    return deleted;
  }

  async setWorkflowEnabled(
    id: string,
    isEnabled: boolean,
    correlationKey?: string
  ): Promise<{ id: string; isEnabled: boolean }> {
    const existing = await this.db.getWorkflow({ id });
    if (existing.status?.code !== "OK" || !existing.workflow) {
      throw new Error("Workflow not found");
    }
    // Toggle enabled without rewriting the workflow definition —
    // pass the existing JSON columns through unchanged.
    const response = await this.db.updateWorkflow({
      id,
      name: existing.workflow.name ?? "",
      description: existing.workflow.description ?? "",
      enabled: isEnabled,
      stepsJson: existing.workflow.stepsJson ?? "",
      triggerJson: existing.workflow.triggerJson ?? "",
      variables: existing.workflow.variables ?? {},
      onSuccess: existing.workflow.onSuccess ?? "",
      onFailure: existing.workflow.onFailure ?? "",
      maxRetries: existing.workflow.maxRetries ?? 0,
      timeoutSeconds: existing.workflow.timeoutSeconds ?? 0,
    });
    if (response.status?.code !== "OK" || !response.workflow) {
      throw new Error("Failed to toggle workflow enabled state");
    }

    const applicationId = await this.ensureApplicationId();
    const definition = rebuildWorkflowDefinition(existing.workflow);
    if (definition) {
      const createdAt = timestampToIso(existing.workflow.createdAt);
      const updatedAt = timestampToIso(response.workflow.updatedAt);
      void this.emitWorkflowWebhook({
        type: EngineEventType.WORKFLOW_UPDATED,
        applicationId,
        correlationKey,
        workflow: {
          id,
          definition,
          isEnabled,
          createdAt,
          updatedAt,
        },
      });
    }

    return { id, isEnabled };
  }

  private async emitWorkflowWebhook(
    event: WorkflowCreatedEvent | WorkflowUpdatedEvent | WorkflowDeletedEvent
  ): Promise<void> {
    if (!this.webhookClient) {
      this.logger.warn("No webhook client set, skipping workflow webhook", { type: event.type });
      return;
    }
    try {
      await this.webhookClient.send(event);
    } catch (err) {
      this.logger.error("Failed to send workflow webhook", { type: event.type, err });
    }
  }

  private workflowRuns: Array<{
    id: string;
    workflowId: string;
    accountId: string;
    status: string;
    startedAt: string;
    duration: number;
    trigger: string;
  }> = [
    {
      id: "run-1",
      workflowId: "wf-1",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T04:30:00Z",
      duration: 1200,
      trigger: "follow",
    },
    {
      id: "run-2",
      workflowId: "wf-2",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T03:15:00Z",
      duration: 3500,
      trigger: "subscription",
    },
    {
      id: "run-3",
      workflowId: "wf-4",
      accountId: "account-1",
      status: "failed",
      startedAt: "2026-01-14T02:45:00Z",
      duration: 800,
      trigger: "cheer",
    },
    {
      id: "run-4",
      workflowId: "wf-1",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T01:00:00Z",
      duration: 950,
      trigger: "follow",
    },
    {
      id: "run-5",
      workflowId: "wf-6",
      accountId: "account-1",
      status: "running",
      startedAt: "2026-01-14T00:00:00Z",
      duration: 0,
      trigger: "stream.online",
    },
    {
      id: "run-6",
      workflowId: "wf-5",
      accountId: "account-2",
      status: "success",
      startedAt: "2026-01-13T22:30:00Z",
      duration: 450,
      trigger: "redemption",
    },
    {
      id: "run-7",
      workflowId: "wf-5",
      accountId: "account-2",
      status: "success",
      startedAt: "2026-01-13T21:00:00Z",
      duration: 380,
      trigger: "redemption",
    },
  ];

  async getWorkflowRuns(query?: { workflowId?: string; accountId?: string; limit?: number }): Promise<
    Array<{
      id: string;
      workflowId: string;
      workflowName: string;
      status: string;
      startedAt: string;
      duration: number;
      trigger: string;
    }>
  > {
    const applicationId = await this.ensureApplicationId();
    const req: workflow.ListWorkflowExecutionsRequest = {
      workflowId: query?.workflowId || "",
      applicationId,
      status: "",
      startedBy: "",
      from: protoscript.Timestamp.initialize(),
      to: protoscript.Timestamp.initialize(),
      page: 1,
      pageSize: query?.limit || 10,
      sortBy: "startedAt",
      sortDesc: true,
    };

    const response = await this.db.listWorkflowExecutions(req);
    if (response.status?.code !== "OK") {
      // Fall back to empty array on error
      return [];
    }

    // Get workflow names and calculate durations
    const runs = await Promise.all(
      (response.executions || []).map(async (exec) => {
        // Get workflow name
        const workflowReq: workflow.GetWorkflowRequest = {
          id: exec.workflowId,
        };
        const workflowResponse = await this.db.getWorkflow(workflowReq);
        const workflowName = workflowResponse.workflow?.name || "Unknown Workflow";

        // Calculate startedAt timestamp
        const startedAt = exec.startedAt
          ? new Date(Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000).toISOString()
          : "";

        // Calculate duration in ms
        let duration = 0;
        if (exec.startedAt && exec.completedAt) {
          const startMs = Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000;
          const endMs = Number(exec.completedAt.seconds) * 1000 + exec.completedAt.nanos / 1000000;
          duration = endMs - startMs;
        } else if (exec.startedAt) {
          // Still running - calculate from now
          const startMs = Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000;
          duration = Date.now() - startMs;
        }

        // Extract trigger from inputs metadata if available
        const trigger = (exec.inputs?.trigger as string) || "manual";

        return {
          id: exec.id,
          workflowId: exec.workflowId,
          workflowName,
          status: exec.status,
          startedAt,
          duration: Math.round(duration),
          trigger,
        };
      })
    );

    return runs;
  }

  // ==================== Assets ====================

  private mockAssets = [
    {
      id: "asset-1",
      name: "Follow Alert",
      type: "image",
      url: "/assets/follow.gif",
      accountId: "account-1",
      size: 256000,
      createdAt: "2024-06-01T00:00:00Z",
    },
    {
      id: "asset-2",
      name: "Sub Sound",
      type: "audio",
      url: "/assets/sub.mp3",
      accountId: "account-1",
      size: 512000,
      createdAt: "2024-06-15T00:00:00Z",
    },
    {
      id: "asset-3",
      name: "Raid Video",
      type: "video",
      url: "/assets/raid.mp4",
      accountId: "account-1",
      size: 2048000,
      createdAt: "2024-07-01T00:00:00Z",
    },
    {
      id: "asset-4",
      name: "Logo",
      type: "image",
      url: "/assets/logo.png",
      accountId: "account-1",
      size: 128000,
      createdAt: "2024-01-15T00:00:00Z",
    },
    {
      id: "asset-5",
      name: "Intro Music",
      type: "audio",
      url: "/assets/intro.mp3",
      accountId: "account-1",
      size: 1024000,
      createdAt: "2024-02-01T00:00:00Z",
    },
    {
      id: "asset-6",
      name: "Outro Video",
      type: "video",
      url: "/assets/outro.mp4",
      accountId: "account-1",
      size: 4096000,
      createdAt: "2024-03-01T00:00:00Z",
    },
    {
      id: "asset-7",
      name: "Emote Pack",
      type: "image",
      url: "/assets/emotes.zip",
      accountId: "account-1",
      size: 768000,
      createdAt: "2024-04-01T00:00:00Z",
    },
    {
      id: "asset-8",
      name: "Alert Sound",
      type: "audio",
      url: "/assets/alert.wav",
      accountId: "account-1",
      size: 384000,
      createdAt: "2024-05-01T00:00:00Z",
    },
    {
      id: "asset-9",
      name: "BRB Screen",
      type: "image",
      url: "/assets/brb.png",
      accountId: "account-2",
      size: 192000,
      createdAt: "2024-08-01T00:00:00Z",
    },
    {
      id: "asset-10",
      name: "Donation Sound",
      type: "audio",
      url: "/assets/donation.mp3",
      accountId: "account-2",
      size: 256000,
      createdAt: "2024-09-01T00:00:00Z",
    },
    {
      id: "asset-11",
      name: "Starting Soon",
      type: "video",
      url: "/assets/starting.mp4",
      accountId: "account-1",
      size: 3072000,
      createdAt: "2024-10-01T00:00:00Z",
    },
    {
      id: "asset-12",
      name: "Ending Screen",
      type: "image",
      url: "/assets/ending.png",
      accountId: "account-1",
      size: 256000,
      createdAt: "2024-11-01T00:00:00Z",
    },
  ];

  async getAssets(query?: {
    accountId?: string;
    type?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    assets: typeof this.mockAssets;
    total: number;
    page: number;
    pageSize: number;
  }> {
    let filtered = [...this.mockAssets];
    if (query?.accountId) filtered = filtered.filter((a) => a.accountId === query.accountId);
    if (query?.type) filtered = filtered.filter((a) => a.type === query.type);
    if (query?.search) filtered = filtered.filter((a) => a.name.toLowerCase().includes(query.search!.toLowerCase()));
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 12;
    return { assets: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  }

  async getAsset(id: string): Promise<(typeof this.mockAssets)[0] | null> {
    return this.mockAssets.find((a) => a.id === id) || null;
  }

  async createAsset(data: {
    name: string;
    type: string;
    url: string;
    accountId: string;
    size: number;
  }): Promise<{ id: string }> {
    const id = `asset-${Date.now()}`;
    this.mockAssets.push({ ...data, id, createdAt: new Date().toISOString() });
    return { id };
  }

  async deleteAsset(id: string): Promise<{ success: boolean }> {
    const idx = this.mockAssets.findIndex((a) => a.id === id);
    if (idx >= 0) this.mockAssets.splice(idx, 1);
    return { success: idx >= 0 };
  }

  // ==================== Scenes ====================
  //
  // Persistence: db-proxy SceneService. The engine treats
  // `widgets_json` / `layout_json` as opaque strings — only the UI
  // (woofx3-ui scene editor) and the streamware overlay (renderer)
  // parse them. Same trade-off as workflow `steps_json` /
  // `trigger_json`.
  //
  // Webhooks: every successful create / update / delete fires the
  // corresponding `scene.*` CloudEvent to registered clients via the
  // WebhookClient. The Convex mirror at `convex/sceneWebhook.ts`
  // consumes these so editor tabs converge without polling.

  async getScenes(query?: { accountId?: string; page?: number; pageSize?: number }): Promise<{
    scenes: Scene[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const applicationId = query?.accountId || (await this.ensureApplicationId());
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 10;
    const response = await this.db.listScenes({
      applicationId,
      page,
      pageSize,
      sortBy: "updated_at",
      sortDesc: true,
    });
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to list scenes");
    }
    return {
      scenes: (response.scenes ?? []).map((s) => dbSceneToWire(s)),
      total: response.totalCount ?? 0,
      page: response.page ?? page,
      pageSize: response.pageSize ?? pageSize,
    };
  }

  async getScene(id: string): Promise<Scene | null> {
    const response = await this.db.getScene({ id });
    if (response.status?.code !== "OK" || !response.scene) {
      return null;
    }
    return dbSceneToWire(response.scene);
  }

  async createScene(data: {
    name: string;
    accountId: string;
    description?: string;
    widgetsJson?: string;
    layoutJson?: string;
    correlationKey?: string;
  }): Promise<{ id: string }> {
    const applicationId = data.accountId || (await this.ensureApplicationId());
    this.logger.info("Creating scene", { name: data.name, applicationId });
    const response = await this.db.createScene({
      applicationId,
      name: data.name,
      description: data.description ?? "",
      widgetsJson: data.widgetsJson ?? "[]",
      layoutJson: data.layoutJson ?? "{}",
      createdByType: "USER",
      createdByRef: "",
    });
    if (response.status?.code !== "OK" || !response.scene) {
      throw new Error(response.status?.message || "Failed to create scene");
    }
    const created = response.scene;
    this.logger.info("Created scene", { id: created.id, name: created.name });

    void this.emitSceneWebhook({
      type: EngineEventType.SCENE_CREATED,
      applicationId,
      correlationKey: data.correlationKey,
      scene: dbSceneToSnapshot(created),
    });
    return { id: created.id ?? "" };
  }

  async updateScene(
    id: string,
    data: {
      name?: string;
      description?: string;
      widgetsJson?: string;
      layoutJson?: string;
      correlationKey?: string;
    }
  ): Promise<{ success: boolean }> {
    this.logger.info("Updating scene", { id });
    // Patch semantics — db-proxy's UpdateSceneRequest uses empty
    // strings for "leave alone", so map `undefined` → "" (no change)
    // and a real value → the value. Callers that genuinely want to
    // clear a field set it to empty string; today that's only
    // `description`. `widgetsJson` / `layoutJson` of `""` would be
    // invalid JSON, so empty here always means "leave unchanged".
    const response = await this.db.updateScene({
      id,
      name: data.name ?? "",
      description: data.description ?? "",
      widgetsJson: data.widgetsJson ?? "",
      layoutJson: data.layoutJson ?? "",
    });
    if (response.status?.code !== "OK" || !response.scene) {
      return { success: false };
    }
    const updated = response.scene;
    this.logger.info("Updated scene", { id, name: updated.name });

    void this.emitSceneWebhook({
      type: EngineEventType.SCENE_UPDATED,
      applicationId: updated.applicationId ?? "",
      correlationKey: data.correlationKey,
      scene: dbSceneToSnapshot(updated),
    });
    return { success: true };
  }

  async deleteScene(id: string, correlationKey?: string): Promise<{ success: boolean }> {
    this.logger.info("Deleting scene", { id });
    // Fetch first so we know the applicationId for the webhook —
    // the delete RPC just returns ResponseStatus.
    const existing = await this.db.getScene({ id });
    const applicationId =
      existing.status?.code === "OK" && existing.scene
        ? existing.scene.applicationId ?? ""
        : "";

    const response = await this.db.deleteScene({ id });
    const success = response.code === "OK";
    if (success) {
      void this.emitSceneWebhook({
        type: EngineEventType.SCENE_DELETED,
        applicationId,
        correlationKey,
        sceneId: id,
      });
    }
    return { success };
  }

  private async emitSceneWebhook(
    event: SceneCreatedEvent | SceneUpdatedEvent | SceneDeletedEvent
  ): Promise<void> {
    if (!this.webhookClient) {
      this.logger.warn("No webhook client set, skipping scene webhook", { type: event.type });
      return;
    }
    try {
      await this.webhookClient.send(event);
    } catch (err) {
      this.logger.error("Failed to send scene webhook", { type: event.type, err });
    }
  }

  // ==================== Dashboard Stats ====================

  async getDashboardStats(): Promise<{
    activeWorkflows: number;
    totalWorkflows: number;
    installedModules: number;
    totalModules: number;
    activeAccounts: number;
    recentEvents: number;
  }> {
    const engineModules = await this.listEngineModules().catch(() => []);
    const applicationId = await this.ensureApplicationId();
    const workflowsResponse = await this.db.listWorkflows({
      applicationId,
      includeDisabled: true,
      page: 1,
      pageSize: 1000,
      sortBy: "",
      sortDesc: false,
    });
    const workflows = workflowsResponse.workflows ?? [];
    return {
      activeWorkflows: workflows.filter((w) => w.enabled).length,
      totalWorkflows: workflowsResponse.totalCount ?? workflows.length,
      installedModules: engineModules.length,
      totalModules: engineModules.length,
      activeAccounts: 2,
      recentEvents: 147,
    };
  }

  // ==================== Chat & Stream Events ====================

  async getChatMessages(
    accountId: string,
    limit?: number
  ): Promise<
    Array<{
      id: string;
      user: string;
      message: string;
      timestamp: string;
      badges: string[];
      color: string;
    }>
  > {
    const messages = [
      {
        id: "msg-1",
        user: "CoolViewer42",
        message: "Hey everyone!",
        timestamp: "2026-01-13T23:30:00Z",
        badges: ["subscriber"],
        color: "#FF5733",
      },
      {
        id: "msg-2",
        user: "ModMaster",
        message: "Welcome to the stream!",
        timestamp: "2026-01-13T23:30:05Z",
        badges: ["moderator", "subscriber"],
        color: "#33FF57",
      },
      {
        id: "msg-3",
        user: "NewFollower",
        message: "Just followed! Love your content",
        timestamp: "2026-01-13T23:30:10Z",
        badges: [],
        color: "#3357FF",
      },
      {
        id: "msg-4",
        user: "BigDonor",
        message: "PogChamp",
        timestamp: "2026-01-13T23:30:15Z",
        badges: ["subscriber", "vip"],
        color: "#FF33F5",
      },
      {
        id: "msg-5",
        user: "ChattyPerson",
        message: "What game is this?",
        timestamp: "2026-01-13T23:30:20Z",
        badges: ["subscriber"],
        color: "#F5FF33",
      },
    ];
    return messages.slice(0, limit || 50);
  }

  async sendChatMessage(accountId: string, message: string): Promise<{ success: boolean; messageId: string }> {
    return { success: true, messageId: `msg-${Date.now()}` };
  }

  private streamEvents: Array<{
    id: string;
    accountId: string;
    type: string;
    user: string;
    amount?: number;
    message?: string;
    timestamp: string;
  }> = [
    { id: "evt-1", accountId: "account-1", type: "follow", user: "NewFollower123", timestamp: "2026-01-14T05:25:00Z" },
    {
      id: "evt-2",
      accountId: "account-1",
      type: "subscription",
      user: "LoyalSub",
      amount: 1,
      message: "Love the stream!",
      timestamp: "2026-01-14T05:20:00Z",
    },
    {
      id: "evt-3",
      accountId: "account-1",
      type: "cheer",
      user: "BitGiver",
      amount: 500,
      message: "Take my bits!",
      timestamp: "2026-01-14T05:15:00Z",
    },
    {
      id: "evt-4",
      accountId: "account-1",
      type: "raid",
      user: "FriendlyStreamer",
      amount: 42,
      timestamp: "2026-01-14T05:10:00Z",
    },
    {
      id: "evt-5",
      accountId: "account-1",
      type: "gift",
      user: "GiftMaster",
      amount: 5,
      message: "Gifting to the community!",
      timestamp: "2026-01-14T05:05:00Z",
    },
    {
      id: "evt-6",
      accountId: "account-1",
      type: "donation",
      user: "GenerousDonor",
      amount: 25,
      message: "Keep up the great work!",
      timestamp: "2026-01-14T05:00:00Z",
    },
    { id: "evt-7", accountId: "account-1", type: "follow", user: "AnotherFan", timestamp: "2026-01-14T04:55:00Z" },
    {
      id: "evt-8",
      accountId: "account-1",
      type: "subscription",
      user: "TierThreeSub",
      amount: 3,
      message: "Tier 3 hype!",
      timestamp: "2026-01-14T04:50:00Z",
    },
    { id: "evt-9", accountId: "account-2", type: "follow", user: "YTFollower", timestamp: "2026-01-14T04:45:00Z" },
    {
      id: "evt-10",
      accountId: "account-2",
      type: "donation",
      user: "SuperChat",
      amount: 10,
      message: "Great content!",
      timestamp: "2026-01-14T04:40:00Z",
    },
  ];

  async getStreamEvents(query?: { accountId: string; limit?: number; types?: string[] }): Promise<
    Array<{
      id: string;
      type: string;
      user: string;
      amount?: number;
      message?: string;
      timestamp: string;
    }>
  > {
    let filtered = [...this.streamEvents];

    // Filter by accountId (required)
    if (query?.accountId) {
      filtered = filtered.filter((e) => e.accountId === query.accountId);
    }

    // Filter by event types
    if (query?.types?.length) {
      filtered = filtered.filter((e) => query.types!.includes(e.type));
    }

    // Apply limit
    const limit = query?.limit || 20;
    filtered = filtered.slice(0, limit);

    // Return without accountId in response
    return filtered.map(({ accountId, ...event }) => event);
  }

  // ==================== Triggers & Actions ====================

  private triggers: Array<{
    id: string;
    moduleId: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    color?: string;
    config: {
      fields: Array<{
        id: string;
        name: string;
        type: string;
        label: string;
        description?: string;
        required?: boolean;
        placeholder?: string;
        defaultValue?: unknown;
        options?: Array<{ label: string; value: string }>;
        min?: number;
        max?: number;
        step?: number;
        unit?: string;
        mediaType?: string;
        validation?: { pattern?: string; message?: string };
      }>;
      supportsTiers?: boolean;
      tierLabel?: string;
    };
  }> = [
    {
      id: "trigger-chat-command",
      moduleId: "mod-1",
      name: "Chat Command",
      description: "When someone uses a chat command",
      icon: "MessageCircle",
      category: "chat",
      color: "text-blue-500",
      config: {
        fields: [
          { id: "command", name: "command", type: "string", label: "Command", required: true, placeholder: "!hello" },
          {
            id: "cooldown",
            name: "cooldown",
            type: "number",
            label: "Cooldown",
            unit: "seconds",
            min: 0,
            max: 3600,
            defaultValue: 5,
          },
          { id: "modOnly", name: "modOnly", type: "boolean", label: "Mods Only", defaultValue: false },
        ],
      },
    },
    {
      id: "trigger-follow",
      moduleId: "mod-2",
      name: "New Follower",
      description: "When someone follows the channel",
      icon: "UserPlus",
      category: "events",
      color: "text-green-500",
      config: { fields: [] },
    },
    {
      id: "trigger-subscription",
      moduleId: "mod-2",
      name: "Subscription",
      description: "When someone subscribes or resubscribes",
      icon: "Star",
      category: "events",
      color: "text-purple-500",
      config: {
        fields: [
          {
            id: "minMonths",
            name: "minMonths",
            type: "number",
            label: "Minimum Months",
            min: 0,
            max: 100,
            defaultValue: 0,
          },
        ],
        supportsTiers: true,
        tierLabel: "Subscription Tier",
      },
    },
    {
      id: "trigger-cheer",
      moduleId: "mod-2",
      name: "Cheer/Bits",
      description: "When someone cheers with bits",
      icon: "Gem",
      category: "events",
      color: "text-pink-500",
      config: {
        fields: [
          {
            id: "minBits",
            name: "minBits",
            type: "number",
            label: "Minimum Bits",
            min: 1,
            max: 100000,
            defaultValue: 1,
          },
        ],
      },
    },
    {
      id: "trigger-raid",
      moduleId: "mod-2",
      name: "Raid",
      description: "When another streamer raids the channel",
      icon: "Users",
      category: "events",
      color: "text-orange-500",
      config: {
        fields: [
          {
            id: "minViewers",
            name: "minViewers",
            type: "number",
            label: "Minimum Viewers",
            min: 0,
            max: 10000,
            defaultValue: 0,
          },
        ],
      },
    },
    {
      id: "trigger-redemption",
      moduleId: "mod-3",
      name: "Channel Point Redemption",
      description: "When someone redeems channel points",
      icon: "Gift",
      category: "engagement",
      color: "text-cyan-500",
      config: {
        fields: [
          {
            id: "rewardId",
            name: "rewardId",
            type: "string",
            label: "Reward ID",
            placeholder: "Leave empty for any reward",
          },
        ],
      },
    },
    {
      id: "trigger-stream-online",
      moduleId: "mod-8",
      name: "Stream Goes Live",
      description: "When the stream starts",
      icon: "Radio",
      category: "stream",
      color: "text-red-500",
      config: { fields: [] },
    },
    {
      id: "trigger-stream-offline",
      moduleId: "mod-8",
      name: "Stream Goes Offline",
      description: "When the stream ends",
      icon: "RadioOff",
      category: "stream",
      color: "text-gray-500",
      config: { fields: [] },
    },
  ];

  async getTriggers(createdByType?: string, createdByRef?: string): Promise<TriggerDefinition[]> {
    // Proto Trigger and TriggerDefinition are structurally identical
    // (camelCase field names introduced by twirpscript), so the conversion
    // is a no-op cast — kept explicit so the contract / impl stay tied
    // through the type checker.
    const rows = await this.db.listTriggers(createdByType, createdByRef);
    return rows;
  }

  async getTrigger(id: string): Promise<(typeof this.triggers)[0] | null> {
    return this.triggers.find((t) => t.id === id) || null;
  }

  async getActions(createdByType?: string, createdByRef?: string): Promise<ActionDefinition[]> {
    const rows = await this.db.listActions(createdByType, createdByRef);
    return rows;
  }

  // ==================== User Preferences ====================

  private userPreferences = { email: true, push: false, workflow: true, marketing: false };

  async getUserPreferences(): Promise<{ email: boolean; push: boolean; workflow: boolean; marketing: boolean }> {
    return { ...this.userPreferences };
  }

  async updateUserPreferences(prefs: Partial<typeof this.userPreferences>): Promise<{ success: boolean }> {
    Object.assign(this.userPreferences, prefs);
    return { success: true };
  }

  // ==================== Dashboard Layout ====================

  private dashboardLayouts: Record<
    string,
    Array<{
      id: string;
      type: string;
      title: string;
      config?: Record<string, unknown>;
    }>
  > = {
    "account-1": [
      { id: "dash-1", type: "chat", title: "Live Chat", config: { accountId: "account-1" } },
      { id: "dash-2", type: "workflow-runs", title: "Recent Workflows", config: { accountId: "account-1", limit: 5 } },
      { id: "dash-3", type: "event-feed", title: "Stream Events", config: { accountId: "account-1", limit: 10 } },
    ],
  };

  async getDashboardLayout(accountId: string): Promise<
    Array<{
      id: string;
      type: string;
      title: string;
      config?: Record<string, unknown>;
    }>
  > {
    return this.dashboardLayouts[accountId] || [];
  }

  async saveDashboardLayout(
    accountId: string,
    modules: Array<{
      id: string;
      type: string;
      title: string;
      config?: Record<string, unknown>;
    }>
  ): Promise<boolean> {
    this.dashboardLayouts[accountId] = modules;
    return true;
  }

  // ==================== Internal Helpers ====================

  private async publishEvent(eventType: string, data: Record<string, unknown>, subject?: string): Promise<void> {
    if (!this.nats) {
      this.logger.error("Cannot publish event - NATS client not available", { eventType });
      throw new Error("NATS client not available");
    }

    const eventId = crypto.randomUUID();
    const event = {
      id: eventId,
      type: eventType,
      source: "api",
      time: new Date().toISOString(),
      data,
    };

    const eventData = new TextEncoder().encode(JSON.stringify(event));
    const eventSubject = subject || eventType;

    this.logger.debug("Publishing event to NATS", {
      eventType,
      eventId,
      subject: eventSubject,
    });

    await this.nats.publish(eventSubject, eventData);

    this.logger.info("Event published successfully", {
      eventType,
      eventId,
      subject: eventSubject,
    });
  }

  /**
   * Replay a previously recorded alert. After R1 the queue manager
   * lives in streamware, so this method forwards via NATS request/
   * reply. Streamware loads the original payload, stamps a fresh
   * envelope id, re-publishes to `ui.notify.alert`, and marks the
   * source row `replayed`. Returns `false` when the alert id can't
   * be found or the payload is malformed.
   */
  async replayAlert(id: string): Promise<boolean> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    if (!id) {
      throw new Error("alert id is required");
    }
    this.logger.info("Replaying alert (forwarding to streamware)", { id });
    const reply = await this.nats.request(
      "widget.queue.replay",
      new TextEncoder().encode(JSON.stringify({ id }))
    );
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as {
      ok: boolean;
      message: string;
      replayEnvelopeId?: string;
    };
    if (!result.ok) {
      this.logger.warn("Replay rejected", { id, reason: result.message });
      return false;
    }
    this.logger.info("Alert replayed", { id, replayEnvelopeId: result.replayEnvelopeId });
    return true;
  }

  /**
   * Forward a "skip the current alert" RPC to streamware's queue
   * manager. The orchestrator marks the in-flight alert `skipped`,
   * dispatches the next pending, and the standard
   * `db.alert.updated.*` outbox event drives the ALERT_SKIPPED
   * webhook from the api boundary.
   */
  async skipCurrentAlert(applicationId?: string): Promise<{ skipped: boolean }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    const appId = applicationId || (await this.ensureApplicationId());
    const reply = await this.nats.request(
      "widget.queue.skip",
      new TextEncoder().encode(JSON.stringify({ applicationId: appId }))
    );
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as { skipped: boolean };
    this.logger.info("skipCurrentAlert", { applicationId: appId, skipped: result.skipped });
    return result;
  }

  /**
   * Forward a "clear pending" RPC to streamware. The orchestrator
   * marks every pending alert `skipped` (without touching the
   * in-flight lease) and returns the count.
   */
  async clearAlertQueue(applicationId?: string): Promise<{ cleared: number }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    const appId = applicationId || (await this.ensureApplicationId());
    const reply = await this.nats.request(
      "widget.queue.clear",
      new TextEncoder().encode(JSON.stringify({ applicationId: appId }))
    );
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as { cleared: number };
    this.logger.info("clearAlertQueue", { applicationId: appId, cleared: result.cleared });
    return result;
  }
}
