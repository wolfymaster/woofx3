import type { ActionStep } from "@woofx3/common/cloudevents/Action";
import type { ChatCommandEvent } from "@woofx3/common/cloudevents/Chat/commands";
import { parseCommandVariables } from "@woofx3/common/templates/command-variables";
import { errorMessage, type Logger, type TimerHandle, type Timers } from "../host/deps";
import type { CommandDefinition, CommandTable } from "./commands";
import type { DispatcherDb, StoredCommand } from "./db-client";

/** What a stored command does once it matched and passed its checks. Implemented over the bus by the dispatcher. */
export interface CommandRunner {
  /** Runs the workflow the command is linked to, for this one invocation. */
  runWorkflow(workflowId: string, event: ChatCommandEvent): Promise<void>;
  /** Runs the command's own actions, which belong to no workflow. */
  runActions(label: string, actions: ActionStep[], event: ChatCommandEvent): Promise<void>;
}

/**
 * The definition a stored command runs as:
 * - linked to a workflow, it runs that workflow and tells chat when it could not;
 * - with actions, it runs them, and any chat reply is one of those actions;
 * - with neither, it only announces itself on `chat.command.<slug>`.
 */
export function storedCommandDefinition(
  stored: StoredCommand,
  runner: CommandRunner,
  logger: Logger
): CommandDefinition {
  const base = {
    name: stored.command,
    visibility: stored.visibility === "public" ? ("public" as const) : ("restricted" as const),
    cooldownSeconds: stored.cooldown,
    variables: parseCommandVariables(stored.argumentPattern),
    allowRoles: [],
  };
  if (stored.workflowId !== "") {
    const workflowId = stored.workflowId;
    return {
      ...base,
      handler: async ({ event }) => {
        try {
          await runner.runWorkflow(workflowId, event);
        } catch (error) {
          logger.error("could not run a command's workflow", {
            command: stored.command,
            workflowId,
            error: errorMessage(error),
          });
          return `Could not run !${stored.command} right now`;
        }
        return "";
      },
    };
  }
  const actions = parseCommandActions(stored, logger);
  return {
    ...base,
    handler: async ({ event }) => {
      if (actions.length === 0) {
        return "";
      }
      try {
        await runner.runActions(`command:${stored.command}`, actions, event);
      } catch (error) {
        logger.error("could not run a command's actions", { command: stored.command, error: errorMessage(error) });
      }
      return "";
    },
  };
}

/**
 * A command's actions as stored: JSON text holding a list of steps, like a
 * workflow's. Text that is not such a list runs nothing rather than taking the command down with it;
 * the command still matches and still announces itself.
 */
function parseCommandActions(stored: StoredCommand, logger: Logger): ActionStep[] {
  if (stored.actionsJson === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored.actionsJson);
  } catch (error) {
    logger.error("a command's actions are unreadable; none run", {
      command: stored.command,
      error: errorMessage(error),
    });
    return [];
  }
  if (!Array.isArray(parsed)) {
    logger.error("a command's actions are unreadable; none run", {
      command: stored.command,
      error: "the actions are not a list",
    });
    return [];
  }
  if (!parsed.every(isActionStepShaped)) {
    logger.error("a command's actions are unreadable; none run", {
      command: stored.command,
      error: "an action names no action type",
    });
    return [];
  }
  return parsed;
}

/** Only what the dispatcher relies on; the action runner validates each step's own fields. */
function isActionStepShaped(value: unknown): value is ActionStep {
  return typeof value === "object" && value !== null && typeof (value as { action?: unknown }).action === "string";
}

export interface CommandStoreConfig {
  /** How long a command event waits for more before the table is reloaded. */
  reloadDebounceMs: number;
  /** How often the table is reloaded with no event, to heal a missed or failed reload. */
  reloadBackstopMs: number;
}

export interface CommandStoreDeps {
  config: CommandStoreConfig;
  db: Pick<DispatcherDb, "listCommands">;
  table: CommandTable;
  define: (stored: StoredCommand) => CommandDefinition;
  timers: Timers;
  logger: Logger;
}

interface Applied {
  name: string;
  fingerprint: string;
}

