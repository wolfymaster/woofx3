import type { PlatformId } from "@woofx3/api/platform-gateway";
import type { ChatCommandEvent } from "@woofx3/common/cloudevents/Chat/commands";
import { extractCommandVariables } from "@woofx3/common/templates/command-variables";
import type { Clock } from "../host/deps";
import { COMMAND_PREFIX } from "./command-prefix";
import type { ChatLine } from "./trust";

export type CommandVisibility = "public" | "restricted";

/**
 * A chat role that runs a command without a permission grant. Lets a
 * built-in command that changes the channel work for the broadcaster and
 * moderators on a fresh engine, where no grant exists yet.
 */
export type ChatRole = "broadcaster" | "moderator";

/** One matched, authorised invocation, as a handler sees it. */
export interface CommandInvocation {
  line: ChatLine;
  commandName: string;
  /** The line with the command token stripped, trimmed. */
  text: string;
  /** `text` split on whitespace; empty when there is none. */
  args: string[];
  /** Named argument_pattern captures; see extractCommandVariables. */
  variables: Record<string, unknown>;
  /**
   * The invocation's `chat.command.<slug>` event, already announced. A
   * handler that hands the invocation on hands on this same event, so both
   * carry one id.
   */
  event: ChatCommandEvent;
}

/** Runs a command. The text it resolves to is replied to the line; an empty string says nothing. */
export type CommandHandler = (invocation: CommandInvocation) => Promise<string>;

export interface CommandDefinition {
  name: string;
  handler: CommandHandler;
  visibility: CommandVisibility;
  /** Seconds between runs of the command, for everyone; 0 never throttles. */
  cooldownSeconds: number;
  /** Ordered `{variable}` names from the command's argument_pattern. */
  variables: readonly string[];
  /** Roles that pass without the permission check; everyone else still goes through it. */
  allowRoles: readonly ChatRole[];
  /** The platforms the command runs on; undefined runs it on every platform. */
  platforms?: readonly PlatformId[];
}

/** Where a command's reply goes. The dispatcher's replies all go through the platform gateway. */
export interface ChatReplier {
  /** Never rejects: a reply that could not be sent is logged by the replier. */
  reply(line: ChatLine, commandName: string, text: string): Promise<void>;
}

/** A line that names a command: the name after the prefix, and the rest. */
export interface CommandCall {
  name: string;
  text: string;
}

/** Reads `!name rest of line`. Null for a line that does not start with the prefix or names nothing. */
export function parseCommandCall(line: string): CommandCall | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(COMMAND_PREFIX)) {
    return null;
  }
  const body = trimmed.slice(COMMAND_PREFIX.length);
  const space = body.search(/\s/);
  const name = space === -1 ? body : body.slice(0, space);
  if (name === "") {
    return null;
  }
  return { name, text: space === -1 ? "" : body.slice(space).trim() };
}

export interface CommandMatch {
  definition: CommandDefinition;
  call: CommandCall;
  args: string[];
  variables: Record<string, unknown>;
}

/**
 * The commands chat can run, keyed by name. Built-ins are fixed for the
 * table's life and win over a stored command of the same name; stored
 * commands are replaced as the command store reloads them.
 *
 * Cooldowns are kept apart from the definitions, so replacing a command
 * keeps its cooldown running; only removing it forgets it.
 */
export class CommandTable {
  private readonly builtins = new Map<string, CommandDefinition>();
  private readonly stored = new Map<string, CommandDefinition>();
  /** Command name to the clock time of its last run. */
  private readonly lastRunAt = new Map<string, number>();

  constructor(
    builtins: readonly CommandDefinition[],
    private readonly clock: Clock
  ) {
    for (const definition of builtins) {
      assertDefinition(definition);
      if (this.builtins.has(definition.name)) {
        throw new Error(`the built-in command "${definition.name}" is registered twice`);
      }
      this.builtins.set(definition.name, definition);
    }
  }

  /** Stored command names, for the store's diff and for tests. */
  storedNames(): string[] {
    return [...this.stored.keys()];
  }

  setStored(definition: CommandDefinition): void {
    assertDefinition(definition);
    this.stored.set(definition.name, definition);
  }

  removeStored(name: string): void {
    this.stored.delete(name);
    if (!this.builtins.has(name)) {
      this.lastRunAt.delete(name);
    }
  }

  isBuiltin(name: string): boolean {
    return this.builtins.has(name);
  }

  /** The command a line runs on its platform, or null when it names none. */
  match(text: string, platform: PlatformId): CommandMatch | null {
    const call = parseCommandCall(text);
    if (call === null) {
      return null;
    }
    const definition = this.builtins.get(call.name) ?? this.stored.get(call.name);
    if (definition === undefined) {
      return null;
    }
    if (definition.platforms !== undefined && !definition.platforms.includes(platform)) {
      return null;
    }
    return {
      definition,
      call,
      args: call.text === "" ? [] : call.text.split(/\s+/),
      variables: extractCommandVariables([...definition.variables], call.text),
    };
  }

  /**
   * Starts the command's cooldown and returns true, or returns false while
   * it is still cooling down. Synchronous, so two lines racing for one
   * command cannot both pass.
   */
  takeCooldown(definition: CommandDefinition): boolean {
    if (definition.cooldownSeconds <= 0) {
      return true;
    }
    const now = this.clock.now();
    const last = this.lastRunAt.get(definition.name);
    if (last !== undefined && now - last < definition.cooldownSeconds * 1000) {
      return false;
    }
    this.lastRunAt.set(definition.name, now);
    return true;
  }
}

function assertDefinition(definition: CommandDefinition): void {
  if (definition.name === "" || /\s/.test(definition.name) || definition.name.startsWith(COMMAND_PREFIX)) {
    throw new Error(`a command name must be one word without the prefix, got ${JSON.stringify(definition.name)}`);
  }
  if (!(Number.isFinite(definition.cooldownSeconds) && definition.cooldownSeconds >= 0)) {
    throw new Error(`the command "${definition.name}" has a cooldown below 0: ${definition.cooldownSeconds}`);
  }
}
