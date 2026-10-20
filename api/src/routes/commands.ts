import type {
  ActionStep,
  AvailableFunction,
  CommandSnapshot,
  CreateCommandInput,
  TwitchAccessToken,
  UpdateCommandInput,
} from "@woofx3/api";
import { TRIGGER_TYPE_COMMAND, type TaskDefinition } from "@woofx3/api/workflow-definition";
import { EngineEventType } from "@woofx3/api/webhooks";
import ActionEvents from "@woofx3/common/cloudevents/Action";
import ChatCommandEvents from "@woofx3/common/cloudevents/Chat/commands";
import CommandEvents from "@woofx3/common/cloudevents/Command";
import { commandNameToSubjectSegment } from "@woofx3/common/cloudevents/slug";
import {
  extractCommandVariables,
  invalidCommandVariableNames,
  parseCommandVariables,
} from "@woofx3/common/templates/command-variables";
import type * as command from "@woofx3/db/command.pb";
import { selectStrategy } from "@woofx3/twitch/token-strategy";
import { isPermissionDenied } from "../db-client";
import { assertValidWorkflowDefinition } from "../workflow/validate-definition";
import { routeModule } from "./context";
import { commandToSnapshot, parseActions } from "./helpers";

// The factories hold nothing but the CloudEvent `source`, so one instance each
// serves every call in this module.
const commandEvents = new CommandEvents("api");
const chatCommandEvents = new ChatCommandEvents("api");
const actionEvents = new ActionEvents("api");

