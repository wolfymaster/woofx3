import { describe, expect, mock, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";

function session(clientId: string) {
  const settings = new Map<string, string>();
  const db = {
    setSetting: mock(async (key: string, value: string) => {
      settings.set(key, value);
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
  });
  return { settings, rpc: new ApiSession(api, clientId) as unknown as Woofx3EngineApi };
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
