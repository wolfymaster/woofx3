import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import type { HelixOperationName } from "@woofx3/common/cloudevents/Twitch/commands";
import {
  buildHelixRequest,
  guardChatLine,
  HELIX_OPERATIONS,
  type HelixAuth,
  HelixNoAnswer,
  type HelixRequest,
  readSentChatMessage,
  runHelixOperation,
  type SentChatMessage,
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

let fetchSpy: Mock<typeof fetch>;

/** Fetch as `callTwitchApiRaw` calls it, without Bun's extra members on `typeof fetch`. */
type FetchCall = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Answer every fetch with `answer`. */
function stubFetch(answer: FetchCall): void {
  fetchSpy.mockImplementation(answer as typeof fetch);
}

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch");
  stubFetch(async () => {
    throw new Error("fetch called without fetchAnswering");
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
});

/**
 * Answer each request fetch is sent with the next of `answers`, and record
 * the requests. Mocks the global fetch, which Twurple's `callTwitchApiRaw`
 * calls.
 */
function fetchAnswering(...answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  stubFetch(async (input, init) => {
    sent.push({
      url: String(input),
      method: String(init?.method),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body == null ? undefined : JSON.parse(String(init.body)),
    });
    const answer = answers[sent.length - 1];
    if (answer === undefined) {
      throw new Error("fetchAnswering: more requests than answers");
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  });
  return { sent };
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
 * Each operation's request, exactly as the dashboard sends it straight to Helix.
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
  // Said as the broadcaster, so it comes back on the chat feed as the
  // broadcaster's: a line that would run a command must not start with "!".
  [
    "sendChatMessage",
    { message: "!title pwned" },
    {
      method: "POST",
      url: "chat/messages",
      query: {},
      jsonBody: { broadcaster_id: BROADCASTER_ID, sender_id: BROADCASTER_ID, message: "\u200b!title pwned" },
    },
  ],
  [
    "sendChatAnnouncement",
    { message: "!title pwned" },
    {
      method: "POST",
      url: "chat/announcements",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID },
      jsonBody: { message: "\u200b!title pwned" },
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
    "sendChatMessage",
    { message: "same here", reply_parent_message_id: "parent-1" },
    {
      method: "POST",
      url: "chat/messages",
      query: {},
      jsonBody: {
        broadcaster_id: BROADCASTER_ID,
        sender_id: BROADCASTER_ID,
        message: "same here",
        reply_parent_message_id: "parent-1",
      },
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
    "pinChatMessage",
    { message_id: "m-1", duration: 120 },
    {
      method: "PUT",
      url: "chat/pins",
      query: { broadcaster_id: BROADCASTER_ID, moderator_id: BROADCASTER_ID, message_id: "m-1", duration: "120" },
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

describe("guardChatLine", () => {
  const rows: [name: string, line: string, guarded: string][] = [
    ["a command", "!title pwned", "\u200b!title pwned"],
    ["the prefix alone", "!", "\u200b!"],
    ["plain text", "hello chat", "hello chat"],
    ["a prefix later in the line", "say !hi", "say !hi"],
    ["a line already guarded", "\u200b!hi", "\u200b!hi"],
    ["a leading space", " !hi", " !hi"],
    ["an empty line", "", ""],
  ];
  for (const [name, line, guarded] of rows) {
    test(name, () => {
      expect(guardChatLine(line)).toBe(guarded);
    });
  }

  test("guards every operation that says a chat line, and only its chat line", () => {
    const chatLines = Object.entries(HELIX_OPERATIONS)
      .filter(([, declared]) => declared.chatLine !== undefined)
      .map(([operation, declared]) => [operation, declared.chatLine]);
    expect(chatLines).toEqual([
      ["sendChatMessage", "message"],
      ["sendChatAnnouncement", "message"],
    ]);
  });
});

describe("readSentChatMessage", () => {
  const rows: [name: string, body: unknown, read: SentChatMessage | null][] = [
    ["a posted line", { data: [{ message_id: "m-1", is_sent: true }] }, { sent: true, messageId: "m-1" }],
    [
      "a dropped line with Twitch's reason",
      { data: [{ message_id: "", is_sent: false, drop_reason: { code: "msg_duplicate", message: "duplicate" } }] },
      { sent: false, dropReason: "duplicate" },
    ],
    [
      "a dropped line with only a code",
      { data: [{ is_sent: false, drop_reason: { code: "automod_held" } }] },
      { sent: false, dropReason: "automod_held" },
    ],
    [
      "a dropped line with no reason",
      { data: [{ is_sent: false }] },
      { sent: false, dropReason: "Twitch did not post the message" },
    ],
    ["a posted line without an id", { data: [{ is_sent: true }] }, null],
    ["a posted line with an empty id", { data: [{ message_id: "", is_sent: true }] }, null],
    ["no is_sent", { data: [{ message_id: "m-1" }] }, null],
    ["an empty data list", { data: [] }, null],
    ["no body", null, null],
    ["a body that is a list", [{ is_sent: true }], null],
  ];
  for (const [name, body, read] of rows) {
    test(name, () => {
      expect(readSentChatMessage(body)).toEqual(read);
    });
  }
});

describe("buildHelixRequest", () => {
  for (const [operation, params, expected] of REQUESTS) {
    test(`${operation} ${JSON.stringify(params)}`, () => {
      expect(buildHelixRequest(operation, BROADCASTER_ID, validateHelixParams(operation, params))).toEqual(expected);
    });
  }

  test("declares no parameter under a name the broadcaster's id fills", () => {
    for (const [operation, declared] of Object.entries(HELIX_OPERATIONS)) {
      const filled = new Set([...declared.broadcasterQuery, ...declared.broadcasterBody]);
      const overlapping = Object.keys(declared.params).filter((name) => filled.has(name));
      expect({ operation, overlapping }).toEqual({ operation, overlapping: [] });
    }
  });

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
    const err = await refusalOf(runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "getGames" }));
    expect(err.code).toBe("invalid_arguments");
  });
});

describe("runHelixOperation", () => {
  test("sends the request as the broadcaster and answers with Helix's body unchanged", async () => {
    const body = { data: [{ broadcaster_id: BROADCASTER_ID, title: "Hi", game_id: "1", tags: [] }] };
    const { sent } = fetchAnswering(json(200, body));

    const result = await runHelixOperation(fakeAuth(), BROADCASTER_ID, {
      operation: "modifyChannelInformation",
      params: { title: "Hi" },
    });

    expect(result).toEqual({ ok: true, body });
    expect(sent).toEqual([
      {
        url: `https://api.twitch.tv/helix/channels?broadcaster_id=${BROADCASTER_ID}`,
        method: "PATCH",
        headers: {
          accept: "application/json",
          authorization: "Bearer token-1",
          "client-id": "client-1",
          "content-type": "application/json",
        },
        body: { title: "Hi" },
      },
    ]);
  });

  test("encodes the query and sends no body for a read", async () => {
    const { sent } = fetchAnswering(json(200, { data: [] }));

    await runHelixOperation(fakeAuth(), BROADCASTER_ID, {
      operation: "searchCategories",
      params: { query: "just chat & more", first: 10 },
    });

    expect(sent[0]?.url).toBe("https://api.twitch.tv/helix/search/categories?query=just+chat+%26+more&first=10");
    expect(sent[0]?.body).toBeUndefined();
    expect(sent[0]?.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer token-1",
      "client-id": "client-1",
    });
  });

  test("answers null for a response with no body", async () => {
    fetchAnswering(new Response(null, { status: 204 }));
    expect(
      await runHelixOperation(fakeAuth(), BROADCASTER_ID, {
        operation: "modifyChannelInformation",
        params: { title: "x" },
      })
    ).toEqual({ ok: true, body: null });
  });

  test("answers Twitch's error status and body as a result, as Twitch sent it", async () => {
    const twitchBody = '{"error":"Not Found","status":404,"message":"stream not found"}';
    fetchAnswering(new Response(twitchBody, { status: 404 }));

    expect(await runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "createStreamMarker" })).toEqual({
      ok: false,
      status: 404,
      body: twitchBody,
    });
  });

  test("sends a write once when Twitch answers 5xx, and answers that status", async () => {
    const { sent } = fetchAnswering(new Response("upstream failed", { status: 503 }), json(200, { data: [] }));

    const result = await runHelixOperation(fakeAuth(), BROADCASTER_ID, {
      operation: "createStreamMarker",
      params: { description: "clutch" },
    });

    expect(result).toEqual({ ok: false, status: 503, body: "upstream failed" });
    expect(sent).toHaveLength(1);
  });

  test("sends a write once when the request fails in transit, and throws", async () => {
    const { sent } = fetchAnswering(new TypeError("fetch failed"), json(200, { data: [] }));

    await expect(
      runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "modifyChannelInformation", params: { title: "x" } })
    ).rejects.toThrow("fetch failed");
    expect(sent).toHaveLength(1);
  });

  test("sends a read once when Twitch answers 5xx", async () => {
    const { sent } = fetchAnswering(new Response("", { status: 500 }), json(200, { data: [] }));

    const result = await runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "getChannelInformation" });

    expect(result).toEqual({ ok: false, status: 500, body: "" });
    expect(sent).toHaveLength(1);
  });

  test("renews the token and sends again once after a 401, which Twitch answers before acting", async () => {
    const { sent } = fetchAnswering(
      json(401, { error: "Unauthorized", status: 401, message: "Invalid OAuth token" }),
      json(200, { data: [{ id: "m1" }] })
    );

    const result = await runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "createStreamMarker" });

    expect(result).toEqual({ ok: true, body: { data: [{ id: "m1" }] } });
    expect(sent.map((request) => request.headers.authorization)).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  test("answers a second 401 as the result, without a third request", async () => {
    const unauthorized = '{"error":"Unauthorized","status":401,"message":"Missing scope: channel:manage:broadcast"}';
    const { sent } = fetchAnswering(
      new Response(unauthorized, { status: 401 }),
      new Response(unauthorized, { status: 401 })
    );

    const result = await runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "createStreamMarker" });

    expect(result).toEqual({ ok: false, status: 401, body: unauthorized });
    expect(sent).toHaveLength(2);
  });

  test("throws for a success that is not JSON", async () => {
    fetchAnswering(new Response("<html>", { status: 200 }));
    await expect(runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "getChannelInformation" })).rejects.toThrow(
      "not JSON"
    );
  });

  test("throws when there is no token for the broadcaster, without a request", async () => {
    const { sent } = fetchAnswering();
    const auth = { ...fakeAuth(), getAccessTokenForUser: async () => null };

    await expect(runHelixOperation(auth, BROADCASTER_ID, { operation: "getChannelInformation" })).rejects.toThrow(
      "no Twitch token"
    );
    expect(sent).toEqual([]);
  });

  test("gives up on a request Twitch does not answer within the deadline", async () => {
    const sent: AbortSignal[] = [];
    stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          sent.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason));
        })
    );

    await expect(
      runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "createStreamMarker" }, { deadlineMs: 20 })
    ).rejects.toThrow("helix createStreamMarker: no answer within 0.02s; Twitch may still have acted");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.aborted).toBe(true);
  });

  test("gives up on a body Twitch does not finish sending within the deadline", async () => {
    const endless = new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode("{")) });
    fetchAnswering(new Response(endless, { status: 200 }));

    await expect(
      runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation: "getChannelInformation" }, { deadlineMs: 20 })
    ).rejects.toThrow("no answer within 0.02s");
  });

  test("counts the wait for a token against the deadline, and sends nothing after it", async () => {
    const { sent } = fetchAnswering(json(200, { data: [] }));
    const auth = { ...fakeAuth(), getAccessTokenForUser: () => new Promise<never>(() => {}) };

    await expect(
      runHelixOperation(auth, BROADCASTER_ID, { operation: "getChannelInformation" }, { deadlineMs: 20 })
    ).rejects.toThrow("no answer within 0.02s, before a request was sent");
    expect(sent).toEqual([]);
  });

  test("counts the token renewal after a 401 against the same deadline", async () => {
    const { sent } = fetchAnswering(new Response("", { status: 401 }), json(200, { data: [] }));
    const auth = { ...fakeAuth(), refreshAccessTokenForUser: () => new Promise<never>(() => {}) };

    await expect(
      runHelixOperation(auth, BROADCASTER_ID, { operation: "createStreamMarker" }, { deadlineMs: 20 })
    ).rejects.toThrow("Twitch may still have acted");
    expect(sent).toHaveLength(1);
  });

  test("refuses an unknown or inherited operation without a request", async () => {
    const { sent } = fetchAnswering();

    for (const operation of ["deleteVideos", "toString"]) {
      const err = await refusalOf(runHelixOperation(fakeAuth(), BROADCASTER_ID, { operation }));
      expect(err.code).toBe("invalid_arguments");
    }
    expect(sent).toEqual([]);
  });
});

