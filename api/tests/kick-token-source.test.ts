import { describe, expect, mock, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import type { KickTokenGrant } from "@woofx3/api/webhooks";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";
import { SessionLease } from "../src/client-sessions";
import {
  answerKickTokenRequest,
  KICK_TOKEN_SETTING,
  KickTokenSource,
  parseKickTokenResponse,
} from "../src/kick-token-source";

const NOW = 1_000_000_000_000;

const GRANT: KickTokenGrant = {
  userId: "4242",
  accessToken: "access-1",
  scope: ["user:read", "chat:write"],
  expiresIn: 7200,
  obtainmentTimestamp: NOW,
  clientId: "kick-app",
};

const RENEWED: KickTokenGrant = { ...GRANT, accessToken: "access-2", obtainmentTimestamp: NOW + 7_200_000 };

const SILENT = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

/** A settings store holding `kick_token`, which the source reads and renews. */
function store(initial: object | null) {
  const state = { value: initial === null ? null : JSON.stringify(initial) };
  return {
    state,
    db: {
      getSetting: mock(async (_key: string) => state.value),
      setSetting: mock(async (_key: string, value: string) => {
        state.value = value;
      }),
    },
  };
}

function dashboard(answer: unknown) {
  return { request: mock(async (_request: unknown, _clientId: string) => answer) };
}

const STORED = { ...GRANT, dashboardClientId: "dash-client" };

describe("KickTokenSource.servedToken", () => {
  const cases: {
    name: string;
    now: number;
    force: boolean;
    answer: unknown;
    served: KickTokenGrant | null;
    asked: boolean;
    reason?: string;
  }[] = [
    {
      name: "a fresh token is served as stored",
      now: NOW + 60_000,
      force: false,
      answer: null,
      served: GRANT,
      asked: false,
    },
    {
      name: "an expiring token is renewed through the dashboard that linked it",
      now: NOW + 7_200_000 - 30_000,
      force: false,
      answer: { token: RENEWED },
      served: RENEWED,
      asked: true,
    },
    {
      name: "force renews a token Kick refused",
      now: NOW + 60_000,
      force: true,
      answer: { token: RENEWED },
      served: RENEWED,
      asked: true,
    },
    {
      name: "a dashboard that cannot renew asks for a relink",
      now: NOW + 7_200_000,
      force: false,
      answer: { token: null, reason: "relink_required" },
      served: null,
      asked: true,
      reason: "relink_required",
    },
  ];
  for (const c of cases) {
    test(c.name, async () => {
      const { db, state } = store(STORED);
      const dash = dashboard(c.answer);
      const source = new KickTokenSource({ db, dashboard: () => dash, now: () => c.now });

      const served = source.servedToken(c.force);

      if (c.served === null) {
        await expect(served).rejects.toMatchObject({ reason: c.reason });
      } else {
        expect(await served).toEqual(c.served);
      }
      expect(dash.request).toHaveBeenCalledTimes(c.asked ? 1 : 0);
      if (c.asked) {
        expect(dash.request.mock.calls[0]).toEqual([{ type: "kick.token.requested" }, "dash-client"]);
      }
      if (c.served === RENEWED) {
        expect(JSON.parse(state.value ?? "")).toEqual({ ...RENEWED, dashboardClientId: "dash-client" });
      }
    });
  }

  test("a refused renewal marks the link failed until it is linked again", async () => {
    const { db } = store(STORED);
    const source = new KickTokenSource({
      db,
      dashboard: () => dashboard({ token: null, reason: "relink_required" }),
      now: () => NOW + 7_200_000,
    });

    await expect(source.servedToken(false)).rejects.toThrow("relink_required");
    expect((await source.link()).account?.authFailedAt).toBe(NOW + 7_200_000);

    await source.store(GRANT, "dash-client");
    expect((await source.link()).account?.authFailedAt).toBeNull();
  });

  test("concurrent requests share one renewal", async () => {
    const { db } = store(STORED);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dash = {
      request: mock(async () => {
        await gate;
        return { token: RENEWED };
      }),
    };
    const source = new KickTokenSource({ db, dashboard: () => dash, now: () => NOW + 7_200_000 });

    const both = Promise.all([source.servedToken(false), source.servedToken(true)]);
    release();

    expect(await both).toEqual([RENEWED, RENEWED]);
    expect(dash.request).toHaveBeenCalledTimes(1);
  });

  test("a renewal does not overwrite a link stored meanwhile", async () => {
    const { db, state } = store(STORED);
    const relinked = { ...GRANT, userId: "7", accessToken: "other" };
    let source: KickTokenSource;
    const dash = {
      request: mock(async () => {
        await source.store(relinked, "dash-2");
        return { token: RENEWED };
      }),
    };
    source = new KickTokenSource({ db, dashboard: () => dash, now: () => NOW + 7_200_000 });

    expect(await source.servedToken(false)).toEqual(relinked);
    expect(JSON.parse(state.value ?? "")).toEqual({ ...relinked, dashboardClientId: "dash-2" });
  });

  test("no token is not_linked", async () => {
    const { db } = store(null);
    const source = new KickTokenSource({ db, dashboard: () => null, now: () => NOW });
    await expect(source.servedToken(false)).rejects.toMatchObject({ reason: "not_linked" });
  });
});

describe("answerKickTokenRequest", () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  const cases: { name: string; request: string; expectForce: boolean }[] = [
    { name: "an empty request", request: "", expectForce: false },
    { name: "a non-JSON request", request: "nope", expectForce: false },
    { name: "force", request: '{"force":true}', expectForce: true },
  ];
  for (const c of cases) {
    test(`${c.name} asks with force ${c.expectForce}`, async () => {
      const servedToken = mock(async (_force: boolean) => GRANT);
      expect(await answerKickTokenRequest(encode(c.request), { servedToken }, SILENT)).toEqual({ token: GRANT });
      expect(servedToken).toHaveBeenCalledWith(c.expectForce);
    });
  }

  test("a refusal carries its reason", async () => {
    const { db } = store(null);
    const source = new KickTokenSource({ db, dashboard: () => null, now: () => NOW });
    expect(await answerKickTokenRequest(encode(""), source, SILENT)).toEqual({
      token: null,
      reason: "not_linked",
      error: "Kick is not linked",
    });
  });
});