/** How many steps a command runs, for a listing that shows no detail. */
function parseStepCount(stepsJson: string | undefined): number {
  if (!stepsJson) {
    return 0;
  }
  try {
    const parsed = JSON.parse(stepsJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Serialize a command's actions for storage, refusing a list the engine could
 * not run.
 *
 * Validated here rather than at run time because a command runs in chat, where
 * a malformed step is a message that silently never arrives; refusing the save
 * puts the error in front of the person who can fix it.
 */
export function serializeActions(actions: ActionStep[] | undefined): string {
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

/**
 * Serialize the tasks of a command's workflow for storage, refusing a list the
 * engine could not run, by the same rules a saved workflow is held to.
 */
export function serializeSteps(commandName: string, steps: TaskDefinition[]): string {
  if (steps.length === 0) {
    return "[]";
  }
  assertValidWorkflowDefinition(
    {
      id: "command",
      name: `!${commandName}`,
      trigger: { type: TRIGGER_TYPE_COMMAND, event: `chat.command.${commandNameToSubjectSegment(commandName)}` },
      tasks: steps,
    },
    { allowCommandTrigger: true }
  );
  return JSON.stringify(steps);
}

/**
 * The steps fields of a create or update: `steps` when given, else `actions`.
 * On an update, neither leaves the command's steps as they are, which the db
 * proxy reads from an absent stepsJson and an empty actionsJson.
 */
function stepsFields(
  commandName: string,
  input: { steps?: TaskDefinition[]; actions?: ActionStep[] }
): { stepsJson?: string; actionsJson: string } {
  if (input.steps !== undefined) {
    return { stepsJson: serializeSteps(commandName, input.steps), actionsJson: "" };
  }
  if (input.actions !== undefined) {
    return { actionsJson: serializeActions(input.actions) };
  }
  return { actionsJson: "" };
}

export const commandsRoutes = routeModule({
  async listCommands(): Promise<CommandSnapshot[]> {
    const commands = await this.db.listCommands({
      includeDisabled: true,
    });
    // One command whose steps cannot be read is left out, rather than shown
    // with none: saving that back would delete them (see parseSteps).
    const snapshots: CommandSnapshot[] = [];
    for (const c of commands) {
      try {
        snapshots.push(commandToSnapshot(c));
      } catch (err) {
        this.logger.error("Command left out of the listing", {
          id: c.id,
          command: c.command,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return snapshots;
  },

  async getAvailableCommands(_username?: string): Promise<{
    commands: Array<{
      id: string;
      name: string;
      /** How many steps it runs. The steps themselves are on listCommands. */
      stepCount: number;
      cooldown: number;
      enabled: boolean;
    }>;
  }> {
    this.logger.info("Getting available commands", { username: _username });
    const req: command.ListCommandsRequest = {
      includeDisabled: false,
    };
    const commands = await this.db.listCommands(req);

    return {
      commands: commands.map((cmd) => ({
        id: cmd.id,
        name: cmd.command,
        stepCount: parseStepCount(cmd.workflowId ? cmd.stepsJson : cmd.actionsJson),
        cooldown: cmd.cooldown,
        enabled: cmd.enabled,
      })),
    };
  },

  /**
   * Run a chat command as though `username` had typed `!<commandName> <text>`
   * in chat. `text` is everything after the command word; it is split into
   * `args` and matched against the command's `argumentPattern` exactly as a
   * chat message is, so the command's actions and any workflow triggered by it
   * cannot tell the two apart.
   *
   * Mirrors woofwoofwoof's dispatch on a chat match: the `chat.command.<slug>`
   * event always, and the command's workflow, run by id, or the actions of a
   * command that has none, both reading that same event. Cooldown is not
   * applied -- it throttles chat, and a caller of this API is already
   * authorized by name.
   *
   * The two are separate publishes, and the command's own run goes first: when
   * it fails, nothing has been announced, so the caller can retry without
   * workflows listening for the command reacting twice. The reverse cannot be
   * avoided -- once the run is published, a failed announcement means a retry
   * runs the command's steps again -- so that failure says so.
   */
  async executeCommand(
    commandName: string,
    username: string,
    text = ""
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.info("Executing command", { commandName, username });
    // Get the command. This doubles as the authorization gate: db-proxy runs
    // the command's group/user grants through Casbin inside GetCommand and
    // rejects the call outright when `username` is not permitted, so a denial
    // can never reach the publish below. Enforcement deliberately lives there
    // rather than here - woofwoofwoof's chat path checks the same policy rows,
    // and duplicating the decision in this service would let the two drift.
    const cmdReq: command.GetCommandRequest = {
      command: commandName,
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

    const remainder = text.trim();
    const event = chatCommandEvents.event(
      cmd.command,
      {
        args: remainder.length > 0 ? remainder.split(/\s+/) : [],
        rawMessage: remainder.length > 0 ? `!${cmd.command} ${remainder}` : `!${cmd.command}`,
        text: remainder,
        variables: extractCommandVariables(parseCommandVariables(cmd.argumentPattern ?? ""), remainder),
        chatter: username,
        platform: "twitch",
      },
      { platform: "twitch", triggeredBy: "dashboard" }
    );

    const actions = cmd.workflowId ? [] : parseActions(cmd.actionsJson);
    if (cmd.workflowId) {
      await this.publishEventTuple(commandEvents.executeWorkflow({ workflowId: cmd.workflowId, event }));
    } else if (actions.length > 0) {
      await this.publishEventTuple(actionEvents.execute({ label: `command:${cmd.command}`, actions, event }));
    }

    try {
      await this.publishEventTuple(chatCommandEvents.encode(event));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Command "${commandName}" ran its steps, but announcing it failed, so workflows listening for it did not run; ` +
          `running it again runs its steps again: ${detail}`
      );
    }

    this.logger.info("Command executed", {
      commandName,
      username,
      workflowId: cmd.workflowId || undefined,
      actions: actions.length,
    });
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

    const created = await this.db.createCommand({
      command: input.command,
      enabled: input.enabled,
      cooldown: input.cooldown,
      stepsJson: "",
      ...stepsFields(input.command, input),
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
      ...stepsFields(input.command, input),
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
      correlationKey: input.correlationKey,
      command: snapshot,
    });
    this.logger.info("Command updated", { id: snapshot.id, command: snapshot.command });
    return snapshot;
  },

  /**
   * Persist the broadcaster's Twitch OAuth token in the engine's
   * settings table. The Twitch service reads this on bootstrap (see
   * `shared/clients/typescript/twitch/index.ts`).
   *
   * A token carrying the Twitch app's `clientId` comes from a dashboard that
   * keeps the refresh token itself. It is stored with the engine client id of
   * that dashboard (`context.clientId`, the session's), which is the one
   * asked for the next token (`TwitchTokenSource`).
   *
   * `convexUserId` (when supplied) is the Convex user that initiated the
   * connect flow; we resolve it to the engine-side user UUID via
   * `findOrCreateByWoofx3UIUserId`, then write that UUID to
   * `settings.user_id` so the row is scoped to the owning user. The Twitch broadcaster id stays inside the JSON value
   * because that's what Twurple's `addUserForToken` parses out of
   * `AccessTokenWithUserId` on bootstrap.
   */
  async setTwitchToken(
    token: TwitchAccessToken,
    convexUserId?: string,
    context?: { clientId: string }
  ): Promise<{ ok: true }> {
    let engineUserId: string | undefined;
    if (convexUserId) {
      const engineUser = await this.db.findOrCreateByWoofx3UIUserId(convexUserId);
      engineUserId = engineUser.id;
    }
    const fromDashboard = selectStrategy(token) === "dashboard";
    if (fromDashboard && !context?.clientId) {
      throw new Error("A Twitch token from a dashboard needs the session's client id to renew it");
    }
    const stored = fromDashboard ? { ...token, dashboardClientId: context?.clientId } : token;
    await this.storeTwitchToken(stored, engineUserId);
    this.logger.info("Twitch token written to settings", {
      twitchUserId: token.userId,
      engineUserId: engineUserId ?? "(unscoped)",
    });
    return { ok: true };
  },

  /**
   * Clear the broadcaster's Twitch OAuth token. Used by the UI's
   * "Disconnect Twitch" flow. Writes an empty string rather than
   * deleting the row so the bootstrap's `if (!token)` check trips
   * cleanly without needing to handle a missing row.
   */
  async deleteTwitchToken(): Promise<{ ok: true }> {
    await this.db.setSetting("twitch_token", "");
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
    const existing = (await this.db.listCommands({ includeDisabled: true })).find((c) => c.id === id);
    if (!existing) {
      throw new Error(`Command not found: ${id}`);
    }

    await this.db.deleteCommand({ id });

    await this.publishEventTuple(commandEvents.deleted({ id, command: existing.command }));
    void this.emitCommandWebhook({
      type: EngineEventType.COMMAND_DELETED,
      correlationKey,
      commandId: id,
    });
    this.logger.info("Command deleted", { id });
    return { deleted: true };
  },
});
