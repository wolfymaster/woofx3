/**
 * The chat provider contract: how the engine asks a platform's service to say
 * something in that platform's chat. Every outgoing chat line goes through a
 * provider, which owns the platform's credentials and its rate limits; nothing
 * else holds a chat client.
 *
 * Request/reply over the bus on `platform.<platformId>.chat.<verb>`. The
 * `platform.` namespace is reserved for the engine (reserved.go), so a module
 * or a workflow cannot ask a provider to speak on its own account.
 *
 * Must match shared/common/golang/cloudevents/platform_chat.go.
 */

/** Every provider subject starts with this. */
export const PLATFORM_SUBJECT_PREFIX = "platform.";

/** The subject a platform's provider takes chat lines on. */
export function platformChatSendSubject(platformId: string): string {
  return `${PLATFORM_SUBJECT_PREFIX}${platformId}.chat.send`;
}

export const TWITCH_PLATFORM_ID = "twitch";

export const TWITCH_CHAT_SEND_SUBJECT = platformChatSendSubject(TWITCH_PLATFORM_ID);

/** Twitch's announcement: a highlighted line only Twitch has. */
export const TWITCH_CHAT_ANNOUNCE_SUBJECT = `${PLATFORM_SUBJECT_PREFIX}${TWITCH_PLATFORM_ID}.chat.announce`;

export interface ChatSendRequest {
  message: string;
  /** The platform's id of the message this line answers, shown as a reply in chat. */
  replyToMessageId?: string;
}

export const ANNOUNCEMENT_COLORS = ["primary", "blue", "green", "orange", "purple"] as const;

export type AnnouncementColor = (typeof ANNOUNCEMENT_COLORS)[number];

export interface ChatAnnounceRequest {
  message: string;
  /** Twitch's default, the channel's accent color, when absent. */
  color?: AnnouncementColor;
}

/**
 * Why a provider did not send a line:
 * - `not_linked`: the platform account is not connected yet.
 * - `dropped`: the provider refused the line on its own account before asking
 *   the platform. A line the platform itself drops (Twitch's AutoMod, say) is
 *   a reply with `ok: true, isSent: false` instead, since the request worked.
 * - `rate_limited`: the platform asked the caller to slow down.
 * - `invalid`: the request, or the platform's verdict on it, was malformed.
 * - `upstream`: the platform failed or did not answer in time.
 */
export const CHAT_SEND_ERROR_CODES = ["not_linked", "dropped", "rate_limited", "invalid", "upstream"] as const;

export type ChatSendErrorCode = (typeof CHAT_SEND_ERROR_CODES)[number];

export interface ChatSendError {
  code: ChatSendErrorCode;
  message: string;
}

/**
 * A provider's answer to a send or an announce. `messageId` is the platform's
 * id of the line when it reports one (Twitch reports none for an
 * announcement); `dropReason` says why a line the platform accepted was not
 * shown.
 */
export type ChatSendReply =
  | { ok: true; messageId?: string; isSent: boolean; dropReason?: string }
  | { ok: false; error: ChatSendError };

export type ContractResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Refuses any field `allowed` does not name, so a typo is not silently ignored. */
function unknownField(body: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(body).find((key) => !allowed.includes(key));
}

function readMessage(body: Record<string, unknown>): ContractResult<string> {
  const { message } = body;
  if (typeof message !== "string" || message.trim() === "") {
    return { ok: false, error: "message must be a non-empty string" };
  }
  return { ok: true, value: message };
}

const SEND_FIELDS = ["message", "replyToMessageId"] as const;

/** A `platform.<id>.chat.send` request body, checked against the contract. */
export function parseChatSendRequest(body: unknown): ContractResult<ChatSendRequest> {
  if (!isRecord(body)) {
    return { ok: false, error: "request must be a JSON object" };
  }
  const extra = unknownField(body, SEND_FIELDS);
  if (extra !== undefined) {
    return { ok: false, error: `unknown field "${extra}"` };
  }
  const message = readMessage(body);
  if (!message.ok) {
    return message;
  }
  const { replyToMessageId } = body;
  if (replyToMessageId === undefined) {
    return { ok: true, value: { message: message.value } };
  }
  if (typeof replyToMessageId !== "string" || replyToMessageId.trim() === "") {
    return { ok: false, error: "replyToMessageId must be a non-empty string when given" };
  }
  return { ok: true, value: { message: message.value, replyToMessageId } };
}

const ANNOUNCE_FIELDS = ["message", "color"] as const;

function isAnnouncementColor(value: unknown): value is AnnouncementColor {
  return typeof value === "string" && (ANNOUNCEMENT_COLORS as readonly string[]).includes(value);
}

/** A `platform.twitch.chat.announce` request body, checked against the contract. */
export function parseChatAnnounceRequest(body: unknown): ContractResult<ChatAnnounceRequest> {
  if (!isRecord(body)) {
    return { ok: false, error: "request must be a JSON object" };
  }
  const extra = unknownField(body, ANNOUNCE_FIELDS);
  if (extra !== undefined) {
    return { ok: false, error: `unknown field "${extra}"` };
  }
  const message = readMessage(body);
  if (!message.ok) {
    return message;
  }
  const { color } = body;
  if (color === undefined) {
    return { ok: true, value: { message: message.value } };
  }
  if (!isAnnouncementColor(color)) {
    return { ok: false, error: `color must be one of ${ANNOUNCEMENT_COLORS.join(", ")}` };
  }
  return { ok: true, value: { message: message.value, color } };
}

export function chatSendFailure(code: ChatSendErrorCode, message: string): ChatSendReply {
  return { ok: false, error: { code, message } };
}
