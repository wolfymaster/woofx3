import type { ShoutoutEnqueueRequestedEvent } from "@woofx3/api/webhooks";
import { encodeCommand, err, ok, type ParseResult } from "../utils";

/** The NATS subject the connectors host's Twitch adapter takes `twitchapi` commands on. */
export const TWITCHAPI_SUBJECT = "twitchapi";

/**
 * Request/reply subject the api answers by queueing a shoutout on the
 * dashboard that holds the Twitch link; the twitch adapter asks on it. The
 * request is a `ShoutoutEnqueueTarget`, the reply a `ShoutoutEnqueueReply`.
 */
export const SHOUTOUT_ENQUEUE_SUBJECT = "engine.shoutout.enqueue";

/** Who to shout out, as a `SHOUTOUT_ENQUEUE_SUBJECT` request. */
export type ShoutoutEnqueueTarget = Omit<ShoutoutEnqueueRequestedEvent, "type">;

/**
 * `queued`: the dashboard has it. `unavailable`: there is no dashboard queue
 * for this engine, because its Twitch link is its own, so the caller sends
 * the shoutout itself. `error`: there is a queue but it could not be reached
 * or refused, and the shoutout was not sent.
 */
export type ShoutoutEnqueueReply =
  | { queued: { position: number; alreadyQueued: boolean } }
  | { unavailable: string }
  | { error: string };

/** Reads a `SHOUTOUT_ENQUEUE_SUBJECT` reply, refusing anything that is not one. */
export function parseShoutoutEnqueueReply(body: unknown): ParseResult<ShoutoutEnqueueReply> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return err("is not an object");
  }
  const { queued, unavailable, error } = body as Record<string, unknown>;
  if (typeof error === "string") {
    return ok({ error });
  }
  if (typeof unavailable === "string") {
    return ok({ unavailable });
  }
  if (typeof queued === "object" && queued !== null) {
    const { position, alreadyQueued } = queued as Record<string, unknown>;
    if (typeof position === "number") {
      return ok({ queued: { position, alreadyQueued: alreadyQueued === true } });
    }
  }
  return err("is malformed");
}

/**
 * How long the connectors host holds a `twitchapi` request before it answers
 * for the adapter, time spent held while the adapter starts included. A
 * caller waiting less than this reports "no answer" for calls the adapter
 * would still have answered. Above HELIX_DEADLINE_MS, so a Helix call reports
 * its own timeout first, and below the wait of the api and the sandbox, so
 * those callers always get a reply.
 */
export const TWITCHAPI_SERVED_BUDGET_MS = 9_000;

/** The CloudEvent type of every `twitchapi` refusal. */
export const TWITCHAPI_ERROR_TYPE = "twitchapi.error";

/**
 * Every `code` a `twitchapi.error` reply can carry: an actionable Twitch
 * refusal, `not_linked` (no Twitch account is linked), or
 * `integration_unavailable` (linked, but the adapter is turned off or not
 * running). The connectors host sends the last two for any command while the
 * adapter is down; the adapter itself sends `not_linked` for `helix` only.
 */
export const TWITCHAPI_REPLY_CODES = [
  "missing_scope",
  "unauthorized",
  "rate_limited",
  "invalid_arguments",
  "not_linked",
  "integration_unavailable",
] as const;

export type TwitchApiReplyCode = (typeof TWITCHAPI_REPLY_CODES)[number];

/**
 * The commands the connectors host's Twitch adapter serves on the `twitchapi` subject. Listed
 * rather than read off its client class, so a request can never reach a
 * private helper or `constructor`.
 */
export const TWITCHAPI_COMMANDS = [
  "clip",
  "listChannelPointRewards",
  "shoutout",
  "addChannelModerator",
  "timeout",
  "updateStream",
  "createMarker",
  "searchCategories",
  "getStreamInfo",
  "getUser",
  "getAdSchedule",
  "snoozeNextAd",
  "helix",
] as const;

export type TwitchApiCommand = (typeof TWITCHAPI_COMMANDS)[number];

/** The CloudEvent type of a successful reply to `twitchapi` command `command`. */
export function twitchApiResultType(command: TwitchApiCommand): string {
  return `twitchapi.${command}.result`;
}

/**
 * Argument shapes of the `twitchapi` commands. The connectors host's Twitch adapter
 * (connectors/src/adapters/twitch/lib/twitch.ts) is the authority on them and validates each.
 */
export interface TimeoutArgs {
  userId?: string;
  userName?: string;
  durationSeconds: number;
  reason?: string;
}

export interface UpdateStreamArgs {
  title?: string;
  /** Free text, resolved through Twitch's category search. */
  category?: string;
  categoryId?: string;
  tags?: string[];
}

export interface CreateMarkerArgs {
  description?: string;
}

/**
 * The `twitchapi` command that performs one declared Helix operation and
 * answers with Helix's own result, for a caller that interprets Helix
 * responses itself.
 */
export const HELIX_COMMAND = "helix";

/**
 * The Helix operations `helix` performs. connectors/src/adapters/twitch/lib/helix.ts declares
 * each one's endpoint and the parameters a caller may set.
 */
export type HelixOperationName =
  | "getChannelInformation"
  | "getGames"
  | "searchCategories"
  | "modifyChannelInformation"
  | "createStreamMarker"
  | "getAdSchedule"
  | "snoozeNextAd"
  | "getUsers"
  | "getBlockedTerms"
  | "addBlockedTerm"
  | "removeBlockedTerm"
  | "banUser"
  | "unbanUser"
  | "getChatSettings"
  | "updateChatSettings"
  | "sendChatMessage"
  | "sendChatAnnouncement"
  | "sendShoutout"
  | "getChatters"
  | "getChatPins"
  | "pinChatMessage"
  | "unpinChatMessage"
  | "createClip";

export interface HelixCommandArgs {
  operation: HelixOperationName;
  /** By Helix's own names. The linked broadcaster's ids are filled in by the connectors host's Twitch adapter. */
  params?: Record<string, unknown>;
}

/**
 * What `helix` answers when Twitch answered. `body` is Helix's JSON body
 * unchanged, null when it sent none (204). A non-2xx answer is a result, not
 * a refusal: `body` is then Twitch's error body as text, for the caller to
 * read Twitch's reason from.
 */
export type HelixCommandResult = { ok: true; body: unknown } | { ok: false; status: number; body: string };

type EventTuple = [string, Uint8Array];

export default class TwitchApiEvents {
  timeout(args: TimeoutArgs): EventTuple {
    return [TWITCHAPI_SUBJECT, encodeCommand({ command: "timeout", args })];
  }

  updateStream(args: UpdateStreamArgs): EventTuple {
    return [TWITCHAPI_SUBJECT, encodeCommand({ command: "updateStream", args })];
  }

  createMarker(args: CreateMarkerArgs): EventTuple {
    return [TWITCHAPI_SUBJECT, encodeCommand({ command: "createMarker", args })];
  }
}
