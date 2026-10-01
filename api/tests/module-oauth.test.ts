import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function session() {
  const api = new Api({
    db: {} as ApiOptions["db"],
    nats: null,
    functions: null,
    barkloaderUrl: "http://barkloader.local/",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never,
  });
  return new ApiSession(api, "dash-client") as unknown as Woofx3EngineApi;
}

const AUTHORIZATION = { code: "c", codeVerifier: "v", redirectUri: "https://dash/cb" };

describe("completeModuleOAuth", () => {
  test("hands the authorization to barkloader and answers with the granted scopes", async () => {
    const fetchMock = mock(async (_url: string, _init: RequestInit) =>
      Response.json({ connected: true, scope: ["user-read-playback-state"] })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await session().completeModuleOAuth("spotify", "spotify", AUTHORIZATION)).toEqual({
      connected: true,
      scope: ["user-read-playback-state"],
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://barkloader.local/modules/spotify/oauth/spotify/complete");
    expect(JSON.parse(String(init?.body))).toEqual(AUTHORIZATION);
  });

  test("rejects with barkloader's reason", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ error: "spotify: the token endpoint answered 400 (invalid_grant)" }, { status: 400 })
    ) as unknown as typeof fetch;
    await expect(session().completeModuleOAuth("spotify", "spotify", AUTHORIZATION)).rejects.toThrow("invalid_grant");
  });
});
