import type { Clock } from "../host/deps";
import { BoundedMap } from "./bounded-map";
import type { CommandDefinition } from "./commands";
import type { DispatcherDb, PermissionDecision } from "./db-client";
import type { ChatLine } from "./trust";
import { viewerKeyString } from "./viewer";

export interface AuthCacheConfig {
  capacity: number;
  /** How stale a decision may be after a grant changes. */
  ttlMs: number;
}

/** The permission resource a command is granted on. Must match the object db-proxy grants commands on (db/app/services/command_service.go). */
export function commandResource(commandName: string): string {
  return `command/${commandName}`;
}

/** The action a command grant names; running a command reads it. */
export const COMMAND_PERMISSION_ACTION = "read";

/**
 * Decides who may run a command:
 * - a public command, anyone;
 * - a command with allowRoles, a speaker the platform reported in one of them;
 * - anyone else, a permission grant on the command.
 *
 * Grants are read from db-proxy by the speaker's login, which is what
 * permission rows key on. The decision is cached per viewer id and command,
 * so repeat invocations skip the round trip, and two accounts showing the
 * same display name never share one.
 */
export class CommandPermissions {
  private readonly cache: BoundedMap<string, PermissionDecision>;

  constructor(
    private readonly db: Pick<DispatcherDb, "hasPermission">,
    config: AuthCacheConfig,
    clock: Clock
  ) {
    this.cache = new BoundedMap(config, clock);
  }

  /** Decisions held, expired ones not yet read included. */
  get cached(): number {
    return this.cache.size;
  }

  /** Throws when db-proxy cannot answer; such a failure is not cached. */
  async authorize(definition: CommandDefinition, commandName: string, line: ChatLine): Promise<PermissionDecision> {
    if (definition.visibility === "public") {
      return "granted";
    }
    if (hasRole(line, definition)) {
      return "granted";
    }
    const key = `${viewerKeyString(line.viewer)} ${commandName}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const decision = await this.db.hasPermission(
      line.chatterLogin,
      commandResource(commandName),
      COMMAND_PERMISSION_ACTION
    );
    this.cache.set(key, decision);
    return decision;
  }
}

/** Only a trusted line has membership; an untrusted line's badges never pass a role. */
function hasRole(line: ChatLine, definition: CommandDefinition): boolean {
  const membership = line.membership;
  if (membership === undefined) {
    return false;
  }
  return definition.allowRoles.some((role) =>
    role === "broadcaster" ? membership.isBroadcaster : membership.isModerator
  );
}

/** What chat is told when a speaker may not run a command. */
export function refusalReply(line: ChatLine): string {
  return `${line.chatterName}.... YOU CAN'T DO THAT`;
}
