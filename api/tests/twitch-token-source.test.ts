import { describe, expect, mock, test } from "bun:test";
import { selectStrategy } from "@woofx3/twitch/token-strategy";
import { type PublicClientToken, TwitchOAuthError } from "@woofx3/twitch/oauth";
import {
  parseTokenResponse,
  type StoredPublicToken,
  type TwitchLinkChange,
  TwitchTokenSource,
  type TwitchTokenSourceOptions,
} from "../src/twitch-token-source";

const NOW = 1_000_000_000_000;

const GRANT = {
  userId: "42",
  accessToken: "access-1",
  scope: ["chat:read"],
  expiresIn: 3600,
  obtainmentTimestamp: NOW,
  clientId: "woofx3-app",
};

/** A settings store holding `twitch_token`, which the source reads and renews. */
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

const NO_PUBLIC_APP = {
  refresh: async (): Promise<PublicClientToken> => {
    throw new Error("this test has no public Twitch app");
  },
};

function tokenSource(opts: Partial<TwitchTokenSourceOptions> & Pick<TwitchTokenSourceOptions, "db">) {
  return new TwitchTokenSource({
    dashboard: () => null,
    ownClientId: null,
    publicClient: NO_PUBLIC_APP,
    onLinkChanged: () => {},
    ...opts,
  });
}

function dashboard(answer: unknown) {
  return { request: mock(async (_request: unknown, _clientId: string) => answer) };
}

describe("a token from a dashboard", () => {
  const STORED = { ...GRANT, dashboardClientId: "dash-client" };

  test("is served as stored while it is valid", async () => {
    const { db } = store(STORED);
    const ui = dashboard({ token: { ...GRANT, accessToken: "access-2" } });
    const source = tokenSource({ db, dashboard: () => ui, ownClientId: null, now: () => NOW + 1_000 });

    expect(await source.dashboardToken(false)).toEqual(GRANT);
    expect(await source.helix()).toEqual({ clientId: "woofx3-app", accessToken: "access-1", broadcasterId: "42" });
    expect(ui.request).not.toHaveBeenCalled();
  });

  test("is renewed through the dashboard that sent it once it is about to expire, and kept", async () => {
    const { db, state } = store(STORED);
    const renewed = { ...GRANT, accessToken: "access-2", obtainmentTimestamp: NOW + 3_590_000 };
    const ui = dashboard({ token: renewed });
    const source = tokenSource({ db, dashboard: () => ui, ownClientId: null, now: () => NOW + 3_590_000 });

    expect(await source.dashboardToken(false)).toEqual(renewed);
    expect(ui.request).toHaveBeenCalledWith({ type: "twitch.token.requested" }, "dash-client");
    expect(JSON.parse(state.value ?? "")).toEqual({ ...renewed, dashboardClientId: "dash-client" });
  });

  test("is renewed on demand when Twitch refused it, and concurrent askers share one renewal", async () => {
    const { db } = store(STORED);
    const ui = dashboard({ token: { ...GRANT, accessToken: "access-2" } });
    const source = tokenSource({ db, dashboard: () => ui, ownClientId: null, now: () => NOW });

    const tokens = await Promise.all([source.dashboardToken(true), source.dashboardToken(true)]);
    expect(tokens.map((t) => t.accessToken)).toEqual(["access-2", "access-2"]);
    expect(ui.request).toHaveBeenCalledTimes(1);
  });

  test("a dashboard with no token to give says why", async () => {
    const { db } = store(STORED);
    const source = tokenSource({
      db,
      dashboard: () => dashboard({ token: null, reason: "relink_required" }),
      ownClientId: null,
      now: () => NOW,
    });
    await expect(source.dashboardToken(true)).rejects.toThrow("relink_required");
    expect(await source.helix()).toEqual({ clientId: "woofx3-app", accessToken: "access-1", broadcasterId: "42" });
  });

  test("Helix credentials say why there are none when the dashboard cannot be reached", async () => {
    const { db } = store(STORED);
    const source = tokenSource({ db, dashboard: () => null, ownClientId: "own-app", now: () => NOW + 4_000_000 });
    expect(await source.helix()).toBe(
      "could not get a Twitch token from the dashboard: no dashboard connection to ask for a Twitch token"
    );
  });
});

