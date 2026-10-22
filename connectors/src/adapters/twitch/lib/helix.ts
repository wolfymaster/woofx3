import { callTwitchApiRaw } from "@twurple/api-call";
import type { AuthProvider } from "@twurple/auth";
import type {
  HelixCommandArgs,
  HelixCommandResult,
  HelixOperationName,
} from "@woofx3/common/cloudevents/Twitch/commands";
import { COMMAND_PREFIX } from "../../../chat/command-prefix";
import { TwitchApiError } from "./twitchApiError";

// Twurple passes these straight to fetch and leaves declaring the ones a
// caller uses to the caller.
declare module "@twurple/api-call" {
  interface TwitchApiCallFetchOptions {
    signal?: AbortSignal;
  }
}

type HelixMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type ParamShape = { type: "string" | "integer" | "boolean" | "stringArray"; required?: true };

/**
 * Where a caller's parameters go in the Helix request: the query string, the
 * JSON body, or the JSON body's `data` object, which is where Ban User takes
 * them.
 */
type ParamPlacement = "query" | "body" | "bodyData";

/**
 * One Helix endpoint, as the dashboard calls it. A caller sets only the
 * parameters listed in `params`; every id that names the broadcaster is the
 * linked broadcaster's, filled in here, so a caller cannot act on another
 * channel or as another user.
 */
interface HelixOperation {
  method: HelixMethod;
  /** Relative to `https://api.twitch.tv/helix/`. */
  path: string;
  params: Readonly<Record<string, ParamShape>>;
  paramsIn: ParamPlacement;
  /** Query parameters set to the broadcaster's id. */
  broadcasterQuery: readonly string[];
  /** Body fields set to the broadcaster's id. */
  broadcasterBody: readonly string[];
  /**
   * The parameter whose text is said in chat as the broadcaster, guarded with
   * `guardChatLine` before it is sent.
   */
  chatLine?: string;
}

/** U+200B ZERO WIDTH SPACE. */
const ZERO_WIDTH_SPACE = "\u200b";

/**
 * `text` with a zero-width space in front when it would start with the
 * command prefix. A line sent here is said as the broadcaster and comes back
 * on the chat feed as the broadcaster's own, so without the guard any caller
 * able to send a chat line (a module function, a public command passing its
 * arguments on) could run a broadcaster-only command such as `!title`. The
 * line reads the same in chat. Must match guardOutgoingLine in
 * woofwoofwoof/src/sentLines.ts, which guards the bot's chat-client lines.
 */
export function guardChatLine(text: string): string {
  if (text.startsWith(COMMAND_PREFIX)) {
    return `${ZERO_WIDTH_SPACE}${text}`;
  }
  return text;
}

/**
 * Every operation `helix` performs. Each mirrors a call the dashboard makes
 * straight to Helix, with the same parameters, so a dashboard reading the
 * result gets exactly what Helix would have told it. Rules about values
 * (lengths, ranges, allowed colors) are Twitch's to enforce: only the shape
 * is checked here, and Twitch's refusal comes back as the result.
 */
