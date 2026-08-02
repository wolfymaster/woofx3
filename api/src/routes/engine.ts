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
  resolveOverlayPublicUrl,
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
   * Surface deployment URLs to the UI. Called once per UI session and
   * cached.
   *
   * `overlayPublicUrl` is the single public base URL for reaching this
   * api's overlay surface — both the token-scoped overlay tree
   * (`/overlay/{token}/...`, what `mintOverlayToken`/`rotateOverlayToken`/
   * `listOverlayTokens` compose their `url` from) and, via the same
   * `/overlay/assets/...` route, every widget/module asset kind. There is
   * deliberately only this one setting: everything is proxied through the
   * api gateway's `/overlay/` surface today, so a separate
   * "streamware app" URL or a separate "asset storage" URL would just be
   * two more names for the same value — see
   * docs/services/engine-settings-ui.md for the history of why this used
   * to be three settings.
   *
   * Read via `resolveOverlayPublicUrl`: the `overlay.publicUrl` engine
   * setting, falling back to this service's own env-configured
   * `overlayPublicUrl` (`WOOFX3_OVERLAY_PUBLIC_URL`) when unset. No
   * further hardcoded fallback beyond that — an unconfigured deployment
   * gets an empty string here rather than a guessed value.
   *
   * `engineSceneOverlayBaseUrl` is a cheap derivation
   * (`${overlayPublicUrl}/overlay/scene`), kept for backward
   * compatibility with existing UI code. Note: as of this writing
   * `/overlay/scene/{id}` isn't wired to a working streamware route
   * (real scene loading goes through the token-based
   * `/overlay/{token}/...` routes instead) — this field's value isn't
   * currently fetchable, which predates this change and is tracked
   * separately.
   *
   * All URLs strip trailing slashes so callers can join with `/`
   * without worrying about double-slashes.
   */
  async getEngineInfo(): Promise<{
    engineSceneOverlayBaseUrl: string;
    overlayPublicUrl: string;
  }> {
    const overlayPublicUrl = await resolveOverlayPublicUrl(this.db, this.overlayPublicUrl);
    return {
      engineSceneOverlayBaseUrl: `${overlayPublicUrl}/overlay/scene`,
      overlayPublicUrl,
    };
  },

  /**
   * Update the engine-stored public base URL the api's overlay gateway is
   * reachable at (`overlay.publicUrl` setting) — used to compose the `url`
   * returned by mintOverlayToken/rotateOverlayToken/listOverlayTokens, and
   * (via `getEngineInfo().overlayPublicUrl`) every widget/module asset
   * URL streamware and workflow construct. Used by the UI settings form;
   * the operator points it at wherever this api service sits behind a
   * tunnel or reverse proxy. Process-wide — not application-scoped.
   *
   * Empty string is allowed and clears the setting — the engine then falls
   * back to its own env-configured `overlayPublicUrl` (WOOFX3_OVERLAY_PUBLIC_URL).
   */
  async setOverlayPublicUrl(value: string): Promise<{ success: boolean }> {
    const normalized = value.trim().replace(/\/+$/, "");
    const response = await this.db.setSetting("overlay.publicUrl", normalized, "");
    return { success: response.status?.code === "OK" };
  },

  /**
   * Read the active storage backend configuration. Returns the
   * provider plus whichever fields are populated; missing values
   * are returned as undefined. Secret values (`accessKey`,
   * `secretKey`) are masked — read returns `"***"` when set, empty
   * when unset. Writes pass through directly via setStorageConfig.
   *
   * This is purely about which repository backend barkloader writes
   * bytes to (file vs. s3) — not where those bytes are publicly
   * reachable from. That's `getEngineInfo().overlayPublicUrl`
   * (everything, including assets, is proxied through the same
   * `/overlay/` surface today — see that method's doc comment).
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