describe("a token from a dashboard that cannot be renewed", () => {
  test.each([
    ["without the dashboard's client id", { ...GRANT }, "does not say which one"],
    [
      "with an incomplete grant",
      { ...GRANT, scope: undefined, dashboardClientId: "dash-client" },
      "grant is incomplete",
    ],
  ])("%s is refused, not sent to Helix as the engine's own", async (_, stored, reason) => {
    // The Twitch client picks the dashboard strategy for this token too, so
    // neither side treats it as one the engine refreshes.
    expect(selectStrategy(stored)).toBe("dashboard");
    const { db } = store(stored);
    const source = tokenSource({ db, dashboard: () => null, ownClientId: "own-app", now: () => NOW + 1_000 });

    const helix = await source.helix();
    expect(typeof helix).toBe("string");
    expect(helix).toContain(reason);
    await expect(source.dashboardToken(false)).rejects.toThrow(reason);
    expect(await source.linkedDashboardClientId()).toBeNull();
  });
});

describe("a token the engine refreshes itself", () => {
  test("is read with the engine's own Twitch app client id", async () => {
    const { db } = store({
      accessToken: "own",
      refreshToken: "r",
      userId: "42",
      expiresIn: 3600,
      obtainmentTimestamp: NOW,
    });
    const source = tokenSource({ db, dashboard: () => null, ownClientId: "own-app" });
    expect(await source.helix()).toEqual({ clientId: "own-app", accessToken: "own", broadcasterId: "42" });
    await expect(source.dashboardToken(false)).rejects.toThrow("did not come from a dashboard");
  });

  test("gives no Helix credentials without the engine's own client id", async () => {
    const { db } = store({ accessToken: "own", userId: "42" });
    expect(await tokenSource({ db, dashboard: () => null, ownClientId: null }).helix()).toBe(
      "WOOFX3_TWITCH_CLIENT_ID is not set"
    );
  });
});

test("no linked account gives no Helix credentials", async () => {
  const { db } = store(null);
  expect(await tokenSource({ db, dashboard: () => null }).helix()).toBe("no twitch_token setting");
});

describe("writing the link", () => {
  test("store writes the token scoped to the engine user, and clear leaves it empty", async () => {
    const { db, state } = store(null);
    const tokens = tokenSource({ db });

    await tokens.store({ ...GRANT, dashboardClientId: "dash-client" }, "engine-user");
    expect(db.setSetting).toHaveBeenLastCalledWith(
      "twitch_token",
      JSON.stringify({ ...GRANT, dashboardClientId: "dash-client" }),
      "engine-user"
    );
    await tokens.clear();
    expect(state.value).toBe("");
  });

  test("a dashboard renewal does not overwrite a link stored while the dashboard answered", async () => {
    const { db, state } = store({ ...GRANT, dashboardClientId: "dash-client" });
    const relinked = { ...GRANT, userId: "99", accessToken: "relinked", dashboardClientId: "other-dash" };
    const ui = {
      request: mock(async () => {
        state.value = JSON.stringify(relinked);
        return { token: { ...GRANT, accessToken: "access-2" } };
      }),
    };
    const tokens = tokenSource({ db, dashboard: () => ui, now: () => NOW });

    expect(await tokens.dashboardToken(true)).toMatchObject({ accessToken: "relinked", userId: "99" });
    expect(JSON.parse(state.value ?? "")).toEqual(relinked);
  });
});