export const HELIX_OPERATIONS: Readonly<Record<HelixOperationName, HelixOperation>> = {
  getChannelInformation: {
    method: "GET",
    path: "channels",
    params: {},
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id"],
    broadcasterBody: [],
  },
  getGames: {
    method: "GET",
    path: "games",
    params: { id: { type: "string", required: true } },
    paramsIn: "query",
    broadcasterQuery: [],
    broadcasterBody: [],
  },
  searchCategories: {
    method: "GET",
    path: "search/categories",
    params: { query: { type: "string", required: true }, first: { type: "integer" } },
    paramsIn: "query",
    broadcasterQuery: [],
    broadcasterBody: [],
  },
  modifyChannelInformation: {
    method: "PATCH",
    path: "channels",
    params: { title: { type: "string" }, game_id: { type: "string" }, tags: { type: "stringArray" } },
    paramsIn: "body",
    broadcasterQuery: ["broadcaster_id"],
    broadcasterBody: [],
  },
  createStreamMarker: {
    method: "POST",
    path: "streams/markers",
    params: { description: { type: "string" } },
    paramsIn: "body",
    broadcasterQuery: [],
    broadcasterBody: ["user_id"],
  },
  getAdSchedule: {
    method: "GET",
    path: "channels/ads",
    params: {},
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id"],
    broadcasterBody: [],
  },
  snoozeNextAd: {
    method: "POST",
    path: "channels/ads/schedule/snooze",
    params: {},
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id"],
    broadcasterBody: [],
  },
  getUsers: {
    method: "GET",
    path: "users",
    params: { id: { type: "string" }, login: { type: "string" } },
    paramsIn: "query",
    broadcasterQuery: [],
    broadcasterBody: [],
  },
  getBlockedTerms: {
    method: "GET",
    path: "moderation/blocked_terms",
    params: { first: { type: "integer" }, after: { type: "string" } },
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  addBlockedTerm: {
    method: "POST",
    path: "moderation/blocked_terms",
    params: { text: { type: "string", required: true } },
    paramsIn: "body",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  removeBlockedTerm: {
    method: "DELETE",
    path: "moderation/blocked_terms",
    params: { id: { type: "string", required: true } },
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  banUser: {
    method: "POST",
    path: "moderation/bans",
    params: {
      user_id: { type: "string", required: true },
      duration: { type: "integer" },
      reason: { type: "string" },
    },
    paramsIn: "bodyData",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  unbanUser: {
    method: "DELETE",
    path: "moderation/bans",
    params: { user_id: { type: "string", required: true } },
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  getChatSettings: {
    method: "GET",
    path: "chat/settings",
    params: {},
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  updateChatSettings: {
    method: "PATCH",
    path: "chat/settings",
    params: {
      emote_mode: { type: "boolean" },
      subscriber_mode: { type: "boolean" },
      follower_mode: { type: "boolean" },
      follower_mode_duration: { type: "integer" },
      slow_mode: { type: "boolean" },
      slow_mode_wait_time: { type: "integer" },
    },
    paramsIn: "body",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  sendChatMessage: {
    method: "POST",
    path: "chat/messages",
    params: {
      message: { type: "string", required: true },
      pin: { type: "boolean" },
      reply_parent_message_id: { type: "string" },
    },
    paramsIn: "body",
    broadcasterQuery: [],
    broadcasterBody: ["broadcaster_id", "sender_id"],
    chatLine: "message",
  },
  sendChatAnnouncement: {
    method: "POST",
    path: "chat/announcements",
    params: { message: { type: "string", required: true }, color: { type: "string" } },
    paramsIn: "body",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
    chatLine: "message",
  },
  sendShoutout: {
    method: "POST",
    path: "chat/shoutouts",
    params: { to_broadcaster_id: { type: "string", required: true } },
    paramsIn: "query",
    broadcasterQuery: ["from_broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  getChatters: {
    method: "GET",
    path: "chat/chatters",
    params: { first: { type: "integer" }, after: { type: "string" } },
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  // The chat pin endpoints are in Twitch's open beta and may change.
  getChatPins: {
    method: "GET",
    path: "chat/pins",
    params: {},
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  pinChatMessage: {
    method: "PUT",
    path: "chat/pins",
    // `duration` is in seconds; without it the pin stays until replaced or removed.
    params: { message_id: { type: "string", required: true }, duration: { type: "integer" } },
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  unpinChatMessage: {
    method: "DELETE",
    path: "chat/pins",
    params: { message_id: { type: "string", required: true } },
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id", "moderator_id"],
    broadcasterBody: [],
  },
  createClip: {
    method: "POST",
    path: "clips",
    params: {},
    paramsIn: "query",
    broadcasterQuery: ["broadcaster_id"],
    broadcasterBody: [],
  },
};

export function isHelixOperationName(name: unknown): name is HelixOperationName {
  return typeof name === "string" && Object.hasOwn(HELIX_OPERATIONS, name);
}

function invalid(operation: string, reason: string): TwitchApiError {
  return new TwitchApiError("invalid_arguments", `helix ${operation}: ${reason}`);
}

function matchesShape(value: unknown, shape: ParamShape): boolean {
  switch (shape.type) {
    case "string": {
      return typeof value === "string";
    }
    case "integer": {
      return typeof value === "number" && Number.isInteger(value);
    }
    case "boolean": {
      return typeof value === "boolean";
    }
    case "stringArray": {
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    }
  }
}

/**
 * The caller's parameters, checked against the operation's declaration:
 * nothing undeclared, every required one present, each of its declared
 * shape. An undefined value counts as absent.
 */
export function validateHelixParams(
  operation: HelixOperationName,
  params: unknown
): Record<string, string | number | boolean | string[]> {
  const declared = HELIX_OPERATIONS[operation].params;
  const given = params ?? {};
  if (typeof given !== "object" || Array.isArray(given)) {
    throw invalid(operation, "params must be an object");
  }
  const validated: Record<string, string | number | boolean | string[]> = {};
  for (const [name, value] of Object.entries(given)) {
    if (value === undefined) {
      continue;
    }
    if (!Object.hasOwn(declared, name)) {
      throw invalid(operation, `unknown parameter "${name}"`);
    }
    const shape = declared[name];
    if (!matchesShape(value, shape)) {
      throw invalid(operation, `"${name}" must be ${describeShape(shape)}`);
    }
    validated[name] = value as string | number | boolean | string[];
  }
  for (const [name, shape] of Object.entries(declared)) {
    if (shape.required && validated[name] === undefined) {
      throw invalid(operation, `"${name}" is required`);
    }
  }
  return validated;
}

function describeShape(shape: ParamShape): string {
  switch (shape.type) {
    case "string": {
      return "a string";
    }
    case "integer": {
      return "a whole number";
    }
    case "boolean": {
      return "true or false";
    }
    case "stringArray": {
      return "an array of strings";
    }
  }
}

export interface HelixRequest {
  method: HelixMethod;
  url: string;
  /** An array is sent as the key repeated once per value, as Helix takes a list. */
  query: Record<string, string | string[]>;
  /** Absent for an operation that sends no body. */
  jsonBody?: Record<string, unknown>;
}

/** The Helix request for an operation with validated `params`, on behalf of `broadcasterId`. */
export function buildHelixRequest(
  operation: HelixOperationName,
  broadcasterId: string,
  params: Record<string, string | number | boolean | string[]>
): HelixRequest {
  const declared = HELIX_OPERATIONS[operation];
  const query: Record<string, string | string[]> = {};
  const body: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const [name, rawValue] of Object.entries(params)) {
    const value = name === declared.chatLine && typeof rawValue === "string" ? guardChatLine(rawValue) : rawValue;
    switch (declared.paramsIn) {
      case "query": {
        query[name] = Array.isArray(value) ? value : String(value);
        break;
      }
      case "body": {
        body[name] = value;
        break;
      }
      case "bodyData": {
        data[name] = value;
        break;
      }
    }
  }
  // Written after the caller's parameters, so the broadcaster's ids win even
  // if an operation ever declared one of them as a parameter.
  for (const name of declared.broadcasterQuery) {
    query[name] = broadcasterId;
  }
  for (const name of declared.broadcasterBody) {
    body[name] = broadcasterId;
  }
  if (declared.paramsIn === "bodyData") {
    body.data = data;
  }
  const sendsBody = declared.paramsIn !== "query" || declared.broadcasterBody.length > 0;
  return {
    method: declared.method,
    url: declared.path,
    query,
    ...(sendsBody ? { jsonBody: body } : {}),
  };
}

function parseHelixArgs(args: unknown): { operation: HelixOperationName; params: unknown } {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TwitchApiError("invalid_arguments", "helix: args must be { operation, params? }");
  }
  const { operation, params } = args as Partial<HelixCommandArgs>;
  if (!isHelixOperationName(operation)) {
    throw new TwitchApiError("invalid_arguments", `helix: unknown operation ${JSON.stringify(operation)}`);
  }
  return { operation, params };
}

/**
 * How long one operation may take in all: getting the token, the request, the
 * renewal and resend after a 401, and reading Twitch's answer. Must stay below
 * TWITCH_API_SERVED_BUDGET_MS (9s) in ../adapter.ts, the host's reply budget
 * for `twitchapi`, which in turn stays below `TWITCH_HELIX_TIMEOUT_MS` (10s)
 * in api/src/routes/twitch.ts, so the api hears why an operation failed
 * instead of timing out on it. A served call gets the smaller of this and the
 * time left in that budget.
 */
export const HELIX_DEADLINE_MS = 8_000;

/** What `runHelixOperation` needs of the twitch service's Twurple auth provider. */
export type HelixAuth = Pick<AuthProvider, "clientId" | "getAccessTokenForUser" | "refreshAccessTokenForUser">;

/**
 * `promise`'s outcome, or the signal's reason once it aborts first. Bounds a
 * wait the signal cannot cancel, such as the dashboard auth provider asking
 * the api for a token, which has a longer timeout of its own; that request
 * carries on and still stores the token it gets.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** How one `runHelixOperation` call is bounded and observed. */
export interface HelixRunOptions {
  /** How long the whole operation may take. Defaults to HELIX_DEADLINE_MS. */
  deadlineMs?: number;
  /** The caller's own cancellation, such as a request's deadline. Ends the operation like `deadlineMs` does. */
  signal?: AbortSignal;
  /**
   * Called once, just before the first request leaves for Twitch. A caller
   * that has to tell "never sent" from "sent, no answer" uses it, along with
   * `HelixNoAnswer.sent`.
   */
  onSent?(): void;
}

/**
 * An operation that got no answer: its deadline passed or its caller's
 * signal aborted. `sent` says whether a request had left for Twitch, in which
 * case Twitch may have acted.
 */
export class HelixNoAnswer extends Error {
  constructor(
    message: string,
    readonly sent: boolean,
    options: ErrorOptions
  ) {
    super(message, options);
    this.name = "HelixNoAnswer";
  }
}

/**
 * Perform one declared Helix operation with the broadcaster's token and
 * answer with Twitch's own result. Twitch answering with an error status is
 * a result (`ok: false`), so its status and reason reach the caller intact;
 * only a request refused before it is sent, or one that never got an answer,
 * throws. The whole operation gives up after `deadlineMs`, or when the
 * caller's `signal` aborts first, with a HelixNoAnswer.
 *
 * Sent with Twurple's `callTwitchApiRaw`, which makes exactly one request,
 * rather than its API client, because that client retries a 5xx or a network
 * failure up to three times: a chat message, ban or clip that Twitch carried
 * out before failing would be carried out again. Every operation, reads
 * included, gets one attempt, as the dashboard's own Helix calls do. The one
 * exception is a 401, which Twitch answers before acting: the token is renewed
 * and the request sent once more.
 */
export async function runHelixOperation(
  auth: HelixAuth,
  broadcasterId: string,
  args: unknown,
  options: HelixRunOptions = {}
): Promise<HelixCommandResult> {
  const { deadlineMs = HELIX_DEADLINE_MS, signal: callerSignal, onSent } = options;
  const { operation, params } = parseHelixArgs(args);
  const request = buildHelixRequest(operation, broadcasterId, validateHelixParams(operation, params));
  // Not `AbortSignal.timeout`: in Bun 1.3 its timer stops for good once its
  // last abort listener is removed, which every wait here does as it settles.
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new DOMException(`helix ${operation} timed out`, "TimeoutError")),
    deadlineMs
  );
  const cancelled = () => deadline.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    cancelled();
  } else {
    callerSignal?.addEventListener("abort", cancelled, { once: true });
  }
  const signal = deadline.signal;
  let sent = false;
  const send = (accessToken: string) => {
    signal.throwIfAborted();
    if (!sent) {
      sent = true;
      onSent?.();
    }
    return untilAborted(
      callTwitchApiRaw({ type: "helix", ...request }, auth.clientId, accessToken, undefined, { signal }),
      signal
    );
  };

  let response: Response;
  let text: string;
  try {
    const token = await untilAborted(auth.getAccessTokenForUser(broadcasterId), signal);
    if (!token) {
      throw new Error(`helix ${operation}: there is no Twitch token for the broadcaster`);
    }
    response = await send(token.accessToken);
    if (response.status === 401 && auth.refreshAccessTokenForUser) {
      await response.body?.cancel();
      const renewed = await untilAborted(auth.refreshAccessTokenForUser(broadcasterId), signal);
      response = await send(renewed.accessToken);
    }
    text = await untilAborted(response.text(), signal);
  } catch (err) {
    if (signal.aborted) {
      const outcome = sent ? "; Twitch may still have acted" : ", before a request was sent";
      const why = callerSignal?.aborted ? "the caller stopped waiting" : `no answer within ${deadlineMs / 1000}s`;
      throw new HelixNoAnswer(`helix ${operation}: ${why}${outcome}`, sent, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", cancelled);
  }

  if (!response.ok) {
    return { ok: false, status: response.status, body: text };
  }
  if (text === "") {
    return { ok: true, body: null };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch (err) {
    throw new Error(`helix ${operation}: Twitch answered ${response.status} with something that is not JSON`, {
      cause: err,
    });
  }
}

/**
 * What Send Chat Message reports for one line: posted with its id, or
 * dropped by Twitch (AutoMod, a blocked term, a chat mode), which Twitch
 * answers with 200 and `is_sent: false`.
 */
export type SentChatMessage = { sent: true; messageId: string } | { sent: false; dropReason: string };

/**
 * The outcome in a successful `sendChatMessage` body
 * (`{ data: [{ message_id, is_sent, drop_reason? }] }`), or null when the
 * body is not shaped like one, so a caller never mistakes it for a post.
 */
export function readSentChatMessage(body: unknown): SentChatMessage | null {
  const entry = isRecord(body) && Array.isArray(body.data) ? body.data[0] : undefined;
  if (!isRecord(entry) || typeof entry.is_sent !== "boolean") {
    return null;
  }
  if (entry.is_sent) {
    return typeof entry.message_id === "string" && entry.message_id !== ""
      ? { sent: true, messageId: entry.message_id }
      : null;
  }
  const drop = isRecord(entry.drop_reason) ? entry.drop_reason : {};
  const reason = [drop.message, drop.code].find((value) => typeof value === "string" && value !== "");
  return { sent: false, dropReason: typeof reason === "string" ? reason : "Twitch did not post the message" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
