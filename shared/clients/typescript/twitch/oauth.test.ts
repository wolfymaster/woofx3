import { describe, expect, test } from "bun:test";
import { DEVICE_CODE_GRANT_TYPE, type DevicePoll, type Fetch, TwitchOAuthClient, TwitchOAuthError } from "./oauth";

const NOW = 1_000_000_000_000;

interface Sent {
  url: string;
  method: string;
  form: Record<string, string>;
  headers: Headers;
}

/** A fetch that answers every request with `answer` and records what was sent. */
function fakeTwitch(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    const request: Sent = {
      url,
      method: init?.method ?? "GET",
      form: Object.fromEntries(new URLSearchParams(typeof init?.body === "string" ? init.body : "")),
      headers: new Headers(init?.headers),
    };
    sent.push(request);
    return answer(request);
  };
  return { sent, client: new TwitchOAuthClient({ fetch, baseUrl: "https://id.test/", now: () => NOW }) };
}

/** A client whose Twitch never answers, or answers headers and then never finishes the body. */
function hungTwitch(hang: "connect" | "body") {
  const fetch: Fetch = (_url, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const aborted = () => signal?.reason ?? new Error("aborted");
      if (hang === "connect") {
        signal?.addEventListener("abort", () => reject(aborted()));
        return;
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
          signal?.addEventListener("abort", () => controller.error(aborted()));
        },
      });
      resolve(new Response(body, { status: 200 }));
    });
  return new TwitchOAuthClient({ fetch, baseUrl: "https://id.test", now: () => NOW, requestTimeoutMs: 20 });
}

/** A response whose body fails to read. */
function brokenBody(status: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("connection reset mid-body"));
    },
  });
  return new Response(body, { status });
}