describe("parseTokenResponse", () => {
  test("accepts a token or a known refusal", () => {
    expect(parseTokenResponse({ token: GRANT })).toEqual({ token: GRANT });
    expect(parseTokenResponse({ token: null, reason: "not_linked" })).toEqual({ token: null, reason: "not_linked" });
  });

  test("refuses anything else", () => {
    expect(() => parseTokenResponse({ success: true })).toThrow("no token field");
    expect(() => parseTokenResponse({ token: null, reason: "nope" })).toThrow("known reason");
    expect(() => parseTokenResponse({ token: { ...GRANT, clientId: "" } })).toThrow("malformed");
  });
});

describe("linkedDashboardClientId", () => {
  test("names the dashboard a token came from, and nothing for the engine's own token", async () => {
    const fromDashboard = tokenSource({ db: store({ ...GRANT, dashboardClientId: "dash-client" }).db });
    expect(await fromDashboard.linkedDashboardClientId()).toBe("dash-client");

    const { clientId: _, ...ownGrant } = GRANT;
    const own = tokenSource({ db: store(ownGrant).db });
    expect(await own.linkedDashboardClientId()).toBeNull();

    const none = tokenSource({ db: store(null).db });
    expect(await none.linkedDashboardClientId()).toBeNull();
  });
});

