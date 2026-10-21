import { describe, expect, test } from "bun:test";
import { DEVICE_CODE_GRANT_TYPE, type Fetch, TwitchOAuthClient, TwitchOAuthError } from "./oauth";

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

  test("refuses a verification page that is not https", async () => {
    const { client } = fakeTwitch(() =>
      json(200, {
        device_code: "d",
        user_code: "u",
        verification_uri: "javascript:alert(1)",
        expires_in: 1,
        interval: 1,
      })
    );
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

  test("reads Twitch's error codes from message, and RFC 8628's from error", async () => {
    expect((await poll(() => json(400, { status: 400, message: "authorization_pending" }))).result).toEqual({
      kind: "pending",
    });
    expect((await poll(() => json(400, { error: "slow_down" }))).result).toEqual({ kind: "slowDown" });
    expect((await poll(() => json(400, { error: "expired_token" }))).result.kind).toBe("expired");
    expect((await poll(() => json(400, { status: 400, message: "invalid device code" }))).result.kind).toBe("expired");
    expect((await poll(() => json(400, { error: "access_denied" }))).result.kind).toBe("denied");
    expect((await poll(() => json(400, { status: 400, message: "something new" }))).result).toEqual({
      kind: "failed",
      reason: "something new (HTTP 400)",
    });
  });

  test("a Twitch outage or a network error is unavailable, not the end of the login", async () => {
    expect((await poll(() => new Response("bad gateway", { status: 502 }))).result).toEqual({
      kind: "unavailable",
      reason: "HTTP 502",
    });
    const offline = await poll(() => {
      throw new TypeError("connection refused");
    });
    expect(offline.result).toEqual({ kind: "unavailable", reason: "could not reach Twitch: connection refused" });
  });
});

describe("refresh", () => {
  test("refreshes as a public client, with no secret, and returns the rotated refresh token", async () => {
    const { sent, client } = fakeTwitch(() => json(200, { ...TOKEN_BODY, access_token: "a2", refresh_token: "r2" }));
    const token = await client.refresh("public-app", "r1");
    expect(token).toMatchObject({ accessToken: "a2", refreshToken: "r2", obtainmentTimestamp: NOW });
    expect(sent[0]?.form).toEqual({ client_id: "public-app", grant_type: "refresh_token", refresh_token: "r1" });
  });

  test("a spent refresh token is refused", async () => {
    const { client } = fakeTwitch(() =>
      json(400, { error: "Bad Request", status: 400, message: "Invalid refresh token" })
    );
    const err = await client.refresh("public-app", "r1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwitchOAuthError);
    expect((err as TwitchOAuthError).refused).toBe(true);
  });

  test("an unreachable Twitch is not a refusal", async () => {
    const { client } = fakeTwitch(() => {
      throw new TypeError("offline");
    });
    const err = await client.refresh("public-app", "r1").catch((e: unknown) => e);
    expect((err as TwitchOAuthError).refused).toBe(false);
  });

  test("an answer without a new refresh token is malformed: the old one is already spent", async () => {
    const { client } = fakeTwitch(() => json(200, { access_token: "a2", expires_in: 100 }));
    await expect(client.refresh("public-app", "r1")).rejects.toThrow("malformed");
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
});