describe("parseKickTokenResponse", () => {
  const cases: [name: string, body: unknown, expected: unknown][] = [
    ["a grant", { token: GRANT }, { token: GRANT }],
    ["not linked", { token: null, reason: "not_linked" }, { token: null, reason: "not_linked" }],
  ];
  for (const [name, body, expected] of cases) {
    test(`reads ${name}`, () => {
      expect(parseKickTokenResponse(body)).toEqual(expected as never);
    });
  }
  const refused: [name: string, body: unknown][] = [
    ["no token field", {}],
    ["an unknown reason", { token: null, reason: "nope" }],
    ["a grant without a client id", { token: { ...GRANT, clientId: "" } }],
  ];
  for (const [name, body] of refused) {
    test(`refuses ${name}`, () => {
      expect(() => parseKickTokenResponse(body)).toThrow();
    });
  }
});

function session(clientId: string) {
  const settings = new Map<string, string>();
  const published: { subject: string; data: unknown }[] = [];
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
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: {
      publish: mock((subject: string, data: Uint8Array) => {
        published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
      }),
    } as unknown as ApiOptions["nats"],
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    barkloaderKey: "test-barkloader-key-0123456789abcdef",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: SILENT,
    clock: () => NOW,
  });
  return {
    settings,
    published,
    rpc: new ApiSession(api, clientId, new SessionLease(() => {})) as unknown as Woofx3EngineApi,
  };
}

describe("Kick link over RPC", () => {
  test("setKickToken stores the grant with the session's client id and announces the kick token", async () => {
    const { settings, published, rpc } = session("dash-client");

    await rpc.setKickToken(GRANT);

    expect(JSON.parse(settings.get(KICK_TOKEN_SETTING) ?? "")).toEqual(STORED);
    expect(settings.get("integration.kick.enabled")).toBe("true");
    expect(published.find((p) => p.subject === "setting.integration.token.updated")?.data).toMatchObject({
      data: { integration: "kick" },
    });
  });

  test("getKickLink describes the link without its token, and deleteKickToken forgets it", async () => {
    const { settings, rpc } = session("dash-client");
    await rpc.setKickToken(GRANT);

    const linked = await rpc.getKickLink();
    expect(linked).toMatchObject({
      linked: true,
      userId: "4242",
      scopes: GRANT.scope,
      expiresAt: NOW + 7_200_000,
      authFailedAt: null,
    });
    expect(JSON.stringify(linked)).not.toContain("access-1");

    await rpc.deleteKickToken();
    expect(await rpc.getKickLink()).toMatchObject({ linked: false });
    expect(settings.get("integration.kick.enabled")).toBe("false");
  });
});
