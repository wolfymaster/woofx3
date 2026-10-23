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
 * permission rows key on. The decision is cached by everything it was read
 * with: whether the line was trusted, the viewer id, the login and the
 * command. An untrusted line names its own id and login, and they need not
 * belong together, so it can never fill in a decision a trusted line reads.
 *
 * An untrusted line's login is still taken at its word for the grant
 * lookup, so a bus publisher naming a granted login runs that command. Bus
 * publishers are not authenticated per identity yet; until they are, a
 * grant only holds as far as the bus is trusted.
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
    const key = permissionCacheKey(line, commandName);
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

function permissionCacheKey(line: ChatLine, commandName: string): string {
  const trust = line.trusted ? "trusted" : "untrusted";
  return `${trust} ${viewerKeyString(line.viewer)} ${line.chatterLogin} ${commandName}`;
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
