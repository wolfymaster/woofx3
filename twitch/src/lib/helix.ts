import type { AuthProvider } from "@twurple/auth";
import type {
  HelixCommandArgs,
  HelixCommandResult,
  HelixOperationName,
} from "@woofx3/common/cloudevents/Twitch/commands";
import { TwitchApiError } from "./twitchApiError";

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
  query: Record<string, string>;
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
  const query: Record<string, string> = {};
  for (const name of declared.broadcasterQuery) {
    query[name] = broadcasterId;
  }
  const body: Record<string, unknown> = {};
  for (const name of declared.broadcasterBody) {
    body[name] = broadcasterId;
  }
  const data: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params)) {
    switch (declared.paramsIn) {
      case "query": {
        query[name] = String(value);
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

const HELIX_BASE_URL = "https://api.twitch.tv/helix/";

/** What `runHelixOperation` needs of the twitch service's Twurple auth provider. */
export type HelixAuth = Pick<AuthProvider, "clientId" | "getAccessTokenForUser" | "refreshAccessTokenForUser">;

export type HelixFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Perform one declared Helix operation with the broadcaster's token and
 * answer with Twitch's own result. Twitch answering with an error status is
 * a result (`ok: false`), so its status and reason reach the caller intact;
 * only a request refused before it is sent, or one that never got an answer,
 * throws.
 *
 * Sent with a plain fetch rather than Twurple's API client, because that
 * client retries a 5xx or a network failure up to three times: a chat
 * message, ban or clip that Twitch carried out before failing would be
 * carried out again. Every operation, reads included, gets one attempt, as
 * the dashboard's own Helix calls do. The one exception is a 401, which
 * Twitch answers before acting: the token is renewed and the request sent
 * once more.
 */
export async function runHelixOperation(
  auth: HelixAuth,
  broadcasterId: string,
  args: unknown,
  fetchFn: HelixFetch = fetch
): Promise<HelixCommandResult> {
  const { operation, params } = parseHelixArgs(args);
  const request = buildHelixRequest(operation, broadcasterId, validateHelixParams(operation, params));
  const search = new URLSearchParams(request.query).toString();
  const url = `${HELIX_BASE_URL}${request.url}${search ? `?${search}` : ""}`;
  const send = (accessToken: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "Client-Id": auth.clientId };
    if (request.jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return fetchFn(url, {
      method: request.method,
      headers,
      body: request.jsonBody === undefined ? undefined : JSON.stringify(request.jsonBody),
    });
  };

  const token = await auth.getAccessTokenForUser(broadcasterId);
  if (!token) {
    throw new Error(`helix ${operation}: there is no Twitch token for the broadcaster`);
  }
  let response = await send(token.accessToken);
  if (response.status === 401 && auth.refreshAccessTokenForUser) {
    await response.body?.cancel();
    const renewed = await auth.refreshAccessTokenForUser(broadcasterId);
    response = await send(renewed.accessToken);
  }

  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, body: text };
  }
  if (text === "") {
    return { ok: true, body: null };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    throw new Error(`helix ${operation}: Twitch answered ${response.status} with something that is not JSON`);
  }
}