describe("a token from the engine's public Twitch app", () => {
  const STORED: StoredPublicToken = {
    userId: "42",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    scope: ["chat:read"],
    expiresIn: 3600,
    obtainmentTimestamp: NOW,
    publicClientId: "public-app",
  };

  /** A Twitch that rotates the refresh token on every refresh and refuses a spent one. */
  function rotatingTwitch() {
    let issued = 1;
    const spent = new Set<string>();
    const refresh = mock(async (clientId: string, refreshToken: string): Promise<PublicClientToken> => {
      expect(clientId).toBe("public-app");
      if (spent.has(refreshToken)) {
        throw new TwitchOAuthError("Twitch refused the refresh: invalid refresh token (HTTP 400)", 400);
      }
      spent.add(refreshToken);
      issued += 1;
      return {
        accessToken: `access-${issued}`,
        refreshToken: `refresh-${issued}`,
        scope: ["chat:read"],
        expiresIn: 3600,
        obtainmentTimestamp: NOW + 3_590_000,
      };
    });
    return { refresh };
  }

  function source(
    db: ReturnType<typeof store>["db"],
    twitch: { refresh: ReturnType<typeof rotatingTwitch>["refresh"] },
    now: number
  ) {
    return tokenSource({ db, dashboard: () => null, ownClientId: null, now: () => now, publicClient: twitch });
  }

  test("is served with the public app's client id while it is valid, without its refresh token", async () => {
    const { db } = store(STORED);
    const twitch = rotatingTwitch();
    const tokens = source(db, twitch, NOW + 1_000);

    expect(await tokens.servedToken(false)).toEqual({
      userId: "42",
      accessToken: "access-1",
      scope: ["chat:read"],
      expiresIn: 3600,
      obtainmentTimestamp: NOW,
      clientId: "public-app",
    });
    expect(await tokens.helix()).toEqual({ clientId: "public-app", accessToken: "access-1", broadcasterId: "42" });
    expect(twitch.refresh).not.toHaveBeenCalled();
    expect(await tokens.linkedDashboardClientId()).toBeNull();
  });

  test("is refreshed near expiry, and each rotated refresh token is stored with its access token", async () => {
    const { db, state } = store(STORED);
    const twitch = rotatingTwitch();
    const tokens = source(db, twitch, NOW + 3_590_000);

    expect((await tokens.servedToken(false)).accessToken).toBe("access-2");
    expect(JSON.parse(state.value ?? "")).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      publicClientId: "public-app",
      userId: "42",
    });
    // Twitch refused it, so a forced refresh spends the stored (rotated) token, not the first one.
    expect((await tokens.servedToken(true)).accessToken).toBe("access-3");
    expect(twitch.refresh.mock.calls.map((call) => call[1])).toEqual(["refresh-1", "refresh-2"]);
    expect(JSON.parse(state.value ?? "").refreshToken).toBe("refresh-3");
  });

  test("concurrent askers share one refresh, so a refresh token is never spent twice", async () => {
    const { db } = store(STORED);
    const twitch = rotatingTwitch();
    const tokens = source(db, twitch, NOW + 3_590_000);

    const served = await Promise.all([tokens.servedToken(false), tokens.publicToken(true), tokens.helix()]);
    expect(served.map((t) => (typeof t === "string" ? t : t.accessToken))).toEqual([
      "access-2",
      "access-2",
      "access-2",
    ]);
    expect(twitch.refresh).toHaveBeenCalledTimes(1);
  });

  test("a refused refresh says to link Twitch again, and is not retried", async () => {
    const { db } = store(STORED);
    const refresh = mock(async (): Promise<PublicClientToken> => {
      throw new TwitchOAuthError("Twitch refused the refresh: invalid refresh token (HTTP 400)", 400);
    });
    const tokens = source(db, { refresh }, NOW + 3_590_000);

    await expect(tokens.servedToken(false)).rejects.toThrow("link Twitch again");
    expect(await tokens.helix()).toContain("link Twitch again");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("an unreachable Twitch is reported, and the next ask tries again", async () => {
    const { db } = store(STORED);
    const refresh = mock(async (): Promise<PublicClientToken> => {
      throw new TwitchOAuthError("could not reach Twitch: offline", null);
    });
    const tokens = source(db, { refresh }, NOW + 3_590_000);

    await expect(tokens.servedToken(false)).rejects.toThrow("could not refresh the Twitch token");
    await expect(tokens.servedToken(false)).rejects.toThrow("could not refresh the Twitch token");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test("a refreshed token whose write failed is kept and written again, never refreshed from the spent one", async () => {
    const { db, state } = store(STORED);
    const twitch = rotatingTwitch();
    db.setSetting.mockImplementationOnce(async () => {
      throw new Error("db proxy down");
    });
    const tokens = source(db, twitch, NOW + 3_590_000);

    await expect(tokens.servedToken(false)).rejects.toThrow("could not store it: db proxy down");
    expect(JSON.parse(state.value ?? "").refreshToken).toBe("refresh-1");

    expect((await tokens.servedToken(false)).accessToken).toBe("access-2");
    expect(JSON.parse(state.value ?? "").refreshToken).toBe("refresh-2");
    expect(twitch.refresh).toHaveBeenCalledTimes(1);
  });

  test("a refresh does not overwrite a link made while it was in flight, and serves the new link", async () => {
    const { db, state } = store(STORED);
    const relinked = { ...STORED, userId: "99", accessToken: "relinked", refreshToken: "relinked-refresh" };
    const refresh = mock(async (): Promise<PublicClientToken> => {
      state.value = JSON.stringify(relinked);
      return { ...STORED, accessToken: "access-2", refreshToken: "refresh-2" };
    });
    const tokens = source(db, { refresh }, NOW + 3_590_000);

    expect(await tokens.servedToken(false)).toMatchObject({ accessToken: "relinked", userId: "99" });
    expect(JSON.parse(state.value ?? "")).toEqual(relinked);
  });

  test("a link stored between a refresh's check and its write is kept", async () => {
    const { db, state } = store(STORED);
    const relinked = { ...STORED, userId: "99", accessToken: "relinked", refreshToken: "relinked-refresh" };
    let relinkOnNextRead = false;
    const twitch = rotatingTwitch();
    const refresh = mock(async (clientId: string, refreshToken: string) => {
      const token = await twitch.refresh(clientId, refreshToken);
      relinkOnNextRead = true;
      return token;
    });
    const tokens = source(db, { refresh }, NOW + 3_590_000);
    let relink: Promise<void> | null = null;
    // The read after the refresh is the save's check. The device login lands
    // right after it, before the save writes.
    db.getSetting.mockImplementation(async () => {
      const value = state.value;
      if (relinkOnNextRead) {
        relinkOnNextRead = false;
        relink = tokens.store(relinked);
      }
      return value;
    });

    expect((await tokens.servedToken(false)).accessToken).toBe("access-2");
    await relink;
    expect(JSON.parse(state.value ?? "")).toEqual(relinked);
  });

  test("an asker that read the row before a refresh finished is served that refresh, not a second one", async () => {
    const { db, state } = store(STORED);
    const twitch = rotatingTwitch();
    const tokens = source(db, twitch, NOW + 3_590_000);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holdNextRead = true;
    db.getSetting.mockImplementation(async () => {
      const value = state.value;
      if (holdNextRead) {
        holdNextRead = false;
        await held;
      }
      return value;
    });

    const late = tokens.publicToken(false);
    expect((await tokens.publicToken(false)).accessToken).toBe("access-2");
    release();

    expect((await late).accessToken).toBe("access-2");
    expect(twitch.refresh).toHaveBeenCalledTimes(1);
    expect(await tokens.helix()).toEqual({ clientId: "public-app", accessToken: "access-2", broadcasterId: "42" });
  });

  test("an incomplete one is refused", async () => {
    const { refreshToken: _, ...withoutRefreshToken } = STORED;
    const { db } = store(withoutRefreshToken);
    const tokens = source(db, rotatingTwitch(), NOW);
    await expect(tokens.servedToken(false)).rejects.toThrow("link Twitch again");
  });
});

describe("the link", () => {
  const PUBLIC: StoredPublicToken = {
    userId: "42",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    scope: ["chat:read", "moderator:read:chatters"],
    expiresIn: 3600,
    obtainmentTimestamp: NOW,
    publicClientId: "public-app",
  };
  const DASHBOARD = { ...GRANT, dashboardClientId: "dash-client" };

  function watched(opts: Partial<TwitchTokenSourceOptions> & Pick<TwitchTokenSourceOptions, "db">) {
    const changes: TwitchLinkChange[] = [];
    const source = tokenSource({ onLinkChanged: (change) => changes.push(change), ...opts });
    return { source, changes };
  }

  const REFUSING_TWITCH = {
    refresh: mock(async (): Promise<PublicClientToken> => {
      throw new TwitchOAuthError("Twitch refused the refresh: invalid refresh token (HTTP 400)", 400);
    }),
  };

  test("is described from the stored row, without any token", async () => {
    const { db } = store(PUBLIC);
    const { source } = watched({ db });

    expect(await source.link()).toEqual({
      userId: "42",
      scopes: ["chat:read", "moderator:read:chatters"],
      expiresAt: NOW + 3_600_000,
      authFailedAt: null,
    });
  });

  test.each([
    ["no row", null],
    ["an unlinked row", ""],
  ])("is null with %s", async (_, raw) => {
    const db = { getSetting: mock(async () => raw), setSetting: mock(async () => {}) };
    const { source } = watched({ db });

    expect(await source.link()).toBeNull();
  });

  test("has no expiry for a token that does not expire", async () => {
    const { db } = store({ ...GRANT, clientId: undefined, expiresIn: null });
    const { source } = watched({ db });

    expect((await source.link())?.expiresAt).toBeNull();
  });

  test.each([
    ["no user", { ...GRANT, userId: "" }, "names no Twitch user"],
    ["no scope list", { ...GRANT, scope: "chat:read" }, "no scope list"],
  ])("refuses a row with %s", async (_, stored, reason) => {
    const { db } = store(stored);
    const { source } = watched({ db });

    await expect(source.link()).rejects.toThrow(reason);
  });

  test("announces linking and unlinking, after each write", async () => {
    const { db, state } = store(null);
    const seen: { change: TwitchLinkChange; stored: string | null }[] = [];
    const source = tokenSource({ db, onLinkChanged: (change) => seen.push({ change, stored: state.value }) });

    await source.store(PUBLIC);
    await source.clear();

    expect(seen).toEqual([
      { change: { linked: true, userId: "42", authFailedAt: null }, stored: JSON.stringify(PUBLIC) },
      { change: { linked: false, userId: null, authFailedAt: null }, stored: "" },
    ]);
  });

  test("does not announce a write that failed", async () => {
    const db = {
      getSetting: mock(async () => null),
      setSetting: mock(async () => {
        throw new Error("db-proxy unavailable");
      }),
    };
    const { source, changes } = watched({ db });

    await expect(source.store(PUBLIC)).rejects.toThrow("db-proxy unavailable");
    expect(changes).toEqual([]);
  });

  test("refuses to store a token that names no user", async () => {
    const { db } = store(null);
    const { source, changes } = watched({ db });

    await expect(source.store({ ...PUBLIC, userId: "" })).rejects.toThrow("must name its Twitch user");
    expect(db.setSetting).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  test("a refused public refresh marks the link failed once, and a new link clears it", async () => {
    const { db } = store(PUBLIC);
    const { source, changes } = watched({ db, publicClient: REFUSING_TWITCH, now: () => NOW + 3_590_000 });

    await expect(source.servedToken(false)).rejects.toThrow("link Twitch again");
    await expect(source.servedToken(true)).rejects.toThrow("link Twitch again");

    expect(changes).toEqual([{ linked: true, userId: "42", authFailedAt: NOW + 3_590_000 }]);
    expect((await source.link())?.authFailedAt).toBe(NOW + 3_590_000);

    await source.store({ ...PUBLIC, refreshToken: "refresh-2" });

    expect(changes.at(-1)).toEqual({ linked: true, userId: "42", authFailedAt: null });
    expect((await source.link())?.authFailedAt).toBeNull();
  });

  test("an unreachable Twitch does not mark the link failed", async () => {
    const { db } = store(PUBLIC);
    const refresh = mock(async (): Promise<PublicClientToken> => {
      throw new TwitchOAuthError("could not reach Twitch: offline", null);
    });
    const { source, changes } = watched({ db, publicClient: { refresh }, now: () => NOW + 3_590_000 });

    await expect(source.servedToken(false)).rejects.toThrow("could not refresh");
    expect(changes).toEqual([]);
    expect((await source.link())?.authFailedAt).toBeNull();
  });

  test("a dashboard that cannot renew marks the link failed, and a later renewal restores it", async () => {
    const { db } = store(DASHBOARD);
    let answer: unknown = { token: null, reason: "relink_required" };
    const ui = { request: mock(async () => answer) };
    const { source, changes } = watched({ db, dashboard: () => ui, now: () => NOW + 3_590_000 });

    await expect(source.dashboardToken(false)).rejects.toThrow("relink_required");
    expect(changes).toEqual([{ linked: true, userId: "42", authFailedAt: NOW + 3_590_000 }]);

    answer = { token: { ...GRANT, accessToken: "access-2", obtainmentTimestamp: NOW + 3_590_000 } };
    await source.dashboardToken(true);

    expect(changes.at(-1)).toEqual({ linked: true, userId: "42", authFailedAt: null });
    expect((await source.link())?.authFailedAt).toBeNull();
  });

  test("a refusal of a link already replaced does not mark the new one failed", async () => {
    const { db, state } = store(DASHBOARD);
    const ui = {
      request: mock(async () => {
        state.value = JSON.stringify({ ...DASHBOARD, accessToken: "relinked" });
        return { token: null, reason: "not_linked" };
      }),
    };
    const { source, changes } = watched({ db, dashboard: () => ui, now: () => NOW + 3_590_000 });

    await expect(source.dashboardToken(false)).rejects.toThrow("not_linked");
    expect(changes).toEqual([]);
    expect((await source.link())?.authFailedAt).toBeNull();
  });
});
