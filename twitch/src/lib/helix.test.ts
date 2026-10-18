import { describe, expect, mock, test } from "bun:test";
import type { ApiClient } from "@twurple/api";
import type { HelixOperationName } from "@woofx3/common/cloudevents/Twitch/commands";
import {
  buildHelixRequest,
  HELIX_OPERATIONS,
  type HelixRequest,
  runHelixOperation,
  validateHelixParams,
} from "./helix";
import { TwitchApiError } from "./twitchApiError";

const BROADCASTER_ID = "broadcaster-1";

/** Twurple's HttpStatusCodeError as far as `runHelixOperation` reads it. */
function httpError(statusCode: number, body: string): Error {
  return Object.assign(new Error(`Encountered HTTP status code ${statusCode}`), { statusCode, body });
}

function clientAnswering(answer: () => unknown) {
  const callApi = mock(async (_options: Record<string, unknown>) => answer());
  return { client: { callApi } as unknown as ApiClient, callApi };
}

async function refusalOf(promise: Promise<unknown>): Promise<TwitchApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof TwitchApiError) {
      return err;
    }
    throw err;
  }
  throw new Error("expected a refusal");
}

/**
 * Each operation's request, exactly as the dashboard sends it to Helix today.
 * A row per operation, so an operation with no row fails the coverage test.
 */
const REQUESTS: [HelixOperationName, Record<string, unknown>, HelixRequest][] = [
  ["getChannelInformation", {}, { method: "GET", url: "channels", query: { broadcaster_id: BROADCASTER_ID } }],
  ["getGames", { id: "509658" }, { method: "GET", url: "games", query: { id: "509658" } }],
  [
    "searchCategories",
    { query: "just chat", first: 10 },
    { method: "GET", url: "search/categories", query: { query: "just chat", first: "10" } },
  ],
  [
    "modifyChannelInformation",
    { title: "Late night", game_id: "", tags: ["English", "Chill"] },
    {
      method: "PATCH",
      url: "channels",
      query: { broadcaster_id: BROADCASTER_ID },
      jsonBody: { title: "Late night", game_id: "", tags: ["English", "Chill"] },
    },
  ],
  [
    "createStreamMarker",
    { description: "clutch" },
    { method: "POST", url: "streams/markers", query: {}, jsonBody: { user_id: BROADCASTER_ID, description: "clutch" } },
  ],
  [
    "createStreamMarker",
    {},
    { method: "POST", url: "streams/markers", query: {}, jsonBody: { user_id: BROADCASTER_ID } },
  ],
];

describe("buildHelixRequest", () => {
  for (const [operation, params, expected] of REQUESTS) {
    test(`${operation} ${JSON.stringify(params)}`, () => {
      expect(buildHelixRequest(operation, BROADCASTER_ID, validateHelixParams(operation, params))).toEqual(expected);
    });
  }

  test("covers every declared operation", () => {
    const covered = new Set<string>(REQUESTS.map(([operation]) => operation));
    expect([...covered].sort()).toEqual(Object.keys(HELIX_OPERATIONS).sort());
  });
});

