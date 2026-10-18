import { describe, expect, test } from "bun:test";
import type { HelixOperationName } from "@woofx3/common/cloudevents/Twitch/commands";
import {
  buildHelixRequest,
  HELIX_OPERATIONS,
  type HelixAuth,
  type HelixRequest,
  runHelixOperation,
  validateHelixParams,
} from "./helix";
import { TwitchApiError } from "./twitchApiError";

const BROADCASTER_ID = "broadcaster-1";

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** An auth provider whose token is `token-1`, renewed as `token-2`. */
function fakeAuth(): HelixAuth {
  const token = (accessToken: string) => ({
    accessToken,
    refreshToken: null,
    scope: [],
    expiresIn: null,
    obtainmentTimestamp: 0,
    userId: BROADCASTER_ID,
  });
  return {
    clientId: "client-1",
    getAccessTokenForUser: async () => token("token-1"),
    refreshAccessTokenForUser: async () => token("token-2"),
  };
}

/** A fetch that answers each request with the next of `answers`, and records what it was sent. */
function fetchAnswering(...answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    sent.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const answer = answers[sent.length - 1];
    if (answer === undefined) {
      throw new Error("fetchAnswering: more requests than answers");
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  return { fetchFn, sent };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
  ["getAdSchedule", {}, { method: "GET", url: "channels/ads", query: { broadcaster_id: BROADCASTER_ID } }],
  [
    "snoozeNextAd",
    {},
    { method: "POST", url: "channels/ads/schedule/snooze", query: { broadcaster_id: BROADCASTER_ID } },
  ],
  ["getUsers", { login: "spammer" }, { method: "GET", url: "users", query: { login: "spammer" } }],
  ["getUsers", { id: "42" }, { method: "GET", url: "users", query: { id: "42" } }],
  [
    "getBlockedTerms",
    { first: 100, after: "cursor-1" },
    {
      method: "GET",
      url: "moderation/blocked_terms",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID, first: "100", after: "cursor-1" },
    },
  ],
  [
    "addBlockedTerm",
    { text: "badword" },
    {
      method: "POST",
      url: "moderation/blocked_terms",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID },
      jsonBody: { text: "badword" },
    },
  ],
  [
    "removeBlockedTerm",
    { id: "term-1" },
    {
      method: "DELETE",
      url: "moderation/blocked_terms",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID, id: "term-1" },
    },
  ],
  [
    "banUser",
    { user_id: "42", duration: 600 },
    {
      method: "POST",
      url: "moderation/bans",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID },
      jsonBody: { data: { user_id: "42", duration: 600 } },
    },
  ],
  [
    "banUser",
    { user_id: "42", reason: "spam" },
    {
      method: "POST",
      url: "moderation/bans",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID },
      jsonBody: { data: { user_id: "42", reason: "spam" } },
    },
  ],
  [
    "unbanUser",
    { user_id: "42" },
    {
      method: "DELETE",
      url: "moderation/bans",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID, user_id: "42" },
    },
  ],
  [
    "getChatSettings",
    {},
    { method: "GET", url: "chat/settings", query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID } },
  ],
  [
    "updateChatSettings",
    { slow_mode: true, slow_mode_wait_time: 30, follower_mode: false },
    {
      method: "PATCH",
      url: "chat/settings",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID },
      jsonBody: { slow_mode: true, slow_mode_wait_time: 30, follower_mode: false },
    },
  ],
  [
    "sendChatMessage",
    { message: "hello chat" },
    {
      method: "POST",
      url: "chat/messages",
      query: {},
      jsonBody: { broadcaster_id: BROADCASTER_ID, sender_id: BROADCASTER_ID, message: "hello chat" },
    },
  ],
  [
    "sendChatAnnouncement",
    { message: "Giveaway at 9", color: "purple" },
    {
      method: "POST",
      url: "chat/announcements",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID },
      jsonBody: { message: "Giveaway at 9", color: "purple" },
    },
  ],
  [
    "sendShoutout",
    { to_broadcaster_id: "42" },
    {
      method: "POST",
      url: "chat/shoutouts",
      query: { from_broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID, to_broadcaster_id: "42" },
    },
  ],
  [
    "getChatters",
    { first: 1000 },
    {
      method: "GET",
      url: "chat/chatters",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID, first: "1000" },
    },
  ],
  [
    "sendChatMessage",
    { message: "pin me", pin: true },
    {
      method: "POST",
      url: "chat/messages",
      query: {},
      jsonBody: { broadcaster_id: BROADCASTER_ID, sender_id: BROADCASTER_ID, message: "pin me", pin: true },
    },
  ],
  [
    "getChatPins",
    {},
    { method: "GET", url: "chat/pins", query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID } },
  ],
  [
    "pinChatMessage",
    { message_id: "m-1" },
    {
      method: "PUT",
      url: "chat/pins",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID, message_id: "m-1" },
    },
  ],
  [
    "unpinChatMessage",
    { message_id: "m-1" },
    {
      method: "DELETE",
      url: "chat/pins",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID, message_id: "m-1" },
    },
  ],
  ["createClip", {}, { method: "POST", url: "clips", query: { broadcaster_id: BROADCASTER_ID } }],
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

  test("refuses the ids it fills in on the moderation operations", () => {
    expect(() => validateHelixParams("banUser", { user_id: "42", moderator_id: "someone-else" })).toThrow(
      'unknown parameter "moderator_id"'
    );
    expect(() => validateHelixParams("banUser", { data: { user_id: "42" } })).toThrow('unknown parameter "data"');
  });

  test("sends chat as the broadcaster only", () => {
    expect(() => validateHelixParams("sendChatMessage", { message: "hi", sender_id: "someone-else" })).toThrow(
      'unknown parameter "sender_id"'
    );
    expect(() => validateHelixParams("sendShoutout", { to_broadcaster_id: "42", from_broadcaster_id: "x" })).toThrow(
      'unknown parameter "from_broadcaster_id"'
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
      runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "getGames" }, fetchAnswering().fetchFn)
    );
    expect(err.code).toBe("invalid_arguments");
  });
});

