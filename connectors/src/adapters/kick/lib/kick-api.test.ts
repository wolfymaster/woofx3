import { afterEach, describe, expect, test } from "bun:test";
import type { KickTokenGrant } from "@woofx3/api/webhooks";
import { FakeTime } from "../../../host/testing";
import { type FakeKickServer, kickError, kickJson, startFakeKick } from "../fake-kick-server";
import { KickApi, type KickApiDeps } from "./kick-api";
import type { KickTokenResult } from "./token";

const USER_AGENT = "woofx3-test";

function grant(accessToken: string): KickTokenGrant {
  return { userId: "4242", accessToken, scope: [], expiresIn: 7200, obtainmentTimestamp: 0, clientId: "app" };
}

/** A token source that serves `token-1`, and `token-2` when forced, as a renewal after a 401 would. */
function tokens(result?: KickTokenResult) {
  const asked: boolean[] = [];
  return {
    asked,
    token: {
      get: async (opts: { force?: boolean } = {}): Promise<KickTokenResult> => {
        asked.push(opts.force === true);
        return result ?? { ok: true, token: grant(opts.force === true ? "token-2" : "token-1") };
      },
    },
  };
}

let kick: FakeKickServer;

function api(overrides: Partial<KickApiDeps> = {}): KickApi {
  return new KickApi({
    fetch,
    token: tokens().token,
    clock: new FakeTime(),
    baseUrl: kick.url,
    timeoutMs: 2000,
    tokenTimeoutMs: 2000,
    userAgent: USER_AGENT,
    signal: new AbortController().signal,
    ...overrides,
  });
}

afterEach(async () => {
  await kick.stop();
});

describe("KickApi reads", () => {
  test("self converts Kick's integer user id to a string", async () => {
    kick = startFakeKick();
    expect(await api().self()).toEqual({
      ok: true,
      value: { userId: "4242", name: "wolfy", profilePicture: "https://files.kick.com/wolfy.png" },
    });
  });

  const channelQueries: [name: string, query: Parameters<KickApi["channels"]>[0], params: [string, string][]][] = [
    ["its own channel", "self", []],
    ["channels by id", { ids: ["4242"] }, [["broadcaster_user_id", "4242"]]],
    ["channels by slug", { slugs: ["wolfy"] }, [["slug", "wolfy"]]],
  ];
  for (const [name, query, params] of channelQueries) {
    test(`channels reads ${name}`, async () => {
      kick = startFakeKick();
      const result = await api().channels(query);
      expect(result).toMatchObject({
        ok: true,
        value: [{ broadcasterUserId: "4242", slug: "wolfy", title: "cozy stream", stream: { isLive: false } }],
      });
      expect([...(kick.requests[0]?.query.entries() ?? [])]).toEqual(params);
    });
  }

  const categories: [name: string, search: string, found: { id: number; name: string } | null][] = [
    ["an exact name over a longer one", "minecraft", { id: 101, name: "Minecraft" }],
    ["Kick's first match when none is exact", "dungeons", { id: 102, name: "Minecraft Dungeons" }],
    ["nothing when nothing matches", "chess", null],
  ];
  for (const [name, search, found] of categories) {
    test(`findCategory picks ${name}`, async () => {
      kick = startFakeKick();
      expect(await api().findCategory(search)).toEqual({ ok: true, value: found });
    });
  }

  test("publicKey is read without a token", async () => {
    kick = startFakeKick();
    kick.state.publicKeyPem = "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----";
    const source = tokens();
    expect(await api({ token: source.token }).publicKey()).toEqual({ ok: true, value: kick.state.publicKeyPem });
    expect(kick.requests[0]?.headers.get("authorization")).toBeNull();
    expect(source.asked).toEqual([]);
  });
});

describe("KickApi writes", () => {
  test("sendChat posts as the user into the broadcaster's chat and returns the message id", async () => {
    kick = startFakeKick();
    const result = await api().sendChat({ content: "hi", broadcasterUserId: "4242", replyTo: "m-0" });
    expect(result).toEqual({ ok: true, value: { messageId: "msg-0001", sent: true } });
    expect(kick.requests[0]?.body).toEqual({
      content: "hi",
      type: "user",
      broadcaster_user_id: 4242,
      reply_to_message_id: "m-0",
    });
  });

  test("ban sends a timeout's duration in minutes", async () => {
    kick = startFakeKick();
    expect(await api().ban({ broadcasterUserId: "4242", userId: "7", durationMinutes: 2 })).toEqual({
      ok: true,
      value: null,
    });
    expect(kick.state.bans).toEqual([{ broadcaster_user_id: 4242, user_id: 7, duration: 2 }]);
  });

  test("updateChannel sends only the fields given", async () => {
    kick = startFakeKick();
    await api().updateChannel({ title: "new" });
    expect(kick.requests[0]?.body).toEqual({ stream_title: "new" });
  });
});

