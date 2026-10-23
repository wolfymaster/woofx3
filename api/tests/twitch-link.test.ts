import { describe, expect, mock, test } from "bun:test";
import { ENGINE_CAPABILITIES, supportedEngineCapabilities, type Woofx3EngineApi } from "@woofx3/api";
import { type CallbackEvent, EngineEventType } from "@woofx3/api/webhooks";
import { TwitchOAuthClient } from "@woofx3/twitch/oauth";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession, RPC_METHODS } from "../src/api-session";
import type { WebhookClient } from "../src/webhook-client";

const TOKEN = {
  accessToken: "secret-access",
  refreshToken: "secret-refresh",
  scope: ["chat:read", "moderator:read:chatters"],
  expiresIn: 3600,
  obtainmentTimestamp: 1_000,
  userId: "42",
};

/** The engine's clock, which stands still; the link's revisions start here. */
const CLOCK = 1_792_670_400_000;

const HELIX_USER = {
  id: "42",
  login: "streamer",
  display_name: "Streamer",
  profile_image_url: "https://static-cdn.example/streamer.png",
};

/** The Twitch adapter's reply to a `helix` request, or an Error the bus throws. */
type HelixReply = { ok: true; body: unknown } | Error;

function engine(opts: {
  helix?: HelixReply;
  twitch?: Partial<Pick<ApiOptions, "twitchPublicClientId" | "twitchOAuth">>;
}) {
  const settings = new Map<string, string>();
  const db = {
    getSetting: mock(async (key: string) => settings.get(key) ?? null),
    setSetting: mock(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    trySetSetting: mock(async (key: string, value: string) => {
      settings.set(key, value);
      return true;
    }),
    findOrCreateByWoofx3UIUserId: mock(async () => ({ id: "engine-user" })),
  };
  const helixAsked: unknown[] = [];
  let helix: HelixReply = opts.helix ?? { ok: true, body: { data: [HELIX_USER] } };
  const nats = {
    publish: mock(async () => {}),
    request: mock(async (_subject: string, data: Uint8Array) => {
      helixAsked.push(JSON.parse(new TextDecoder().decode(data)));
      if (helix instanceof Error) {
        throw helix;
      }
      const reply = { id: "1", type: "twitchapi.helix.result", source: "twitchapi", time: "", data: helix };
      return { data: new TextEncoder().encode(JSON.stringify(reply)) };
    }),
  };
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: nats as unknown as ApiOptions["nats"],
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    barkloaderKey: "test-barkloader-key-0123456789abcdef",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never,
    clock: () => CLOCK,
    ...opts.twitch,
  });
  const sent: CallbackEvent[] = [];
  api.setWebhookClient({
    send: mock(async (event: CallbackEvent) => {
      sent.push(event);
    }),
  } as unknown as WebhookClient);
  const rpc = new ApiSession(api, "local-ui") as unknown as Woofx3EngineApi;
  return {
    api,
    rpc,
    settings,
    helixAsked,
    sent,
    setHelix: (reply: HelixReply) => {
      helix = reply;
    },
  };
}

function linkEvents(sent: CallbackEvent[]) {
  return sent.filter((event) => event.type === EngineEventType.TWITCH_LINK_CHANGED);
}

describe("getTwitchLink", () => {
  test("is not linked while no account is linked", async () => {
    const { rpc, helixAsked } = engine({});

    expect(await rpc.getTwitchLink()).toEqual({ linked: false, revision: CLOCK });
    expect(helixAsked).toEqual([]);
  });

  test("describes the linked account with its Helix profile, and no token", async () => {
    const { rpc, helixAsked } = engine({});
    await rpc.setTwitchToken(TOKEN);

    const link = await rpc.getTwitchLink();

    expect(link).toEqual({
      linked: true,
      revision: CLOCK + 1,
      userId: "42",
      login: "streamer",
      displayName: "Streamer",
      profileImageUrl: "https://static-cdn.example/streamer.png",
      scopes: ["chat:read", "moderator:read:chatters"],
      expiresAt: 3_601_000,
      authFailedAt: null,
    });
    expect(JSON.stringify(link)).not.toContain("secret");
    expect(helixAsked).toEqual([{ command: "helix", args: { operation: "getUsers", params: { id: "42" } } }]);
  });

  test("asks Helix once for repeated reads", async () => {
    const { rpc, helixAsked } = engine({});
    await rpc.setTwitchToken(TOKEN);

    await rpc.getTwitchLink();
    await rpc.getTwitchLink();

    expect(helixAsked).toHaveLength(1);
  });

  test("still describes the link without a profile when the Twitch adapter cannot be asked, and asks again next time", async () => {
    const { rpc, helixAsked, setHelix } = engine({ helix: new Error("timeout") });
    await rpc.setTwitchToken(TOKEN);

    expect(await rpc.getTwitchLink()).toMatchObject({
      userId: "42",
      login: null,
      displayName: null,
      profileImageUrl: null,
    });

    setHelix({ ok: true, body: { data: [HELIX_USER] } });
    expect(await rpc.getTwitchLink()).toMatchObject({ login: "streamer" });
    expect(helixAsked).toHaveLength(2);
  });

  test("asks Helix again once the link changes, so a relinked account shows its new name", async () => {
    const { rpc, helixAsked, setHelix } = engine({});
    await rpc.setTwitchToken(TOKEN);
    await rpc.getTwitchLink();

    setHelix({ ok: true, body: { data: [{ ...HELIX_USER, login: "renamed", display_name: "Renamed" }] } });
    await rpc.setTwitchToken(TOKEN);

    expect(await rpc.getTwitchLink()).toMatchObject({ login: "renamed", displayName: "Renamed" });
    expect(helixAsked).toHaveLength(2);
  });
});

describe("twitch.link.changed", () => {
  test("is sent when a token is set and when it is deleted", async () => {
    const { rpc, sent } = engine({});

    await rpc.setTwitchToken(TOKEN);
    await rpc.deleteTwitchToken();

    expect(linkEvents(sent)).toEqual([
      {
        type: EngineEventType.TWITCH_LINK_CHANGED,
        revision: CLOCK + 1,
        linked: true,
        userId: "42",
        authFailedAt: null,
      },
      { type: EngineEventType.TWITCH_LINK_CHANGED, revision: CLOCK + 2, linked: false },
    ]);
    expect((await rpc.getTwitchLink()).revision).toBe(CLOCK + 2);
  });

  test("is sent when a device login links an account", async () => {
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
    const { api, rpc, sent } = engine({ twitch: { twitchPublicClientId: "public-app", twitchOAuth } });

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

    expect(state).toMatchObject({ ok: true, state: { status: "linked" } });
    expect(linkEvents(sent)).toEqual([
      {
        type: EngineEventType.TWITCH_LINK_CHANGED,
        revision: CLOCK + 1,
        linked: true,
        userId: "42",
        authFailedAt: null,
      },
    ]);
  });
});

test("advertises twitch.linkRead, and getTwitchLink is reachable over RPC", () => {
  expect(supportedEngineCapabilities()).toContain(ENGINE_CAPABILITIES.twitchLinkRead);
  expect(RPC_METHODS as readonly string[]).toContain("getTwitchLink");
});