describe("runHelixOperation, cancelled and observed", () => {
  test("guards a chat line sent through the legacy helix command", async () => {
    const { sent } = fetchAnswering(json(200, { data: [{ message_id: "m-1", is_sent: true }] }));

    await runHelixOperation(fakeAuth(), BROADCASTER_ID, {
      operation: "sendChatMessage",
      params: { message: "!hi" },
    });
    expect(sent[0]?.body).toEqual({ broadcaster_id: BROADCASTER_ID, sender_id: BROADCASTER_ID, message: "\u200b!hi" });
  });

  test("calls onSent once, before the request, even when a 401 makes it send again", async () => {
    const order: string[] = [];
    stubFetch(async () => {
      order.push("fetch");
      return order.filter((step) => step === "fetch").length === 1
        ? new Response("", { status: 401 })
        : json(200, { data: [] });
    });

    await runHelixOperation(
      fakeAuth(),
      BROADCASTER_ID,
      { operation: "createStreamMarker" },
      { onSent: () => order.push("sent") }
    );
    expect(order).toEqual(["sent", "fetch", "fetch"]);
  });

  test("does not call onSent when it never sends", async () => {
    const { sent } = fetchAnswering();
    let onSentCalls = 0;
    const auth = { ...fakeAuth(), getAccessTokenForUser: async () => null };

    await expect(
      runHelixOperation(auth, BROADCASTER_ID, { operation: "createStreamMarker" }, { onSent: () => onSentCalls++ })
    ).rejects.toThrow("no Twitch token");
    expect(onSentCalls).toBe(0);
    expect(sent).toEqual([]);
  });

  test("gives up when the caller's signal aborts after the request left, and says it was sent", async () => {
    stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signal.addEventListener("abort", () => reject(signal.reason));
        })
    );
    const caller = new AbortController();
    const run = runHelixOperation(
      fakeAuth(),
      BROADCASTER_ID,
      { operation: "sendChatMessage", params: { message: "hi" } },
      { signal: caller.signal, onSent: () => queueMicrotask(() => caller.abort(new Error("deadline"))) }
    );

    const err = await run.catch((error: unknown) => error);
    expect(err).toBeInstanceOf(HelixNoAnswer);
    expect((err as HelixNoAnswer).sent).toBe(true);
    expect((err as HelixNoAnswer).message).toBe(
      "helix sendChatMessage: the caller stopped waiting; Twitch may still have acted"
    );
  });

  test("sends nothing for a caller whose signal already aborted, and says it was not sent", async () => {
    const { sent } = fetchAnswering(json(200, { data: [] }));
    const caller = new AbortController();
    caller.abort(new Error("gone"));

    const err = await runHelixOperation(
      fakeAuth(),
      BROADCASTER_ID,
      { operation: "createStreamMarker" },
      { signal: caller.signal }
    ).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(HelixNoAnswer);
    expect((err as HelixNoAnswer).sent).toBe(false);
    expect(sent).toEqual([]);
  });

  test("reports a deadline that passed before sending as not sent", async () => {
    const auth = { ...fakeAuth(), getAccessTokenForUser: () => new Promise<never>(() => {}) };

    const err = await runHelixOperation(
      auth,
      BROADCASTER_ID,
      { operation: "createStreamMarker" },
      { deadlineMs: 20 }
    ).catch((error: unknown) => error);
    expect(err).toBeInstanceOf(HelixNoAnswer);
    expect((err as HelixNoAnswer).sent).toBe(false);
  });
});