describe("KickApi failures", () => {
  test("a {message}-only error is an http failure without a code", async () => {
    kick = startFakeKick();
    kick.route("GET", "/public/v1/users", () => kickError(404, "Not Found"));
    expect(await api().self()).toEqual({
      ok: false,
      error: {
        kind: "http",
        status: 404,
        code: undefined,
        message: "Kick answered 404: Not Found",
        retryAfterMs: undefined,
      },
    });
  });

  test("an error envelope's data string is its code", async () => {
    kick = startFakeKick();
    kick.route("PATCH", "/public/v1/channels", () => kickError(400, "Bad request", "CHANNEL_IS_NOT_LIVE"));
    expect(await api().updateChannel({ title: "x" })).toMatchObject({
      ok: false,
      error: { kind: "http", status: 400, code: "CHANNEL_IS_NOT_LIVE" },
    });
  });

  test("a 401 is retried once with a renewed token", async () => {
    kick = startFakeKick();
    kick.state.validTokens = new Set(["token-2"]);
    const source = tokens();
    expect(await api({ token: source.token }).self()).toMatchObject({ ok: true, value: { userId: "4242" } });
    expect(source.asked).toEqual([false, true]);
  });

  test("a 401 on the renewed token too is the failure", async () => {
    kick = startFakeKick();
    kick.state.validTokens = new Set();
    expect(await api().self()).toMatchObject({ ok: false, error: { kind: "http", status: 401 } });
    expect(kick.requests).toHaveLength(2);
  });

  const rateLimits: [name: string, headers: Record<string, string>, retryAfterMs: number | undefined][] = [
    ["with Retry-After seconds", { "Retry-After": "3" }, 3000],
    ["without Retry-After", {}, undefined],
  ];
  for (const [name, headers, retryAfterMs] of rateLimits) {
    test(`a 429 ${name}`, async () => {
      kick = startFakeKick();
      kick.route("POST", "/public/v1/chat", () => Response.json({ message: "slow down" }, { status: 429, headers }));
      expect(await api().sendChat({ content: "hi", broadcasterUserId: "4242" })).toMatchObject({
        ok: false,
        error: { kind: "http", status: 429, retryAfterMs },
      });
      expect(kick.requests).toHaveLength(1);
    });
  }

  test("no answer in time is a timeout, and a write is not resent", async () => {
    kick = startFakeKick();
    kick.route("POST", "/public/v1/chat", () => new Promise<Response>(() => {}));
    expect(await api({ timeoutMs: 50 }).sendChat({ content: "hi", broadcasterUserId: "4242" })).toEqual({
      ok: false,
      error: { kind: "timeout" },
    });
    expect(kick.requests).toHaveLength(1);
  });

  test("a refused connection is unreachable", async () => {
    kick = startFakeKick();
    const closed = kick.url;
    await kick.stop();
    kick = startFakeKick();
    expect(await api({ baseUrl: closed }).self()).toMatchObject({ ok: false, error: { kind: "unreachable" } });
  });

  test("no linked account is not_linked, and nothing is sent", async () => {
    kick = startFakeKick();
    const source = tokens({ ok: false, failure: { reason: "not_linked", message: "Kick is not linked" } });
    expect(await api({ token: source.token }).self()).toEqual({ ok: false, error: { kind: "not_linked" } });
    expect(kick.requests).toEqual([]);
  });

  test("a 2xx that is not the documented shape is malformed", async () => {
    kick = startFakeKick();
    kick.route("GET", "/public/v1/users", () => kickJson([{ user_id: "not a number", name: "x" }]));
    expect(await api().self()).toMatchObject({ ok: false, error: { kind: "malformed" } });
  });

  test("every request carries the user agent", async () => {
    kick = startFakeKick();
    const client = api();
    await client.self();
    await client.publicKey();
    await client.rewards();
    expect(kick.requests.map((r) => r.headers.get("user-agent"))).toEqual([USER_AGENT, USER_AGENT, USER_AGENT]);
  });
});
