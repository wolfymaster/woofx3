import { routeModule } from "./context";
import type {
  ActionStep,
  AvailableFunction,
  CommandSnapshot,
  CreateCommandInput,
  UpdateCommandInput,
} from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import CommandEvents from "@woofx3/common/cloudevents/Command";
import { invalidCommandVariableNames } from "@woofx3/common/templates/command-variables";
import type * as command from "@woofx3/db/command.pb";
import { isPermissionDenied } from "../db-client";
import { commandToSnapshot } from "./helpers";

// The factory holds nothing but the CloudEvent `source`, so one instance serves
// every call in this module.
const commandEvents = new CommandEvents("api");

/**
 * Serialize a command's actions for storage, refusing a list the engine could
 * not run.
 *
 * Validated here rather than at run time because a command runs in chat, where
 * a malformed step is a message that silently never arrives; refusing the save
 * puts the error in front of the person who can fix it.
 */
/** How many actions a command runs, for a listing that shows no detail. */
function parseActionCount(actionsJson: string | undefined): number {
  if (!actionsJson) {
    return 0;
  }
  try {
    const parsed = JSON.parse(actionsJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function serializeActions(actions: ActionStep[] | undefined): string {
  if (!actions || actions.length === 0) {
    return "[]";
  }
  const ids = new Set<string>();
  for (const [index, action] of actions.entries()) {
    if (!action?.action) {
      throw new Error(`Action ${index + 1} names no action to run.`);
    }
    if (action.action === "function" && !action.function) {
      throw new Error(`Action ${index + 1} is a function step with no function to call.`);
    }
    if (action.id) {
      if (ids.has(action.id)) {
        throw new Error(`Two actions share the id "${action.id}".`);
      }
      ids.add(action.id);
    }
  }
  return JSON.stringify(actions);
}

export const commandsRoutes = routeModule({
  async listCommands(): Promise<CommandSnapshot[]> {
    const applicationId = await this.ensureApplicationId();
    const commands = await this.db.listCommands({
      applicationId,
      includeDisabled: true,
    });
    return commands.map((c) => commandToSnapshot(c));
  },

  async getAvailableCommands(_username?: string): Promise<{
    commands: Array<{
      id: string;
      name: string;
      /** How many actions it runs. The list itself is on listCommands. */
      actions: number;
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
    const commands = await this.db.listCommands(req);

    return {
      commands: commands.map((cmd) => ({
        id: cmd.id,
        name: cmd.command,
        actions: parseActionCount(cmd.actionsJson),
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
    // Get the command. This doubles as the authorization gate: db-proxy runs
    // the command's group/user grants through Casbin inside GetCommand and
    // rejects the call outright when `username` is not permitted, so a denial
    // can never reach the publish below. Enforcement deliberately lives there
    // rather than here - woofwoofwoof's chat path checks the same policy rows,
    // and duplicating the decision in this service would let the two drift.
    const cmdReq: command.GetCommandRequest = {
      command: commandName,
      applicationId,
      username,
    };

    let cmd: command.Command;
    try {
      cmd = await this.db.getCommand(cmdReq);
    } catch (err) {
      if (isPermissionDenied(err)) {
        this.logger.info("Command execution denied", { commandName, username });
        throw new Error(`You do not have permission to use "${commandName}"`);
      }
      throw err;
    }

    if (!cmd.enabled) {
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
   * Create a chat command. Persists via dbproxy, publishes an internal
   * `command.created` bus event so consumers (e.g. woofwoofwoof) refresh
   * their in-memory command list without restarting, and fires the
   * external `command.created` webhook so a registered UI callback can
   * observe the change without polling `listCommands()`.
   */
  async createCommand(input: CreateCommandInput): Promise<CommandSnapshot> {
    const argumentPattern = input.argumentPattern ?? "";
    const invalidNames = invalidCommandVariableNames(argumentPattern);
    if (invalidNames.length > 0) {
      throw new Error(
        `Invalid {variable} name(s) in argumentPattern: ${invalidNames.join(", ")}. ` +
          'Each name must be one word or dot-separated words (e.g. "songTitle" or "user.name").'
      );
    }

    const applicationId = await this.ensureApplicationId();

    const created = await this.db.createCommand({
      applicationId,
      command: input.command,
      enabled: input.enabled,
      cooldown: input.cooldown,
      actionsJson: serializeActions(input.actions),
      priority: input.priority ?? 0,
      createdByType: "USER",
      createdByRef: "",
      visibility: input.visibility,
      groupIds: input.groupIds ?? [],
      usernames: input.usernames ?? [],
      argumentPattern,
    });
    const snapshot = commandToSnapshot(created);
    await this.publishEventTuple(commandEvents.created({ command: snapshot }));
    void this.emitCommandWebhook({
      type: EngineEventType.COMMAND_CREATED,
      applicationId,
      correlationKey: input.correlationKey,
      command: snapshot,
    });
    this.logger.info("Command created", { id: snapshot.id, command: snapshot.command });
    return snapshot;
  },

  /**
   * Update a chat command. Full-replace: every field on UpdateCommandInput
   * overwrites the stored row. Emits `command.updated` on success (both
   * the internal bus event and the external webhook).
   */
  async updateCommand(id: string, input: UpdateCommandInput): Promise<CommandSnapshot> {
    const argumentPattern = input.argumentPattern ?? "";
    const invalidNames = invalidCommandVariableNames(argumentPattern);
    if (invalidNames.length > 0) {
      throw new Error(
        `Invalid {variable} name(s) in argumentPattern: ${invalidNames.join(", ")}. ` +
          'Each name must be one word or dot-separated words (e.g. "songTitle" or "user.name").'
      );
    }

    const updated = await this.db.updateCommand({
      id,
      command: input.command,
      enabled: input.enabled,
      cooldown: input.cooldown,
      actionsJson: serializeActions(input.actions),
      priority: input.priority,
      visibility: input.visibility,
      groupIds: input.groupIds ?? [],
      usernames: input.usernames ?? [],
      argumentPattern,
    });
    const snapshot = commandToSnapshot(updated);
    await this.publishEventTuple(commandEvents.updated({ command: snapshot }));
    void this.emitCommandWebhook({
      type: EngineEventType.COMMAND_UPDATED,
      applicationId: snapshot.applicationId,
      correlationKey: input.correlationKey,
      command: snapshot,
    });
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
    await this.db.setSetting("twitch_token", JSON.stringify(token), "", engineUserId);
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
    await this.db.setSetting("twitch_token", "", "");
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
   * Delete a chat command.
   *
   * Reads the command before deleting it, because `command.deleted` carries the
   * name and once the row is gone there is nowhere left to recover it from.
   * db-proxy has no lookup by id — `GetCommand` is keyed by name — so this
   * lists and filters; deleting a command is an operator action, not a hot
   * path, and the alternative is a new RPC for one call site.
   *
   * Deleting an id that does not exist fails rather than reporting success.
   */
  async deleteCommand(id: string, correlationKey?: string): Promise<{ deleted: boolean }> {
    const applicationId = await this.ensureApplicationId();
    const existing = (await this.db.listCommands({ applicationId, includeDisabled: true })).find((c) => c.id === id);
    if (!existing) {
      throw new Error(`Command not found: ${id}`);
    }

    await this.db.deleteCommand({ id });

    await this.publishEventTuple(commandEvents.deleted({ id, applicationId, command: existing.command }));
    void this.emitCommandWebhook({
      type: EngineEventType.COMMAND_DELETED,
      applicationId,
      correlationKey,
      commandId: id,
    });
    this.logger.info("Command deleted", { id });
    return { deleted: true };
  },
});