const DEVICE_BODY = {
  device_code: "dev",
  user_code: "ABCDEFGH",
  verification_uri: "https://www.twitch.tv/activate",
  expires_in: 1800,
  interval: 5,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TOKEN_BODY = { access_token: "a1", refresh_token: "r1", scope: ["chat:read"], expires_in: 14_000 };

describe("startDeviceAuthorization", () => {
  test("asks for the scopes with the client id alone and reads the code", async () => {
    const { sent, client } = fakeTwitch(() =>
      json(200, {
        device_code: "dev",
        user_code: "ABCDEFGH",
        verification_uri: "https://www.twitch.tv/activate?device-code=ABCDEFGH",
        expires_in: 1800,
        interval: 5,
      })
    );

    expect(await client.startDeviceAuthorization("public-app", ["chat:read", "user:bot"])).toEqual({
      deviceCode: "dev",
      userCode: "ABCDEFGH",
      verificationUri: "https://www.twitch.tv/activate?device-code=ABCDEFGH",
      expiresInSeconds: 1800,
      intervalSeconds: 5,
    });
    expect(sent[0]?.url).toBe("https://id.test/oauth2/device");
    expect(sent[0]?.form).toEqual({ client_id: "public-app", scopes: "chat:read user:bot" });
  });

  test("throws Twitch's refusal", async () => {
    const { client } = fakeTwitch(() => json(400, { status: 400, message: "invalid client" }));
    await expect(client.startDeviceAuthorization("bad", ["chat:read"])).rejects.toThrow("invalid client (HTTP 400)");
  });

  test.each([
    ["a verification page that is not https", { verification_uri: "javascript:alert(1)" }],
    ["a verification page that is not a URL", { verification_uri: "activate" }],
    ["no device code", { device_code: undefined }],
    ["an empty device code", { device_code: "" }],
    ["no user code", { user_code: undefined }],
    ["an empty user code", { user_code: "" }],
    ["a zero interval", { interval: 0 }],
    ["a negative interval", { interval: -5 }],
    ["no interval", { interval: undefined }],
    ["a zero expiry", { expires_in: 0 }],
    ["a negative expiry", { expires_in: -1 }],
    ["an expiry that is not a number", { expires_in: "1800" }],
  ])("refuses an answer with %s", async (_, change) => {
    const { client } = fakeTwitch(() => json(200, { ...DEVICE_BODY, ...change }));
    const err = await client.startDeviceAuthorization("public-app", ["chat:read"]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwitchOAuthError);
    expect((err as TwitchOAuthError).message).toContain("malformed");
  });

  test.each([
    ["not JSON", () => new Response("<html>oops</html>", { status: 200 })],
    ["empty", () => new Response("", { status: 200 })],
    ["a JSON array", () => json(200, [DEVICE_BODY])],
  ])("refuses an answer whose body is %s", async (_, answer) => {
    const { client } = fakeTwitch(answer);
    await expect(client.startDeviceAuthorization("public-app", ["chat:read"])).rejects.toThrow("malformed");
  });
});

describe("pollDeviceToken", () => {
  async function poll(response: () => Response | Promise<Response>) {
    const { sent, client } = fakeTwitch(response);
    return { result: await client.pollDeviceToken("public-app", "dev", ["chat:read"]), sent };
  }

  test("sends the device code grant and returns the issued token", async () => {
    const { result, sent } = await poll(() => json(200, TOKEN_BODY));
    expect(result).toEqual({
      kind: "token",
      token: {
        accessToken: "a1",
        refreshToken: "r1",
        scope: ["chat:read"],
        expiresIn: 14_000,
        obtainmentTimestamp: NOW,
      },
    });
    expect(sent[0]?.form).toEqual({
      client_id: "public-app",
      device_code: "dev",
      grant_type: DEVICE_CODE_GRANT_TYPE,
      scopes: "chat:read",
    });
    expect(sent[0]?.form.client_secret).toBeUndefined();
  });

  // Twitch puts the OAuth error code in `message`; RFC 8628 puts it in `error`.
  test.each([
    ["Twitch's authorization_pending", { status: 400, message: "authorization_pending" }, { kind: "pending" }],
    ["RFC 8628's authorization_pending", { error: "authorization_pending" }, { kind: "pending" }],
    ["slow_down", { error: "slow_down" }, { kind: "slowDown" }],
    ["Slow_Down in another case", { message: "Slow_Down" }, { kind: "slowDown" }],
    ["expired_token", { error: "expired_token" }, { kind: "expired", reason: "expired_token (HTTP 400)" }],
    [
      "an unknown device code",
      { status: 400, message: "invalid device code" },
      { kind: "expired", reason: "invalid device code (HTTP 400)" },
    ],
    ["access_denied", { error: "access_denied" }, { kind: "denied", reason: "access_denied (HTTP 400)" }],
    [
      "an unknown code",
      { status: 400, message: "something new" },
      { kind: "failed", reason: "something new (HTTP 400)" },
    ],
    ["no code at all", { status: 400 }, { kind: "failed", reason: "HTTP 400" }],
  ])("reads %s", async (_, body, expected) => {
    expect((await poll(() => json(400, body))).result).toEqual(expected as DevicePoll);
  });

  test.each([
    ["not JSON", () => new Response("<html>bad request</html>", { status: 400 })],
    ["empty", () => new Response("", { status: 400 })],
  ])("a refusal whose body is %s fails on its status alone", async (_, answer) => {
    expect((await poll(answer)).result).toEqual({ kind: "failed", reason: "HTTP 400" });
  });

  test.each([
    ["no access token", { ...TOKEN_BODY, access_token: undefined }],
    ["an empty access token", { ...TOKEN_BODY, access_token: "" }],
    ["no refresh token", { ...TOKEN_BODY, refresh_token: undefined }],
    ["an empty refresh token", { ...TOKEN_BODY, refresh_token: "" }],
    ["an expiry that is not a number", { ...TOKEN_BODY, expires_in: "14000" }],
    ["no expiry", { ...TOKEN_BODY, expires_in: undefined }],
  ])("an issued token with %s fails the login", async (_, body) => {
    expect((await poll(() => json(200, body))).result).toEqual({
      kind: "failed",
      reason: "Twitch's token answer is malformed",
    });
  });

  test.each([
    ["not JSON", () => new Response("<html>ok</html>", { status: 200 })],
    ["empty", () => new Response("", { status: 200 })],
  ])("an approval whose body is %s fails the login", async (_, answer) => {
    expect((await poll(answer)).result).toEqual({ kind: "failed", reason: "Twitch's token answer is malformed" });
  });

  test.each([
    ["missing", undefined],
    ["not a list", "chat:read"],
    ["a list with a non-string", ["chat:read", 7]],
  ])("an issued token whose scope is %s has no scopes", async (_, scope) => {
    const { result } = await poll(() => json(200, { ...TOKEN_BODY, scope }));
    expect(result).toMatchObject({ kind: "token", token: { accessToken: "a1", scope: [] } });
  });

  test.each([
    ["a 502", () => new Response("bad gateway", { status: 502 }), "HTTP 502"],
    ["a 503 with a code", () => json(503, { message: "service unavailable" }), "service unavailable (HTTP 503)"],
    [
      "a network error",
      () => {
        throw new TypeError("connection refused");
      },
      "could not reach Twitch: connection refused",
    ],
    ["a body that breaks off", () => brokenBody(200), "could not reach Twitch: connection reset mid-body"],
  ])("%s is unavailable, not the end of the login", async (_, answer, reason) => {
    expect((await poll(answer)).result).toEqual({ kind: "unavailable", reason });
  });

  test.each([
    "connect",
    "body",
  ] as const)("a Twitch that hangs (%s) is unavailable once the request times out", async (hang) => {
    const result = await hungTwitch(hang).pollDeviceToken("public-app", "dev", ["chat:read"]);
    expect(result.kind).toBe("unavailable");
    expect((result as { reason: string }).reason).toContain("could not reach Twitch");
  });
});

describe("refresh", () => {
  test("refreshes as a public client, with no secret, and returns the rotated refresh token", async () => {
    const { sent, client } = fakeTwitch(() => json(200, { ...TOKEN_BODY, access_token: "a2", refresh_token: "r2" }));
    const token = await client.refresh("public-app", "r1");
    expect(token).toMatchObject({ accessToken: "a2", refreshToken: "r2", obtainmentTimestamp: NOW });
    expect(sent[0]?.form).toEqual({ client_id: "public-app", grant_type: "refresh_token", refresh_token: "r1" });
  });

  // A refusal means the refresh token is spent and only a new link replaces
  // it, so anything that is not Twitch deciding must not count as one.
  test.each([
    [
      "a spent refresh token (400)",
      () => json(400, { error: "Bad Request", status: 400, message: "Invalid refresh token" }),
      400,
      true,
    ],
    ["an unauthorized client (401)", () => json(401, { status: 401, message: "invalid client" }), 401, true],
    ["a Twitch failure (500)", () => json(500, { status: 500, message: "internal error" }), 500, false],
    ["a Twitch outage (503)", () => new Response("unavailable", { status: 503 }), 503, false],
    [
      "an unreachable Twitch",
      () => {
        throw new TypeError("offline");
      },
      null,
      false,
    ],
    ["a body that breaks off", () => brokenBody(400), null, false],
  ])("%s", async (_, answer, status, refused) => {
    const { client } = fakeTwitch(answer);
    const err = await client.refresh("public-app", "r1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwitchOAuthError);
    expect((err as TwitchOAuthError).status).toBe(status);
    expect((err as TwitchOAuthError).refused).toBe(refused);
  });

  test.each([
    ["no new refresh token: the old one is already spent", { access_token: "a2", expires_in: 100 }],
    ["no access token", { refresh_token: "r2", expires_in: 100 }],
    ["no expiry", { access_token: "a2", refresh_token: "r2" }],
  ])("an answer with %s is malformed", async (_, body) => {
    const { client } = fakeTwitch(() => json(200, body));
    const err = await client.refresh("public-app", "r1").catch((e: unknown) => e);
    expect((err as TwitchOAuthError).message).toContain("malformed");
    expect((err as TwitchOAuthError).refused).toBe(false);
  });

  test("a Twitch that hangs is given up on, and is not a refusal", async () => {
    const err = await hungTwitch("connect")
      .refresh("public-app", "r1")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwitchOAuthError);
    expect((err as TwitchOAuthError).refused).toBe(false);
  });
});

describe("validate", () => {
  test("names the user and app a token belongs to", async () => {
    const { sent, client } = fakeTwitch(() =>
      json(200, { client_id: "public-app", login: "streamer", scopes: ["chat:read"], user_id: "42", expires_in: 100 })
    );
    expect(await client.validate("a1")).toEqual({
      clientId: "public-app",
      userId: "42",
      login: "streamer",
      scopes: ["chat:read"],
      expiresIn: 100,
    });
    expect(sent[0]?.headers.get("Authorization")).toBe("OAuth a1");
  });

  test("throws when Twitch refuses the token", async () => {
    const { client } = fakeTwitch(() => json(401, { status: 401, message: "invalid access token" }));
    await expect(client.validate("a1")).rejects.toThrow("invalid access token");
  });

  const VALID = { client_id: "public-app", login: "streamer", scopes: ["chat:read"], user_id: "42", expires_in: 100 };

  test.each([
    ["no user id", { ...VALID, user_id: undefined }],
    ["an empty user id", { ...VALID, user_id: "" }],
    ["no client id", { ...VALID, client_id: undefined }],
    ["an empty client id", { ...VALID, client_id: "" }],
    ["no login", { ...VALID, login: undefined }],
    ["scopes that are not a list", { ...VALID, scopes: "chat:read" }],
    ["scopes with a non-string", { ...VALID, scopes: ["chat:read", 1] }],
    ["no expiry", { ...VALID, expires_in: undefined }],
  ])("refuses an answer with %s", async (_, body) => {
    const { client } = fakeTwitch(() => json(200, body));
    await expect(client.validate("a1")).rejects.toThrow("malformed");
  });

  test.each([
    ["not JSON", () => new Response("<html>ok</html>", { status: 200 })],
    ["empty", () => new Response("", { status: 200 })],
  ])("refuses an answer whose body is %s", async (_, answer) => {
    const { client } = fakeTwitch(answer);
    await expect(client.validate("a1")).rejects.toThrow("malformed");
  });

  test.each(["connect", "body"] as const)("gives up on a Twitch that hangs (%s)", async (hang) => {
    const err = await hungTwitch(hang)
      .validate("a1")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwitchOAuthError);
    expect((err as TwitchOAuthError).status).toBeNull();
    expect((err as TwitchOAuthError).message).toContain("could not reach Twitch");
  });

  test("a body that breaks off is a TwitchOAuthError, not a raw stream error", async () => {
    const { client } = fakeTwitch(() => brokenBody(200));
    const err = await client.validate("a1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwitchOAuthError);
    expect((err as TwitchOAuthError).message).toBe("could not reach Twitch: connection reset mid-body");
  });
});

describe("TwitchOAuthClient", () => {
  test.each([0, -1, Number.NaN])("refuses a request timeout of %p", (requestTimeoutMs) => {
    expect(() => new TwitchOAuthClient({ requestTimeoutMs })).toThrow("requestTimeoutMs");
  });
});
