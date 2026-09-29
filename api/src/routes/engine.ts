import { routeModule } from "./context";
import type { PingResponse, StorageConfig } from "@woofx3/api";
import { resolveSceneManagerUrl } from "./helpers";

export const engineRoutes = routeModule({
  async ping(): Promise<PingResponse> {
    return { status: "ok" };
  },

  /**
   * Surface deployment URLs to the UI. Called once per UI session and
   * cached.
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
    version: string;
  }> {
    const overlayPublicUrl = await resolveSceneManagerUrl(this.db, this.sceneManagerUrl);
    return {
      engineSceneOverlayBaseUrl: `${overlayPublicUrl}/overlay/scene`,
      overlayPublicUrl,
      version: this.version,
    };
  },

  /**
   * Update the engine-stored public base URL sceneManager (and its
   * built-in widgets) is reachable at (`scene.publicUrl` setting,
   * renamed from `overlay.publicUrl` when sceneManager replaced
   * streamware — see db migration 0031) — used to compose the `url`
   * returned by mintOverlayToken/rotateOverlayToken/listOverlayTokens,
   * and (via `getEngineInfo().overlayPublicUrl`) every widget/module
   * asset URL sceneManager and workflow construct. Used by the UI
   * settings form; the operator points it at wherever sceneManager
   * sits behind a tunnel or reverse proxy. The RPC method name is unchanged (Convex's
   * contract), only the underlying setting key moved.
   *
   * Empty string is allowed and clears the setting — the engine then falls
   * back to its configured `sceneManagerUrl`.
   */
  async setOverlayPublicUrl(value: string): Promise<{ success: boolean }> {
    const normalized = value.trim().replace(/\/+$/, "");
    return { success: await this.db.trySetSetting("scene.publicUrl", normalized) };
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
    const provider = (await this.db.getSetting("storage.provider")) || "file";
    if (provider !== "file" && provider !== "s3") {
      throw new Error(`Unknown storage.provider value: ${provider}`);
    }
    const result: StorageConfig = {
      provider: provider as "file" | "s3",
    };
    if (provider === "file") {
      const dest = await this.db.getSetting("storage.file.destination");
      if (dest) {
        result.destination = dest;
      }
    } else {
      const [bucket, prefix, region, endpoint, accessKey, secretKey, forcePathStyle] = await Promise.all([
        this.db.getSetting("storage.s3.bucket"),
        this.db.getSetting("storage.s3.prefix"),
        this.db.getSetting("storage.s3.region"),
        this.db.getSetting("storage.s3.endpoint"),
        this.db.getSetting("storage.s3.access_key"),
        this.db.getSetting("storage.s3.secret_key"),
        this.db.getSetting("storage.s3.force_path_style"),
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
  async setStorageConfig(config: StorageConfig): Promise<{ success: boolean; reloaded?: boolean; message?: string }> {
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
      if (!(await this.db.trySetSetting(key, value))) {
        return { success: false };
      }
    }

    // Deliberately after the whole loop, not per key: each setting lands
    // in its own write, so an engine reacting to individual writes would
    // read torn configuration -- provider already flipped to "s3" while
    // the bucket is still unwritten.
    //
    // The engine validates the new backend before adopting it, so a
    // rejection here means the settings are saved but unusable. Report
    // that rather than swallowing it; the operator needs to know the
    // running engine is still on the old backend.
    try {
      await this.barkloaderRequest("/storage/reload", { method: "POST" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("Storage settings saved but engine reload failed", { error: message });
      return { success: true, reloaded: false, message };
    }
    return { success: true, reloaded: true };
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
  },
});
