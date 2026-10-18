import type { ApiClient } from "@twurple/api";
import type {
  HelixCommandArgs,
  HelixCommandResult,
  HelixOperationName,
} from "@woofx3/common/cloudevents/Twitch/commands";
import { httpStatusOf, TwitchApiError } from "./twitchApiError";

type HelixMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type ParamShape = { type: "string" | "integer" | "boolean" | "stringArray"; required?: true };

/** Where a caller's parameters go in the Helix request. */
type ParamPlacement = "query" | "body";

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
  for (const [name, value] of Object.entries(params)) {
    if (declared.paramsIn === "query") {
      query[name] = String(value);
    } else {
      body[name] = value;
    }
  }
  const sendsBody = declared.paramsIn === "body" || declared.broadcasterBody.length > 0;
  return {
    method: declared.method,
    url: declared.path,
    query,
    ...(sendsBody ? { jsonBody: body } : {}),
  };
}

/** Twurple's HttpStatusCodeError body, matched by shape like `httpStatusOf`. */
function errorBodyOf(err: unknown): string {
  if (err && typeof err === "object" && "body" in err && typeof err.body === "string") {
    return compactJson(err.body);
  }
  return "";
}

/**
 * Twurple re-indents a JSON error body before keeping it. Helix sends it
 * compact, so it is compacted back to the text Twitch sent.
 */
function compactJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
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
 * Perform one declared Helix operation with the broadcaster's token and
 * answer with Twitch's own result. Twitch answering with an error status is
 * a result (`ok: false`), so its status and reason reach the caller intact;
 * only a request refused before it is sent, or one that never got an answer,
 * throws.
 */
export async function runHelixOperation(
  apiClient: ApiClient,
  broadcasterId: string,
  args: unknown
): Promise<HelixCommandResult> {
  const { operation, params } = parseHelixArgs(args);
  const request = buildHelixRequest(operation, broadcasterId, validateHelixParams(operation, params));
  try {
    const body = await apiClient.callApi<unknown>({
      type: "helix",
      url: request.url,
      method: request.method,
      userId: broadcasterId,
      query: request.query,
      jsonBody: request.jsonBody,
    });
    return { ok: true, body: body ?? null };
  } catch (err) {
    const status = httpStatusOf(err);
    if (status === undefined) {
      throw err;
    }
    return { ok: false, status, body: errorBodyOf(err) };
  }
}
