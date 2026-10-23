import { errorMessage, type Logger, type RandomSource } from "../host/deps";
import type { ChatRole, CommandDefinition, CommandHandler } from "./commands";
import type { DispatcherDb } from "./db-client";
import { failureReply, type TwitchApiPort } from "./twitchapi-client";

/** The longest !vanish timeout, in seconds; the duration is drawn from 1 to this. */
export const VANISH_MAX_SECONDS = 600;

/** The resource and role !grantcommands hands out: every command, as a moderator. */
export const COMMAND_GRANT_RESOURCE = "command/*";
export const COMMAND_GRANT_ROLE = "moderator";

/** A Twitch login: lowercase letters, digits and underscores, 1 to 25 long. */
const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/;

/** Who may run the commands that change the channel without a grant. */
const CHANNEL_EDITOR_ROLES: readonly ChatRole[] = ["broadcaster", "moderator"];

export interface BuiltinDeps {
  db: Pick<DispatcherDb, "addUserToResource" | "removeUserFromResource">;
  twitchApi: TwitchApiPort;
  random: RandomSource;
  logger: Logger;
}

/** `h:mm:ss` for a position into the broadcast. */
export function formatStreamPosition(positionSeconds: number): string {
  const hours = Math.floor(positionSeconds / 3600);
  const minutes = Math.floor((positionSeconds % 3600) / 60);
  const seconds = Math.floor(positionSeconds % 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** The login a grant command names, or null when the text is not exactly one valid login. */
function parseLogin(args: readonly string[]): string | null {
  if (args.length !== 1) {
    return null;
  }
  const login = args[0].replace(/^@/, "").toLowerCase();
  return LOGIN_PATTERN.test(login) ? login : null;
}

/**
 * The commands every engine has, in the order the table registers them.
 * Registered ahead of stored commands, so a stored command with one of these
 * names never runs. Every handler refuses a line that is not trusted: a
 * simulated line names its own speaker and badges, and must not change
 * grants or the channel.
 */
export function builtinCommands(deps: BuiltinDeps): CommandDefinition[] {
  const guard = (name: string, handler: CommandHandler): CommandHandler => {
    return async (invocation) => {
      if (!invocation.line.trusted) {
        deps.logger.warn("a built-in command was refused on a line that is not from the platform", { command: name });
        return "";
      }
      return handler(invocation);
    };
  };

  const grantCommand = (name: string, apply: (login: string) => Promise<void>, doing: string): CommandDefinition => ({
    name,
    visibility: "restricted",
    cooldownSeconds: 0,
    variables: [],
    allowRoles: [],
    handler: guard(name, async ({ args }) => {
      const login = parseLogin(args);
      if (login === null) {
        return `Usage: !${name} <login>`;
      }
      try {
        await apply(login);
      } catch (error) {
        deps.logger.error("a command grant change failed", { command: name, login, error: errorMessage(error) });
        return `Could not ${doing} @${login}`;
      }
      return "";
    }),
  });

  const channelEditor = (name: string, run: CommandHandler): CommandDefinition => ({
    name,
    visibility: "restricted",
    cooldownSeconds: 0,
    variables: [],
    allowRoles: CHANNEL_EDITOR_ROLES,
    platforms: ["twitch"],
    handler: guard(name, run),
  });

  return [
    grantCommand(
      "grantcommands",
      (login) => deps.db.addUserToResource(login, COMMAND_GRANT_RESOURCE, COMMAND_GRANT_ROLE),
      "grant commands to"
    ),
    grantCommand(
      "revokecommands",
      (login) => deps.db.removeUserFromResource(login, COMMAND_GRANT_RESOURCE, COMMAND_GRANT_ROLE),
      "revoke commands from"
    ),
    {
      name: "vanish",
      visibility: "restricted",
      cooldownSeconds: 0,
      variables: [],
      allowRoles: [],
      platforms: ["twitch"],
      handler: guard("vanish", async ({ line }) => {
        const who = `@${line.chatterName}`;
        if (line.membership?.isBroadcaster || line.membership?.isModerator) {
          return `${who} is too important to vanish`;
        }
        // The id, because the name a line carries is the display name, which is not always the login Twitch looks users up by.
        const result = await deps.twitchApi.timeout({
          userId: line.viewer.platformUserId,
          durationSeconds: 1 + Math.floor(deps.random.next() * VANISH_MAX_SECONDS),
        });
        return result.ok ? `*poof* ${who} is gone` : failureReply(`make ${who} vanish`, result.failure);
      }),
    },
    channelEditor("category", async ({ text }) => {
      if (text === "") {
        return "Usage: !category <category name>";
      }
      const result = await deps.twitchApi.updateStream({ category: text });
      return result.ok
        ? `Stream category set to ${result.value.categoryName ?? text}`
        : failureReply("change the category", result.failure);
    }),
    channelEditor("title", async ({ text }) => {
      if (text === "") {
        return "Usage: !title <new stream title>";
      }
      const result = await deps.twitchApi.updateStream({ title: text });
      return result.ok
        ? `Stream title updated to: ${result.value.title ?? text}`
        : failureReply("change the title", result.failure);
    }),
    channelEditor("marker", async ({ text }) => {
      const result = await deps.twitchApi.createMarker({ description: text === "" ? undefined : text });
      return result.ok
        ? `Stream marker placed at ${formatStreamPosition(result.value.positionSeconds)}`
        : failureReply("place a marker", result.failure);
    }),
  ];
}
