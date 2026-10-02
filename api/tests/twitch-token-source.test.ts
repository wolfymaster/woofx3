import { describe, expect, mock, test } from "bun:test";
import { parseTokenResponse, TwitchTokenSource } from "../src/twitch-token-source";

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
