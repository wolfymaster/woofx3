import type {
  ModuleSetting,
  ModuleSettingsResponse,
  ModuleResourceUsage,
  ResourceInstanceDefinition,
} from "@woofx3/api";
import { ApiRouteHost } from "./context";
import { readModuleCatalogFields } from "./helpers";
import type { UninstallModuleResponse } from "./types";

export const modulesRoutes = {
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
    if (this.applicationId) {
      formData.append("application_id", this.applicationId);
    }

    const response = await this.barkloaderRequest("/functions", {
      method: "POST",
      body: formData,
    });
    const json = (await response.json()) as { message?: string };
    this.logger.info("Module zip installed", { clientId, moduleKey, fileName, message: json.message });
    return { success: true, message: json.message ?? "Module uploaded" };
  },

  async installModuleFromUrl(
    downloadUrl: string,
    moduleKey: string,
    context: {
      clientId: string;
      moduleKey: string;
      name: string;
      version: string;
      source: "marketplace";
      marketplaceModuleId: string;
    }
  ): Promise<{ success: boolean; message?: string; alreadyInstalled?: boolean }> {
    const { clientId, name, version, source, marketplaceModuleId } = context;
    if (!clientId) {
      throw new Error("clientId is required to install a module");
    }
    if (!moduleKey) {
      throw new Error("moduleKey is required to install a module from URL");
    }

    this.logger.info("Installing module from URL", {
      clientId,
      moduleKey,
      source,
      marketplaceModuleId,
      name,
      version,
    });

    const existing = await this.db.getModuleByModuleKey(moduleKey);
    if (existing) {
      this.logger.info("Module already installed, skipping fetch", {
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
          clientId || undefined,
        );
      }
      return { success: true, message: "Module already installed", alreadyInstalled: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ApiRouteHost.MARKETPLACE_FETCH_TIMEOUT_MS);
    let archiveBytes: Uint8Array;
    try {
      const res = await fetch(downloadUrl, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Marketplace fetch failed: ${res.status} ${res.statusText}`);
      }
      const contentLength = Number(res.headers.get("content-length") ?? "0");
      if (contentLength > ApiRouteHost.MARKETPLACE_MAX_BYTES) {
        throw new Error(
          `Marketplace archive exceeds size cap (${contentLength} > ${ApiRouteHost.MARKETPLACE_MAX_BYTES})`,
        );
      }
      const buf = new Uint8Array((await res.arrayBuffer()) as ArrayBuffer);
      if (buf.byteLength > ApiRouteHost.MARKETPLACE_MAX_BYTES) {
        throw new Error(
          `Marketplace archive exceeds size cap (${buf.byteLength} > ${ApiRouteHost.MARKETPLACE_MAX_BYTES})`,
        );
      }
      archiveBytes = buf;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Marketplace fetch failed", { clientId, moduleKey, message });
      if (this.webhookClient) {
        await this.webhookClient.send(
          {
            type: "module.install_failed",
            moduleName: name,
            version,
            moduleKey,
            error: `Failed to fetch marketplace archive: ${message}`,
          },
          clientId || undefined,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const fileName = `${name}-${version}.zip`;
    const formData = new FormData();
    formData.append(
      "file",
      new File([archiveBytes as Uint8Array<ArrayBuffer>], fileName, { type: "application/zip" }),
    );
    formData.append("client_id", clientId);
    formData.append("module_key", moduleKey);
    if (this.applicationId) {
      formData.append("application_id", this.applicationId);
    }

    const response = await this.barkloaderRequest("/functions", {
      method: "POST",
      body: formData,
    });
    const json = (await response.json()) as { message?: string };
    this.logger.info("Module from URL handed to barkloader", {
      clientId,
      moduleKey,
      fileName,
      message: json.message,
    });
    return { success: true, message: json.message ?? "Module uploaded" };
  },

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
  },

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
  },

  async getModules(query?: {
    taxonomy?: string;
    search?: string;
    installed?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{
    modules: Array<{
      id: string;
      name: string;
      description: string;
      taxonomy: string[];
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
        const { author, taxonomy } = readModuleCatalogFields(m.manifest);
        return {
          id: m.name,
          name: m.name,
          description: "",
          taxonomy,
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
  },

  async getModule(id: string): Promise<{
    id: string;
    name: string;
    description: string;
    taxonomy: string[];
    version: string;
    author: string;
    isInstalled: boolean;
    iconUrl: string;
  } | null> {
    const found = await this.db.getModuleByName(id);
    if (!found) return null;
    const { author, taxonomy } = readModuleCatalogFields(found.manifest);
    return {
      id: found.name,
      name: found.name,
      description: "",
      taxonomy,
      version: found.version,
      author,
      isInstalled: true,
      iconUrl: "",
    };
  },

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
  async uninstallModule(moduleKey: string, context?: { clientId?: string }): Promise<UninstallModuleResponse> {
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
  },

  /**
   * Returns every module_resources row owned by this module that is still
   * referenced by an external workflow, command, or other consumer. Keyed
   * by composite `moduleKey` so the UI does not need the engine UUID.
   */
  async checkModuleResourceUsage(moduleKey: string): Promise<ModuleResourceUsage[]> {
    if (!moduleKey) {
      throw new Error("checkModuleResourceUsage: moduleKey is required");
    }
    const found = await this.db.getModuleByModuleKey(moduleKey);
    if (!found) {
      throw new Error(`checkModuleResourceUsage: no module found for moduleKey "${moduleKey}"`);
    }
    return this.db.checkModuleResourceUsage(found.id, this.applicationId ?? "");
  },

  /**
   * `moduleId` is the manifest-local module id (same id `ctx.module.id`
   * resolves to at runtime), not the composite moduleKey used for install/
   * uninstall. Listing a module with no registered settings returns an
   * empty array, not an error.
   */
  async getModuleSettings(moduleId: string): Promise<ModuleSettingsResponse> {
    const result = await this.db.listModuleSettings({ moduleId });
    return { settings: result.settings };
  },

  /**
   * `valueType` is fixed at install time from the manifest's `settings[].type`
   * and re-derived server-side here (defaulting to "string" only if no row
   * exists yet) — callers can change `value` but never `valueType`.
   */
  async updateModuleSetting(moduleId: string, key: string, value: string): Promise<ModuleSetting> {
    if (typeof value !== "string") {
      throw new Error("updateModuleSetting: value must be a string");
    }
    const existing = await this.db.listModuleSettings({ moduleId });
    const current = existing.settings.find((s) => s.key === key);
    const valueType = current?.valueType ?? "string";
    return this.db.setModuleSetting({ moduleId, key, value, valueType });
  },

  /**
   * Returns the raw manifest JSON barkloader parsed and stored at install
   * time (`modules.manifest`) — the authoritative source for schema-level
   * declarations (`settings[]`, `resources[]`, etc.) that aren't otherwise
   * queryable. `moduleId` is the manifest-local module id, same as
   * `getModuleSettings`/`updateModuleSetting`, not the composite moduleKey.
   * Returns null if no module with that id is installed, or its stored
   * manifest fails to parse.
   */
  async getModuleManifest(moduleId: string): Promise<Record<string, unknown> | null> {
    const modules = await this.db.listModules();
    const found = modules.find((m) => m.moduleId === moduleId);
    if (!found?.manifest) {
      return null;
    }
    try {
      const parsed = JSON.parse(found.manifest);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  },

  /**
   * Creates a runtime instance of a module-declared resource kind (e.g. a
   * user-defined counter). `moduleName` is the manifest-local module id,
   * same as `getModuleSettings`/`getModuleManifest`. `instanceId` is a
   * caller-chosen manifest-local id; combined with moduleName/kind it forms
   * the canonical id `{moduleName}:{kind}:{instanceId}`.
   *
   * `clientId` is injected automatically by the authenticated ApiSession
   * (see api-session.ts) so the resulting webhook event routes to the
   * right callback.
   */
  async createResourceInstance(
    moduleName: string,
    kind: string,
    instanceId: string,
    displayName: string,
    context: { clientId: string }
  ): Promise<ResourceInstanceDefinition> {
    const result = await this.db.createResourceInstance({
      moduleId: "",
      moduleName,
      kind,
      instanceId,
      displayName,
      connectionKind: "",
      connectionConfig: "",
      requestContext: { clientId: context.clientId, applicationId: this.applicationId ?? "", moduleKey: "" },
    });
    return {
      id: result.instance.id,
      moduleId: result.instance.moduleId,
      moduleName: result.instance.moduleName,
      kind: result.instance.kind,
      instanceId: result.instance.instanceId,
      displayName: result.instance.displayName,
      canonicalId: result.instance.canonicalId,
      moduleKey: result.instance.moduleKey,
    };
  },

  /**
   * Deletes a resource instance by its canonical id
   * (`{moduleName}:{kind}:{instanceId}`). `clientId` is injected
   * automatically by the authenticated ApiSession.
   */
  async deleteResourceInstance(canonicalId: string, context: { clientId: string }): Promise<void> {
    await this.db.deleteResourceInstance({
      canonicalId,
      requestContext: { clientId: context.clientId, applicationId: this.applicationId ?? "", moduleKey: "" },
    });
  },

  /**
   * Lists every resource instance across every installed module — backs
   * the Convex UI's periodic reconcile so its cache self-heals from the
   * engine's authoritative data instead of depending solely on webhook
   * delivery (see createResourceInstance/deleteResourceInstance above,
   * which fire the create/delete webhooks this list would otherwise be the
   * only way to recover from if one is ever missed or misresolved).
   */
  async listAllResourceInstances(): Promise<ResourceInstanceDefinition[]> {
    const response = await this.db.listAllResourceInstances({});
    return (response.instances ?? []).map((instance) => ({
      id: instance.id,
      moduleId: instance.moduleId,
      moduleName: instance.moduleName,
      kind: instance.kind,
      instanceId: instance.instanceId,
      displayName: instance.displayName,
      canonicalId: instance.canonicalId,
      moduleKey: instance.moduleKey,
    }));
  },

  /**
   * Resource instances owned by a single installed module, keyed by composite
   * `moduleKey`. Used by the UI RESOURCES tab so it can show engine-backed
   * rows even when a create webhook was missed. Optional `moduleName` falls
   * back when the composite key does not match the engine modules row
   * (reinstall hash drift, manual installs, etc.).
   */
  async listResourceInstancesForModule(
    moduleKey: string,
    moduleName?: string
  ): Promise<ResourceInstanceDefinition[]> {
    if (!moduleKey && !moduleName) {
      throw new Error("listResourceInstancesForModule: moduleKey or moduleName is required");
    }

    let found = moduleKey ? await this.db.getModuleByModuleKey(moduleKey) : null;
    if (!found && moduleName) {
      found = await this.db.getModuleByName(moduleName);
    }
    if (!found && moduleKey) {
      const manifestId = moduleKey.split(":")[0];
      if (manifestId) {
        found = await this.db.getModuleByName(manifestId);
      }
    }
    if (!found) {
      throw new Error(
        `listResourceInstancesForModule: no module found for moduleKey "${moduleKey}"` +
          (moduleName ? ` / moduleName "${moduleName}"` : "")
      );
    }

    const response = await this.db.listResourceInstancesByModule(found.id);
    const resolvedKey = found.moduleKey || moduleKey || "";
    return (response.instances ?? []).map((instance) => ({
      id: instance.id,
      moduleId: instance.moduleId,
      moduleName: instance.moduleName,
      kind: instance.kind,
      instanceId: instance.instanceId,
      displayName: instance.displayName,
      canonicalId: instance.canonicalId,
      moduleKey: instance.moduleKey || resolvedKey,
    }));
  },
};
