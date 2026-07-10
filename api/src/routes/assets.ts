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

export const assetsRoutes = {
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
  },

  async getAsset(id: string): Promise<(typeof this.mockAssets)[0] | null> {
    return this.mockAssets.find((a) => a.id === id) || null;
  },

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
  },

  async deleteAsset(id: string): Promise<{ success: boolean }> {
    const idx = this.mockAssets.findIndex((a) => a.id === id);
    if (idx >= 0) this.mockAssets.splice(idx, 1);
    return { success: idx >= 0 };
  }
};
