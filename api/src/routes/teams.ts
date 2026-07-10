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

export const teamsRoutes = {
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
  },

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
  },

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
  },

  async getTeam(id: string): Promise<{
    id: string;
    name: string;
    slug: string;
    ownerId: string;
    createdAt: string;
  } | null> {
    return this.teams.find((t) => t.id === id) || null;
  },

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
};
