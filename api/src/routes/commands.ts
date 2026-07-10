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

export const commandsRoutes = {
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
  },

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
  },

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
  },

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
  },

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
  },

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

    const response = await this.db.setSetting("twitch_token", JSON.stringify(token), "", engineUserId);
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
  },

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
  },

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
  },

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
};
