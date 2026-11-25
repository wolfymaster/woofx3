import { platformApiResultType } from "../PlatformApi/reply";

/** The NATS subject the connectors Kick adapter takes `kickapi` commands on, for `ctx.kick`. */
export const KICKAPI_SUBJECT = "kickapi";

/**
 * How long the connectors host holds a `kickapi` request before it answers
 * for the adapter. Below the sandbox's 10 s wait for `ctx.kick` (barkloader
 * `REQUEST_TIMEOUT`), so module code always gets a reply.
 */
export const KICKAPI_SERVED_BUDGET_MS = 9_000;

/**
 * The commands the Kick adapter serves on `kickapi`. Listed rather than read
 * off a client class, so a request can never reach anything else.
 */
export const KICKAPI_COMMANDS = ["getUser", "updateStream", "timeout", "listRewards"] as const;

export type KickApiCommand = (typeof KICKAPI_COMMANDS)[number];

export function isKickApiCommand(value: string): value is KickApiCommand {
  return KICKAPI_COMMANDS.some((command) => command === value);
}

/** The CloudEvent type of a successful reply to `command`. */
export function kickApiResultType(command: KickApiCommand): string {
  return platformApiResultType(KICKAPI_SUBJECT, command);
}

/** Who a command acts on: a Kick user id, or a channel slug (`userName`), exactly one. */
export type KickUserTarget = { userId: string } | { userName: string };

/** `getUser`'s result: the channel and its owner. Kick gives no account age or partner status. */
export interface KickUserInfo {
  userId: string;
  /** The channel slug. */
  login: string;
  displayName: string;
  description: string;
  profileImageUrl: string;
  title: string;
  categoryId: string;
  categoryName: string;
  tags: string[];
  language: string;
  isLive: boolean;
  viewerCount: number;
  /** RFC 3339, empty while offline. */
  streamStartedAt: string;
}

export type UpdateStreamArgs = { title?: string; category?: string; tags?: string[] };

/** What `updateStream` changed. */
export interface UpdateStreamResult {
  title?: string;
  categoryId?: string;
  categoryName?: string;
  tags?: string[];
}

export type TimeoutArgs = KickUserTarget & { durationSeconds: number; reason?: string };

/** Kick counts a timeout in whole minutes, so `durationSeconds` is what was applied: the minutes times 60. */
export interface TimeoutResult {
  userId: string;
  durationSeconds: number;
}

/** `listRewards`'s result, as a picker's options. */
export type RewardOption = { value: string; label: string };
