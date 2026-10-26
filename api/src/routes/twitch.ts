import type {
  TwitchAddBlockedTermParams,
  TwitchBanUserParams,
  TwitchChatPinParams,
  TwitchCreateStreamMarkerParams,
  TwitchGetBlockedTermsParams,
  TwitchGetChattersParams,
  TwitchGetGamesParams,
  TwitchGetUsersParams,
  TwitchHelixResult,
  TwitchModifyChannelInformationParams,
  TwitchRemoveBlockedTermParams,
  TwitchSearchCategoriesParams,
  TwitchSendChatAnnouncementParams,
  TwitchSendChatMessageParams,
  TwitchSendShoutoutParams,
  TwitchUnbanUserParams,
  TwitchUpdateChatSettingsParams,
} from "@woofx3/api";
import {
  HELIX_COMMAND,
  type HelixCommandArgs,
  type HelixOperationName,
  TWITCHAPI_ERROR_TYPE,
  TWITCHAPI_REPLY_CODES,
  TWITCHAPI_SUBJECT,
  type TwitchApiReplyCode,
  twitchApiResultType,
} from "@woofx3/common/cloudevents/Twitch/commands";
import type { SharedLogger } from "@woofx3/common/logging";
import { requestFailureKind } from "@woofx3/nats";
import type NATSClient from "@woofx3/nats/src/client";
import { routeModule } from "./context";

/** Long enough for a token renewal and the resend after a 401; the same wait `ctx.twitch` gives. */
export const TWITCH_HELIX_TIMEOUT_MS = 10_000;

/**
 * The code connectors answers with while the twitch adapter is linked but
 * turned off, starting or parked. Its own message may name host internals,
 * so callers get this one under `unavailable`.
 */
const INTEGRATION_UNAVAILABLE_CODE: TwitchApiReplyCode = "integration_unavailable";
const INTEGRATION_UNAVAILABLE_MESSAGE = "Twitch is turned off or not running in this engine";

type Requester = Pick<NATSClient, "request">;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function replyCode(value: unknown): TwitchApiReplyCode | null {
  return TWITCHAPI_REPLY_CODES.find((code) => code === value) ?? null;
}

/** Twitch's `message` from a Helix error body, or "" when the body has none. */
function helixMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    return "";
  }
}

/** The CloudEvent reply from the connectors host's Twitch adapter to a `helix` request, as a result. */
export function readHelixReply(operation: HelixOperationName, raw: unknown): TwitchHelixResult {
  const envelope = typeof raw === "object" && raw !== null ? (raw as { type?: unknown; data?: unknown }) : {};
  const data =
    typeof envelope.data === "object" && envelope.data !== null ? (envelope.data as Record<string, unknown>) : {};
  if (envelope.type === TWITCHAPI_ERROR_TYPE) {
    if (data.code === INTEGRATION_UNAVAILABLE_CODE) {
      return { ok: false, code: "unavailable", error: INTEGRATION_UNAVAILABLE_MESSAGE };
    }
    const error = typeof data.error === "string" && data.error !== "" ? data.error : `${operation} was refused`;
    // The codes a caller can branch on; any other refusal is reported as `failed`.
    const code = replyCode(data.code);
    if (code === "invalid_arguments" || code === "not_linked") {
      return { ok: false, code, error };
    }
    return { ok: false, code: "failed", error };
  }
  if (envelope.type !== twitchApiResultType(HELIX_COMMAND)) {
    return { ok: false, code: "failed", error: `${operation}: Twitch sent an unreadable reply` };
  }
  if (data.ok === true) {
    return { ok: true, body: data.body ?? null };
  }
  if (data.ok === false && typeof data.status === "number" && typeof data.body === "string") {
    const reason = helixMessage(data.body);
    return {
      ok: false,
      code: "helix",
      error: reason ? `Twitch answered ${data.status}: ${reason}` : `Twitch answered ${data.status}`,
      status: data.status,
      body: data.body,
    };
  }
  return { ok: false, code: "failed", error: `${operation}: Twitch sent an unreadable reply` };
}

