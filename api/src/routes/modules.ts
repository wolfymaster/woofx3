import type {
  AvailableFunction,
  CommandSnapshot,
  CommandType,
  CreateCommandInput,
  CreateWorkflowInput,
  FieldOptionsDescriptor,
  ModuleSetting,
  ModuleSettingsResponse,
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
  }
};