describe("runHelixOperation", () => {
  test("sends the request as the broadcaster and answers with Helix's body unchanged", async () => {
    const body = { data: [{ broadcaster_id: BROADCASTER_ID, title: "Hi", game_id: "1", tags: [] }] };
    const { fetchFn, sent } = fetchAnswering(json(200, body));

    const result = await runHelixOperation(
      fakeAuth(),
      BROADCASTER_ID,
      { operation: "modifyChannelInformation", params: { title: "Hi" } },
      fetchFn
    );

    expect(result).toEqual({ ok: true, body });
    expect(sent).toEqual([
      {
        url: `https://api.twitch.tv/helix/channels?broadcaster_id=${BROADCASTER_ID}`,
        method: "PATCH",
        headers: { Authorization: "Bearer token-1", "Client-Id": "client-1", "Content-Type": "application/json" },
        body: { title: "Hi" },
      },
    ]);
  });

  test("encodes the query and sends no body for a read", async () => {
    const { fetchFn, sent } = fetchAnswering(json(200, { data: [] }));

    await runHelixOperation(
      fakeAuth(),
      BROADCASTER_ID,
      { operation: "searchCategories", params: { query: "just chat & more", first: 10 } },
      fetchFn
    );

    expect(sent[0]?.url).toBe("https://api.twitch.tv/helix/search/categories?query=just+chat+%26+more&first=10");
    expect(sent[0]?.body).toBeUndefined();
    expect(sent[0]?.headers).toEqual({ Authorization: "Bearer token-1", "Client-Id": "client-1" });
  });

  test("answers null for a response with no body", async () => {
    const { fetchFn } = fetchAnswering(new Response(null, { status: 204 }));
    expect(
      await runHelixOperation(
        fakeAuth(),
        BROADCASTER_ID,
        { operation: "modifyChannelInformation", params: { title: "x" } },
        fetchFn
      )
    ).toEqual({ ok: true, body: null });
  });

  test("answers Twitch's error status and body as a result, as Twitch sent it", async () => {
    const twitchBody = '{"error":"Not Found","status":404,"message":"stream not found"}';
    const { fetchFn } = fetchAnswering(new Response(twitchBody, { status: 404 }));

    expect(await runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "createStreamMarker" }, fetchFn)).toEqual({
      ok: false,
      status: 404,
      body: twitchBody,
    });
  });

  test("sends a write once when Twitch answers 5xx, and answers that status", async () => {
    const { fetchFn, sent } = fetchAnswering(new Response("upstream failed", { status: 503 }), json(200, { data: [] }));

    const result = await runHelixOperation(
      fakeAuth(),
      BROADCASTER_ID,
      { operation: "createStreamMarker", params: { description: "clutch" } },
      fetchFn
    );

    expect(result).toEqual({ ok: false, status: 503, body: "upstream failed" });
    expect(sent).toHaveLength(1);
  });

  test("sends a write once when the request fails in transit, and throws", async () => {
    const { fetchFn, sent } = fetchAnswering(new TypeError("fetch failed"), json(200, { data: [] }));

    await expect(
      runHelixOperation(
        fakeAuth(),
        BROADCASTER_ID,
        { operation: "modifyChannelInformation", params: { title: "x" } },
        fetchFn
      )
    ).rejects.toThrow("fetch failed");
    expect(sent).toHaveLength(1);
  });

  test("sends a read once when Twitch answers 5xx", async () => {
    const { fetchFn, sent } = fetchAnswering(new Response("", { status: 500 }), json(200, { data: [] }));

    const result = await runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "getChannelInformation" }, fetchFn);

    expect(result).toEqual({ ok: false, status: 500, body: "" });
    expect(sent).toHaveLength(1);
  });

  test("renews the token and sends again once after a 401, which Twitch answers before acting", async () => {
    const { fetchFn, sent } = fetchAnswering(
      json(401, { error: "Unauthorized", status: 401, message: "Invalid OAuth token" }),
      json(200, { data: [{ id: "m1" }] })
    );

    const result = await runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "createStreamMarker" }, fetchFn);

    expect(result).toEqual({ ok: true, body: { data: [{ id: "m1" }] } });
    expect(sent.map((request) => request.headers.Authorization)).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  test("answers a second 401 as the result, without a third request", async () => {
    const unauthorized = '{"error":"Unauthorized","status":401,"message":"Missing scope: channel:manage:broadcast"}';
    const { fetchFn, sent } = fetchAnswering(
      new Response(unauthorized, { status: 401 }),
      new Response(unauthorized, { status: 401 })
    );

    const result = await runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "createStreamMarker" }, fetchFn);

    expect(result).toEqual({ ok: false, status: 401, body: unauthorized });
    expect(sent).toHaveLength(2);
  });

  test("throws for a success that is not JSON", async () => {
    const { fetchFn } = fetchAnswering(new Response("<html>", { status: 200 }));
    await expect(
      runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "getChannelInformation" }, fetchFn)
    ).rejects.toThrow("not JSON");
  });

  test("throws when there is no token for the broadcaster, without a request", async () => {
    const { fetchFn, sent } = fetchAnswering();
    const auth = { ...fakeAuth(), getAccessTokenForUser: async () => null };

    await expect(
      runHelixOperation(auth, BROADCASTER_ID, { operation: "getChannelInformation" }, fetchFn)
    ).rejects.toThrow("no Twitch token");
    expect(sent).toEqual([]);
  });

  test("refuses an unknown or inherited operation without a request", async () => {
    const { fetchFn, sent } = fetchAnswering();

    for (const operation of ["deleteVideos", "toString"]) {
      const err = await refusalOf(runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation }, fetchFn));
      expect(err.code).toBe("invalid_arguments");
    }
    expect(sent).toEqual([]);
  });
});