/**
 * Keeps the table's stored commands in step with db-proxy, the owner of the
 * data. A command event is only a signal: anything on the bus can publish
 * one, so the snapshot it carries is never applied.
 *
 * Every reload reads the whole listing and applies the difference by
 * command id. Reloads run one at a time, in order, and events that arrive
 * during one coalesce into one more. A failed reload leaves the last good
 * table in place; the next event or the backstop reads it again.
 */
export class CommandStore {
  private readonly applied = new Map<string, Applied>();
  private debounce: TimerHandle | undefined;
  private backstop: TimerHandle | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private stopped = false;

  constructor(private readonly deps: CommandStoreDeps) {
    for (const [key, value] of Object.entries(deps.config)) {
      if (!(Number.isInteger(value) && value > 0)) {
        throw new Error(`the command store's ${key} must be a whole number of milliseconds above 0, got ${value}`);
      }
    }
  }

  /** Loads the table once and starts the backstop. Throws when the first load fails. */
  async start(): Promise<void> {
    if (this.backstop !== undefined || this.stopped) {
      throw new Error("the command store can start once");
    }
    const commands = await this.deps.db.listCommands();
    this.apply(commands);
    this.backstop = this.deps.timers.setInterval(() => this.trigger(), this.deps.config.reloadBackstopMs);
  }

  /** Reloads after the debounce; a burst of events costs one listing. */
  requestReload(): void {
    if (this.stopped) {
      return;
    }
    if (this.debounce !== undefined) {
      this.deps.timers.clearTimeout(this.debounce);
    }
    this.debounce = this.deps.timers.setTimeout(() => {
      this.debounce = undefined;
      this.trigger();
    }, this.deps.config.reloadDebounceMs);
  }

  /** Cancels pending reloads and waits for a running one. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.debounce !== undefined) {
      this.deps.timers.clearTimeout(this.debounce);
      this.debounce = undefined;
    }
    if (this.backstop !== undefined) {
      this.deps.timers.clearInterval(this.backstop);
      this.backstop = undefined;
    }
    await this.running;
  }

  /** Resolves once no reload is running. For tests. */
  async idle(): Promise<void> {
    await this.running;
  }

  private trigger(): void {
    if (this.stopped) {
      return;
    }
    if (this.running !== undefined) {
      this.again = true;
      return;
    }
    this.running = this.loop();
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      await this.reloadOnce();
    } while (this.again && !this.stopped);
    this.running = undefined;
  }

  private async reloadOnce(): Promise<void> {
    let commands: StoredCommand[];
    try {
      commands = await this.deps.db.listCommands();
    } catch (error) {
      this.deps.logger.error("could not reload chat commands; keeping the last good table", {
        error: errorMessage(error),
      });
      return;
    }
    if (!this.stopped) {
      this.apply(commands);
    }
  }

  /** Removals first, so a command renamed to another's old name is not removed after it was set. */
  private apply(commands: readonly StoredCommand[]): void {
    const listed = new Map(commands.map((command) => [command.id, command]));
    for (const [id, applied] of this.applied) {
      const next = listed.get(id);
      if (next === undefined || next.command !== applied.name) {
        this.deps.table.removeStored(applied.name);
        this.applied.delete(id);
      }
    }
    for (const [id, command] of listed) {
      const fingerprint = commandFingerprint(command);
      if (this.applied.get(id)?.fingerprint === fingerprint) {
        continue;
      }
      if (this.deps.table.isBuiltin(command.command)) {
        this.deps.logger.warn("a stored command has a built-in command's name; the built-in runs", {
          command: command.command,
        });
      }
      try {
        this.deps.table.setStored(this.deps.define(command));
      } catch (error) {
        // One unusable row must not keep every other command from loading.
        this.deps.logger.error("skipped a stored chat command that cannot run", {
          id,
          command: command.command,
          error: errorMessage(error),
        });
        continue;
      }
      this.applied.set(id, { name: command.command, fingerprint });
    }
  }
}

/** The fields a definition is built from; a row whose fingerprint is unchanged is not rebuilt. */
function commandFingerprint(command: StoredCommand): string {
  return JSON.stringify([
    command.command,
    command.visibility,
    command.cooldown,
    command.argumentPattern,
    command.workflowId,
    command.actionsJson,
  ]);
}
