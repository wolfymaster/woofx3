import { describe, expect, mock, test } from "bun:test";
import { selectStrategy } from "@woofx3/twitch/token-strategy";
import { type PublicClientToken, TwitchOAuthError } from "@woofx3/twitch/oauth";
import { parseTokenResponse, type StoredPublicToken, TwitchTokenSource } from "../src/twitch-token-source";

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

function dashboard(answer: unknown) {
  return { request: mock(async (_request: unknown, _clientId: string) => answer) };
}

describe("a token from a dashboard", () => {
  const STORED = { ...GRANT, dashboardClientId: "dash-client" };

  test("is served as stored while it is valid", async () => {
    const { db } = store(STORED);
    const ui = dashboard({ token: { ...GRANT, accessToken: "access-2" } });
    const source = new TwitchTokenSource(
      db,
      () => ui,
      () => undefined,
      () => NOW + 1_000
    );

    expect(await source.dashboardToken(false)).toEqual(GRANT);
    expect(await source.helix()).toEqual({ clientId: "woofx3-app", accessToken: "access-1", broadcasterId: "42" });
    expect(ui.request).not.toHaveBeenCalled();
  });

  test("is renewed through the dashboard that sent it once it is about to expire, and kept", async () => {
    const { db, state } = store(STORED);
    const renewed = { ...GRANT, accessToken: "access-2", obtainmentTimestamp: NOW + 3_590_000 };
    const ui = dashboard({ token: renewed });
    const source = new TwitchTokenSource(
      db,
      () => ui,
      () => undefined,
      () => NOW + 3_590_000
    );

    expect(await source.dashboardToken(false)).toEqual(renewed);
    expect(ui.request).toHaveBeenCalledWith({ type: "twitch.token.requested" }, "dash-client");
    expect(JSON.parse(state.value ?? "")).toEqual({ ...renewed, dashboardClientId: "dash-client" });
  });

  test("is renewed on demand when Twitch refused it, and concurrent askers share one renewal", async () => {
    const { db } = store(STORED);
    const ui = dashboard({ token: { ...GRANT, accessToken: "access-2" } });
    const source = new TwitchTokenSource(
      db,
      () => ui,
      () => undefined,
      () => NOW
    );

    const tokens = await Promise.all([source.dashboardToken(true), source.dashboardToken(true)]);
    expect(tokens.map((t) => t.accessToken)).toEqual(["access-2", "access-2"]);
    expect(ui.request).toHaveBeenCalledTimes(1);
  });

  test("a dashboard with no token to give says why", async () => {
    const { db } = store(STORED);
    const source = new TwitchTokenSource(
      db,
      () => dashboard({ token: null, reason: "relink_required" }),
      () => undefined,
      () => NOW
    );
    await expect(source.dashboardToken(true)).rejects.toThrow("relink_required");
    expect(await source.helix()).toEqual({ clientId: "woofx3-app", accessToken: "access-1", broadcasterId: "42" });
  });

  test("Helix credentials say why there are none when the dashboard cannot be reached", async () => {
    const { db } = store(STORED);
    const source = new TwitchTokenSource(
      db,
      () => null,
      () => "own-app",
      () => NOW + 4_000_000
    );
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
    const source = new TwitchTokenSource(
      db,
      () => null,
      () => "own-app",
      () => NOW + 1_000
    );

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
    const source = new TwitchTokenSource(
      db,
      () => null,
      () => "own-app"
    );
    expect(await source.helix()).toEqual({ clientId: "own-app", accessToken: "own", broadcasterId: "42" });
    await expect(source.dashboardToken(false)).rejects.toThrow("did not come from a dashboard");
  });

  test("gives no Helix credentials without the engine's own client id", async () => {
    const { db } = store({ accessToken: "own", userId: "42" });
    expect(
      await new TwitchTokenSource(
        db,
        () => null,
        () => undefined
      ).helix()
    ).toBe("WOOFX3_TWITCH_CLIENT_ID is not set");
  });
});

test("no linked account gives no Helix credentials", async () => {
  const { db } = store(null);
  expect(await new TwitchTokenSource(db, () => null).helix()).toBe("no twitch_token setting");
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
    const fromDashboard = new TwitchTokenSource(store({ ...GRANT, dashboardClientId: "dash-client" }).db, () => null);
    expect(await fromDashboard.linkedDashboardClientId()).toBe("dash-client");

    const { clientId: _, ...ownGrant } = GRANT;
    const own = new TwitchTokenSource(store(ownGrant).db, () => null);
    expect(await own.linkedDashboardClientId()).toBeNull();

    const none = new TwitchTokenSource(store(null).db, () => null);
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
    return new TwitchTokenSource(
      db,
      () => null,
      () => undefined,
      () => now,
      twitch
    );
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

  test("a refresh does not overwrite a link made while it was in flight", async () => {
    const { db, state } = store(STORED);
    const relinked = { ...STORED, accessToken: "relinked", refreshToken: "relinked-refresh" };
    const refresh = mock(async (): Promise<PublicClientToken> => {
      state.value = JSON.stringify(relinked);
      return { ...STORED, accessToken: "access-2", refreshToken: "refresh-2" };
    });
    const tokens = source(db, { refresh }, NOW + 3_590_000);

    expect((await tokens.servedToken(false)).accessToken).toBe("access-2");
    expect(JSON.parse(state.value ?? "")).toEqual(relinked);
  });

  test("an incomplete one is refused", async () => {
    const { refreshToken: _, ...withoutRefreshToken } = STORED;
    const { db } = store(withoutRefreshToken);
    const tokens = source(db, rotatingTwitch(), NOW);
    await expect(tokens.servedToken(false)).rejects.toThrow("link Twitch again");
  });
});
