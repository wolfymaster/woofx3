import { describe, expect, mock, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { TwitchOAuthClient } from "@woofx3/twitch/oauth";
import { selectStrategy } from "@woofx3/twitch/token-strategy";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";

function session(clientId: string, twitch: Partial<Pick<ApiOptions, "twitchPublicClientId" | "twitchOAuth">> = {}) {
  const settings = new Map<string, string>();
  const db = {
    setSetting: mock(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    trySetSetting: mock(async (key: string, value: string) => {
      settings.set(key, value);
      return true;
    }),
    findOrCreateByWoofx3UIUserId: mock(async () => ({ id: "engine-user" })),
  };
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: { publish: mock(() => {}) } as unknown as ApiOptions["nats"],
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never,
    ...twitch,
  });
  return { settings, api, rpc: new ApiSession(api, clientId) as unknown as Woofx3EngineApi };
}

const TOKEN = { accessToken: "a", scope: ["chat:read"], expiresIn: 3600, obtainmentTimestamp: 1, userId: "42" };

describe("setTwitchToken", () => {
  test("stores a dashboard's token with the session's client id, to ask it for the next one", async () => {
    const { settings, rpc } = session("dash-client");
    await rpc.setTwitchToken({ ...TOKEN, clientId: "woofx3-app" });
    expect(JSON.parse(settings.get("twitch_token") ?? "")).toEqual({
      ...TOKEN,
      clientId: "woofx3-app",
      dashboardClientId: "dash-client",
    });
  });

  test("stores a token without an app client id as given, for the engine to refresh itself", async () => {
    const { settings, rpc } = session("dash-client");
    await rpc.setTwitchToken({ ...TOKEN, refreshToken: "r" });
    expect(JSON.parse(settings.get("twitch_token") ?? "")).toEqual({ ...TOKEN, refreshToken: "r" });
  });
});

describe("Twitch device login over RPC", () => {
  test("refuses without a public Twitch app configured", async () => {
    const { rpc } = session("local-ui");
    expect(await rpc.startTwitchDeviceLogin()).toMatchObject({ ok: false, code: "not_configured" });
  });

  test("stores the linked token like setTwitchToken, for the engine to refresh itself", async () => {
    const answers: Record<string, () => Response> = {
      "/oauth2/device": () =>
        Response.json({
          device_code: "dev",
          user_code: "ABCDEFGH",
          verification_uri: "https://www.twitch.tv/activate",
          expires_in: 1800,
          interval: 1,
        }),
      "/oauth2/token": () =>
        Response.json({ access_token: "a1", refresh_token: "r1", scope: ["chat:read"], expires_in: 14_000 }),
      "/oauth2/validate": () =>
        Response.json({
          client_id: "public-app",
          login: "streamer",
          scopes: ["chat:read"],
          user_id: "42",
          expires_in: 1,
        }),
    };
    const twitchOAuth = new TwitchOAuthClient({
      baseUrl: "https://id.test",
      fetch: async (url) => (answers[new URL(url).pathname] ?? (() => new Response("", { status: 404 })))(),
    });
    const { settings, api, rpc } = session("local-ui", { twitchPublicClientId: "public-app", twitchOAuth });

    const started = await rpc.startTwitchDeviceLogin(["chat:read"]);
    if (!started.ok) {
      throw new Error(started.error);
    }
    let state = await rpc.getTwitchDeviceLogin(started.login.loginId);
    for (let i = 0; i < 100 && state.ok && state.state.status === "pending"; i++) {
      await Bun.sleep(25);
      state = await rpc.getTwitchDeviceLogin(started.login.loginId);
    }
    api.twitchDeviceLogins.stop();

    expect(state).toMatchObject({ ok: true, state: { status: "linked", linked: { userId: "42", login: "streamer" } } });
    const stored = JSON.parse(settings.get("twitch_token") ?? "");
    expect(stored).toMatchObject({ accessToken: "a1", refreshToken: "r1", userId: "42", publicClientId: "public-app" });
    expect(stored.clientId).toBeUndefined();
    expect(selectStrategy(stored)).toBe("engineRefresh");
    expect(settings.get("integration.twitch.enabled")).toBe("true");
  });
});
