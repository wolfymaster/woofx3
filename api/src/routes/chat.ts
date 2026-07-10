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

export const chatRoutes = {
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
  },

  async sendChatMessage(accountId: string, message: string): Promise<{ success: boolean; messageId: string }> {
    return { success: true, messageId: `msg-${Date.now()}` };
  },

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
};