/**
 * Ask the connectors host's Twitch adapter to perform one Helix operation and wait for its
 * answer. Never throws: every way of not getting Twitch's answer is a
 * result with its own code, since an RPC error would lose the code.
 */
export async function requestHelix(
  nats: Requester | null,
  logger: SharedLogger,
  operation: HelixOperationName,
  params: unknown
): Promise<TwitchHelixResult> {
  if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) {
    return { ok: false, code: "invalid_arguments", error: `${operation}: params must be an object` };
  }
  if (!nats) {
    return { ok: false, code: "unavailable", error: "Twitch cannot be reached right now" };
  }
  const args: HelixCommandArgs = { operation, params: params as Record<string, unknown> | undefined };
  const payload = new TextEncoder().encode(JSON.stringify({ command: HELIX_COMMAND, args }));
  let reply: { data: Uint8Array };
  try {
    reply = await nats.request(TWITCHAPI_SUBJECT, payload, { timeout: TWITCH_HELIX_TIMEOUT_MS });
  } catch (err) {
    const failure = requestFailureKind(err);
    if (failure === "timeout") {
      return {
        ok: false,
        code: "timeout",
        error: `Twitch did not answer within ${TWITCH_HELIX_TIMEOUT_MS / 1000}s; it may still have acted`,
      };
    }
    if (failure === "no_responders") {
      return { ok: false, code: "unavailable", error: "Twitch is not connected in this engine" };
    }
    logger.warn("twitch helix request failed", { operation, error: errorMessage(err) });
    return { ok: false, code: "failed", error: `${operation}: ${errorMessage(err)}` };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(reply.data));
  } catch {
    return { ok: false, code: "failed", error: `${operation}: Twitch sent an unreadable reply` };
  }
  return readHelixReply(operation, decoded);
}

export const twitchRoutes = routeModule({
  async twitchGetChannelInformation(): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "getChannelInformation", undefined);
  },

  async twitchGetGames(params: TwitchGetGamesParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "getGames", params);
  },

  async twitchSearchCategories(params: TwitchSearchCategoriesParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "searchCategories", params);
  },

  async twitchModifyChannelInformation(params: TwitchModifyChannelInformationParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "modifyChannelInformation", params);
  },

  async twitchCreateStreamMarker(params: TwitchCreateStreamMarkerParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "createStreamMarker", params);
  },

  async twitchGetAdSchedule(): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "getAdSchedule", undefined);
  },

  async twitchSnoozeNextAd(): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "snoozeNextAd", undefined);
  },

  async twitchGetUsers(params: TwitchGetUsersParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "getUsers", params);
  },

  async twitchGetBlockedTerms(params: TwitchGetBlockedTermsParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "getBlockedTerms", params);
  },

  async twitchAddBlockedTerm(params: TwitchAddBlockedTermParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "addBlockedTerm", params);
  },

  async twitchRemoveBlockedTerm(params: TwitchRemoveBlockedTermParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "removeBlockedTerm", params);
  },

  async twitchBanUser(params: TwitchBanUserParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "banUser", params);
  },

  async twitchUnbanUser(params: TwitchUnbanUserParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "unbanUser", params);
  },

  async twitchGetChatSettings(): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "getChatSettings", undefined);
  },

  async twitchUpdateChatSettings(params: TwitchUpdateChatSettingsParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "updateChatSettings", params);
  },

  async twitchSendChatMessage(params: TwitchSendChatMessageParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "sendChatMessage", params);
  },

  async twitchSendChatAnnouncement(params: TwitchSendChatAnnouncementParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "sendChatAnnouncement", params);
  },

  async twitchSendShoutout(params: TwitchSendShoutoutParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "sendShoutout", params);
  },

  async twitchGetChatters(params: TwitchGetChattersParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "getChatters", params);
  },

  async twitchGetChatPins(): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "getChatPins", undefined);
  },

  async twitchPinChatMessage(params: TwitchChatPinParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "pinChatMessage", params);
  },

  async twitchUnpinChatMessage(params: TwitchChatPinParams): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "unpinChatMessage", params);
  },

  async twitchCreateClip(): Promise<TwitchHelixResult> {
    return requestHelix(this.nats, this.logger, "createClip", undefined);
  },
});
