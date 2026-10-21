import {
  type ChatSendErrorCode,
  type ChatSendReply,
  type ContractResult,
  chatSendFailure,
  parseChatAnnounceRequest,
  parseChatSendRequest,
  TWITCH_CHAT_ANNOUNCE_SUBJECT,
  TWITCH_CHAT_SEND_SUBJECT,
} from "@woofx3/common/cloudevents/Platform/chat";
import type { HelixCommandArgs, HelixCommandResult } from "@woofx3/common/cloudevents/Twitch/commands";
import { readSentChatMessage } from "./helix";
import { TwitchApiError } from "./twitchApiError";

/** Runs one Helix operation for the linked broadcaster (`TwitchApi.helix`). */
export type ChatHelix = (args: HelixCommandArgs) => Promise<HelixCommandResult>;

/**
 * One provider subject: reads its request and names the Helix operation that
 * says it, or says why the request breaks the contract.
 */
type ChatVerb = (body: unknown) => ContractResult<HelixCommandArgs>;

/**
 * Every subject the twitch service answers as the Twitch chat provider. A new
 * Twitch chat verb is a new entry here; the dispatch below stays as it is.
 */
export const TWITCH_CHAT_VERBS: Readonly<Record<string, ChatVerb>> = {
  [TWITCH_CHAT_SEND_SUBJECT]: (body) => {
    const request = parseChatSendRequest(body);
    if (!request.ok) {
      return request;
    }
    const { message, replyToMessageId } = request.value;
    return {
      ok: true,
      value: { operation: "sendChatMessage", params: { message, reply_parent_message_id: replyToMessageId } },
    };
  },
  [TWITCH_CHAT_ANNOUNCE_SUBJECT]: (body) => {
    const request = parseChatAnnounceRequest(body);
    if (!request.ok) {
      return request;
    }
    const { message, color } = request.value;
    return { ok: true, value: { operation: "sendChatAnnouncement", params: { message, color } } };
  },
};

/**
 * Twitch's status for a refused line, as the contract's code. Helix answers a
 * malformed or oversized line with 400 and a reply to an unknown message
 * with 422; anything else Twitch refuses is its own to explain.
 */
const STATUS_CODES: Readonly<Record<number, ChatSendErrorCode>> = {
  400: "invalid",
  422: "invalid",
  429: "rate_limited",
};

/** Twitch's own reason from an error body (`{ error, status, message }`), or the body as it came. */
function twitchReason(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === "string" && message !== "") {
        return message;
      }
    }
  } catch {
    // Not JSON: Twitch's text is the best reason there is.
  }
  return body;
}

/** The contract reply for what Twitch answered. */
export function chatReplyOf(result: HelixCommandResult): ChatSendReply {
  if (!result.ok) {
    const code = STATUS_CODES[result.status] ?? "upstream";
    return chatSendFailure(code, `Twitch refused the line (HTTP ${result.status}): ${twitchReason(result.body)}`);
  }
  if (result.body === null) {
    return { ok: true, isSent: true };
  }
  const sent = readSentChatMessage(result.body);
  if (sent === undefined) {
    return chatSendFailure("upstream", "Twitch answered with a body that is not a sent chat message");
  }
  return {
    ok: true,
    isSent: sent.isSent,
    ...(sent.messageId !== "" ? { messageId: sent.messageId } : {}),
    ...(sent.dropReason !== undefined ? { dropReason: sent.dropReason } : {}),
  };
}

/**
 * Answer one provider request on `subject`. `helix` is absent while no Twitch
 * account is linked. Never throws: every failure is a contract reply, so the
 * caller always hears why its line was not said.
 */
export async function answerChatRequest(
  subject: string,
  body: unknown,
  helix: ChatHelix | undefined
): Promise<ChatSendReply> {
  if (!Object.hasOwn(TWITCH_CHAT_VERBS, subject)) {
    return chatSendFailure("invalid", `${subject} is not a Twitch chat provider subject`);
  }
  const operation = TWITCH_CHAT_VERBS[subject](body);
  if (!operation.ok) {
    return chatSendFailure("invalid", operation.error);
  }
  if (helix === undefined) {
    return chatSendFailure("not_linked", "Twitch is not linked yet: the streamer has to connect Twitch first");
  }
  try {
    return chatReplyOf(await helix(operation.value));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof TwitchApiError && err.code === "invalid_arguments") {
      return chatSendFailure("invalid", message);
    }
    return chatSendFailure("upstream", message);
  }
}
