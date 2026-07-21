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
  WorkflowDefinition,
  WorkflowMutationResult,
} from "@woofx3/api";
import type {
  ActionDefinition,
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneUpdatedEvent,
  TriggerDefinition,
  WorkflowCreatedEvent,
  WorkflowDeletedEvent,
  WorkflowUpdatedEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { Action } from "@woofx3/db/module_action.pb";
import type { Trigger } from "@woofx3/db/module_trigger.pb";
import type * as command from "@woofx3/db/command.pb";
import type * as scene from "@woofx3/db/scene.pb";
import type * as treat from "@woofx3/db/treat.pb";
import type * as user from "@woofx3/db/user.pb";
import type * as workflow from "@woofx3/db/workflow.pb";
import * as protoscript from "protoscript";
import { ApiRouteHost } from "./context";
import {
  commandToSnapshot,
  dbSceneToSnapshot,
  dbSceneToWire,
  readModuleCatalogFields,
  rebuildWorkflowDefinition,
  timestampFromDate,
  timestampToIso,
} from "./helpers";
import type { UninstallModuleResponse, WorkflowItem } from "./types";
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
} from "../module-event-handlers";
import { parseWorkflowCreated, parseWorkflowDeleted, parseWorkflowUpdated } from "../workflow-event-handlers";
import { parseSceneCreated, parseSceneDeleted, parseSceneUpdated } from "../scene-event-handlers";
import { parseAlertCreated, parseAlertUpdated } from "../alert-log-handlers";
import { validateWorkflowDefinition } from "../workflow/validate-definition";

export const engineRoutes = {
  async ping(): Promise<PingResponse> {
    return { status: "ok", instanceId: this.applicationId ?? "pending" };
  },

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
   * `assetsBaseUrl` is sourced from the engine's settings
   * (`assets.baseUrl`) and is what the *workflow engine* substitutes
   * for `${woofx3_asset_url}` when resolving a step's parameters at
   * execution time (see `workflow/asset_settings.go` and
   * docs/workflow/expressions.md). Distinct from `widgetAssetBaseUrl`
   * — that one composes overlay widget iframe sources in the
   * browser; this one is baked into workflow step parameters
   * (e.g. an alert's `mediaUrl`) server-side before dispatch. They
   * often point at the same host but don't have to. Unset returns
   * barkloader's own `/assets` route (its default per
   * `workflow/asset_settings.go`'s `AssetSettingsResolver` fallback),
   * not empty string — there's always a working default.
   *
   * `engineSceneOverlayBaseUrl` is the streamware URL (always
   * served by streamware itself — overlay HTML is engine-owned).
   *
   * All URLs strip trailing slashes so callers can join with `/`
   * without worrying about double-slashes. An empty
   * `widgetAssetBaseUrl` is a valid response — it signals to the UI
   * that storage isn't configured yet, and the editor renders the
   * "widget unavailable" placeholder instead of a broken iframe.
   */
  async getEngineInfo(): Promise<{
    widgetAssetBaseUrl: string;
    assetsBaseUrl: string;
    engineSceneOverlayBaseUrl: string;
  }> {
    const applicationId = await this.ensureApplicationId();
    const [widgetAssetBaseUrl, assetsBaseUrl] = await Promise.all([
      this.db.getSetting("widget_asset_base_url", applicationId),
      this.db.getSetting("assets.baseUrl", applicationId),
    ]);
    const streamware = this.streamwareUrl.replace(/\/+$/, "");
    return {
      widgetAssetBaseUrl: (widgetAssetBaseUrl ?? "").replace(/\/+$/, ""),
      assetsBaseUrl: (assetsBaseUrl || `${this.getBarkloaderBaseUrl()}/assets`).replace(/\/+$/, ""),
      engineSceneOverlayBaseUrl: `${streamware}/overlay/scene`,
    };
  },

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
  },

  /**
   * Update the engine-stored workflow asset base URL
   * (`assets.baseUrl`). Used by the UI settings form; the operator
   * points it at wherever they want `${woofx3_asset_url}` to resolve
   * to at workflow-execution time (see `getEngineInfo` doc comment
   * above for how this differs from `widgetAssetBaseUrl`).
   *
   * Empty string is allowed and clears the setting — the engine then
   * falls back to barkloader's own `/assets` route, it does not go
   * unresolved.
   */
  async setAssetsBaseUrl(value: string): Promise<{ success: boolean }> {
    const applicationId = await this.ensureApplicationId();
    const normalized = value.trim().replace(/\/+$/, "");
    const response = await this.db.setSetting("assets.baseUrl", normalized, applicationId);
    return { success: response.status?.code === "OK" };
  },

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
      const [bucket, prefix, region, endpoint, accessKey, secretKey, forcePathStyle] = await Promise.all([
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
  },

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
  },

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
};
