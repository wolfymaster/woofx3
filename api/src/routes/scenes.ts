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

export const scenesRoutes = {
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
  },

  async getScene(id: string): Promise<Scene | null> {
    const response = await this.db.getScene({ id });
    if (response.status?.code !== "OK" || !response.scene) {
      return null;
    }
    return dbSceneToWire(response.scene);
  },

  async getAvailableWidgets(): Promise<{
    widgets: Array<{
      id: string;
      manifestId: string;
      name: string;
      description: string;
      directory: string;
      alertTypes: string[];
      settingsSchema: string;
      surface: string;
      createdByType: string;
      createdByRef: string;
    }>;
  }> {
    const response = await this.db.listWidgets({ createdByType: "", createdByRef: "" });
    return {
      widgets: (response.widgets ?? []).map((w) => ({
        id: w.id,
        manifestId: w.manifestId,
        name: w.name,
        description: w.description,
        directory: w.directory,
        alertTypes: w.alertTypes ?? [],
        settingsSchema: w.settingsSchema ?? "[]",
        surface: w.surface ?? "scene",
        createdByType: w.createdByType ?? "",
        createdByRef: w.createdByRef ?? "",
      })),
    };
  },

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
  },

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
  },

  async deleteScene(id: string, correlationKey?: string): Promise<{ success: boolean }> {
    this.logger.info("Deleting scene", { id });
    // Fetch first so we know the applicationId for the webhook —
    // the delete RPC just returns ResponseStatus.
    const existing = await this.db.getScene({ id });
    const applicationId = existing.status?.code === "OK" && existing.scene ? (existing.scene.applicationId ?? "") : "";

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
};