describe("validateHelixParams", () => {
  test("refuses a parameter the operation does not declare, including the broadcaster's ids", () => {
    expect(() => validateHelixParams("getChannelInformation", { broadcaster_id: "someone-else" })).toThrow(
      'unknown parameter "broadcaster_id"'
    );
    expect(() => validateHelixParams("createStreamMarker", { user_id: "someone-else" })).toThrow(
      'unknown parameter "user_id"'
    );
  });

  test("does not take inherited names for declared ones", () => {
    expect(() => validateHelixParams("getGames", { id: "1", toString: "x" })).toThrow('unknown parameter "toString"');
  });

  test("refuses a missing required parameter", () => {
    expect(() => validateHelixParams("getGames", {})).toThrow('"id" is required');
    expect(() => validateHelixParams("searchCategories", { first: 10 })).toThrow('"query" is required');
  });

  test("refuses a value of the wrong shape", () => {
    expect(() => validateHelixParams("searchCategories", { query: "x", first: 1.5 })).toThrow(
      '"first" must be a whole number'
    );
    expect(() => validateHelixParams("modifyChannelInformation", { tags: ["ok", 3] })).toThrow(
      '"tags" must be an array of strings'
    );
    expect(() => validateHelixParams("modifyChannelInformation", { title: null })).toThrow('"title" must be a string');
  });

  test("refuses params that are not an object, and reads absent ones as none", () => {
    expect(() => validateHelixParams("getChannelInformation", [])).toThrow("params must be an object");
    expect(() => validateHelixParams("getChannelInformation", "x")).toThrow("params must be an object");
    expect(validateHelixParams("getChannelInformation", undefined)).toEqual({});
  });

  test("skips an undefined value", () => {
    expect(validateHelixParams("createStreamMarker", { description: undefined })).toEqual({});
  });

  test("refuses with the invalid_arguments code", async () => {
    const err = await refusalOf(
      runHelixOperation(clientAnswering(() => ({})).client, BROADCASTER_ID, { operation: "getGames" })
    );
    expect(err.code).toBe("invalid_arguments");
  });
});

describe("runHelixOperation", () => {
  test("calls Helix as the broadcaster and answers with Helix's body unchanged", async () => {
    const body = { data: [{ broadcaster_id: BROADCASTER_ID, title: "Hi", game_id: "1", tags: [] }] };
    const { client, callApi } = clientAnswering(() => body);

    const result = await runHelixOperation(client, BROADCASTER_ID, {
      operation: "modifyChannelInformation",
      params: { title: "Hi" },
    });

    expect(result).toEqual({ ok: true, body });
    expect(callApi.mock.calls[0]?.[0]).toEqual({
      type: "helix",
      url: "channels",
      method: "PATCH",
      userId: BROADCASTER_ID,
      query: { broadcaster_id: BROADCASTER_ID },
      jsonBody: { title: "Hi" },
    });
  });

  test("answers null for a response with no body", async () => {
    const { client } = clientAnswering(() => undefined);
    expect(await runHelixOperation(client, BROADCASTER_ID, { operation: "getChannelInformation" })).toEqual({
      ok: true,
      body: null,
    });
  });

  test("answers Twitch's error status and body as a result, compacted back to how Twitch sent it", async () => {
    const twitchBody = { error: "Not Found", status: 404, message: "stream not found" };
    const { client } = clientAnswering(() => {
      throw httpError(404, JSON.stringify(twitchBody, null, 2));
    });

    expect(await runHelixOperation(client, BROADCASTER_ID, { operation: "createStreamMarker" })).toEqual({
      ok: false,
      status: 404,
      body: JSON.stringify(twitchBody),
    });
  });

  test("keeps a body that is not JSON as it is", async () => {
    const { client } = clientAnswering(() => {
      throw httpError(502, "<html>bad gateway</html>");
    });

    expect(await runHelixOperation(client, BROADCASTER_ID, { operation: "getChannelInformation" })).toEqual({
      ok: false,
      status: 502,
      body: "<html>bad gateway</html>",
    });
  });

  test("throws when Twitch never answered", async () => {
    const { client } = clientAnswering(() => {
      throw new TypeError("fetch failed");
    });

    await expect(runHelixOperation(client, BROADCASTER_ID, { operation: "getChannelInformation" })).rejects.toThrow(
      "fetch failed"
    );
  });

  test("refuses an unknown operation without calling Twitch", async () => {
    const { client, callApi } = clientAnswering(() => ({}));

    const err = await refusalOf(runHelixOperation(client, BROADCASTER_ID, { operation: "deleteVideos" }));

    expect(err.code).toBe("invalid_arguments");
    expect(err.message).toContain("unknown operation");
    expect(callApi).not.toHaveBeenCalled();
  });

  test("refuses an inherited name as an operation", async () => {
    const { client } = clientAnswering(() => ({}));
    const err = await refusalOf(runHelixOperation(client, BROADCASTER_ID, { operation: "toString" }));
    expect(err.code).toBe("invalid_arguments");
  });
});
