import { afterEach, describe, expect, mock, test } from "bun:test";
import { TwitchOAuthClient } from "@woofx3/twitch/oauth";
import { TWITCH_ENGINE_SCOPES } from "@woofx3/twitch/scopes";
import { type Schedule, TwitchDeviceLogins } from "../src/twitch-device-login";
import type { StoredPublicToken } from "../src/twitch-token-source";

const NOW = 1_000_000_000_000;

type Answer = { status: number; body: unknown };

/**
 * A stand-in for id.twitch.tv: answers the device endpoint with a code, each
 * token poll with the next scripted answer (the last one repeats), and
 * validate with the linked user.
 */
function fakeTwitch(polls: Answer[]) {
  const pollForms: Record<string, string>[] = [];
  const deviceForms: Record<string, string>[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/oauth2/device") {
        deviceForms.push(Object.fromEntries(new URLSearchParams(await request.text())));
        return Response.json({
          device_code: "dev-code",
          user_code: "ABCDEFGH",
          verification_uri: "https://www.twitch.tv/activate",
          expires_in: 1800,
          interval: 5,
        });
      }
      if (path === "/oauth2/token") {
        pollForms.push(Object.fromEntries(new URLSearchParams(await request.text())));
        const answer = polls[Math.min(pollForms.length - 1, polls.length - 1)] as Answer;
        return Response.json(answer.body, { status: answer.status });
      }
      if (path === "/oauth2/validate") {
        return Response.json({
          client_id: "public-app",
          login: "streamer",
          scopes: ["chat:read"],
          user_id: "42",
          expires_in: 14_000,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}`, pollForms, deviceForms };
}

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const PENDING: Answer = { status: 400, body: { status: 400, message: "authorization_pending" } };
const SLOW_DOWN: Answer = { status: 400, body: { status: 400, message: "slow_down" } };
const ISSUED: Answer = {
  status: 200,
  body: { access_token: "a1", refresh_token: "r1", scope: ["chat:read"], expires_in: 14_000, token_type: "bearer" },
};

/** Runs each poll at once, recording the delay the logins asked for. */
function immediate() {
  const delays: number[] = [];
  const schedule: Schedule = (run, delayMs) => {
    delays.push(delayMs);
    const timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  };
  return { delays, schedule };
}

function logins(
  baseUrl: string,
  opts: { clientId?: string | null; now?: () => number; schedule?: Schedule; random?: () => number } = {}
) {
  const stored: StoredPublicToken[] = [];
  const storeToken = mock(async (token: StoredPublicToken) => {
    stored.push(token);
  });
  let ids = 0;
  const manager = new TwitchDeviceLogins({
    clientId: opts.clientId === undefined ? "public-app" : opts.clientId,
    oauth: new TwitchOAuthClient({ baseUrl, now: () => NOW }),
    storeToken,
    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never,
    now: opts.now ?? (() => NOW),
    schedule: opts.schedule ?? immediate().schedule,
    newId: () => `login-${++ids}`,
    random: opts.random ?? (() => 0.5),
  });
  return { manager, stored, storeToken };
}

async function settled(manager: TwitchDeviceLogins, loginId: string) {
  for (let i = 0; i < 200; i++) {
    const result = manager.get(loginId);
    if (!result.ok || result.state.status !== "pending") {
      return result;
    }
    await Bun.sleep(2);
  }
  throw new Error("the login never settled");
}

async function start(manager: TwitchDeviceLogins, scopes?: string[]) {
  const started = await manager.start(scopes);
  if (!started.ok) {
    throw new Error(started.error);
  }
  return started.login;
}

describe("a device login", () => {
  test("shows the code, polls until the streamer approves, then stores the validated token", async () => {
    const twitch = fakeTwitch([PENDING, PENDING, ISSUED]);
    const { schedule, delays } = immediate();
    const { manager, stored } = logins(twitch.baseUrl, { schedule });

    const login = await start(manager);
    expect(login).toMatchObject({
      userCode: "ABCDEFGH",
      verificationUri: "https://www.twitch.tv/activate",
      expiresAt: new Date(NOW + 1_800_000).toISOString(),
    });
    expect(twitch.deviceForms[0]).toEqual({ client_id: "public-app", scopes: TWITCH_ENGINE_SCOPES.join(" ") });

    const result = await settled(manager, login.loginId);
    expect(result).toEqual({
      ok: true,
      state: {
        loginId: login.loginId,
        status: "linked",
        expiresAt: login.expiresAt,
        linked: { userId: "42", login: "streamer" },
      },
    });
    expect(twitch.pollForms).toHaveLength(3);
    expect(delays).toEqual([5_000, 5_000, 5_000]);
    // Stored as the engine's own token: a refresh token, and no `clientId`.
    expect(stored).toEqual([
      {
        accessToken: "a1",
        refreshToken: "r1",
        scope: ["chat:read"],
        expiresIn: 14_000,
        obtainmentTimestamp: NOW,
        userId: "42",
        publicClientId: "public-app",
      },
    ]);
    expect("clientId" in (stored[0] as object)).toBe(false);
  });

  test("waits five seconds longer after each slow_down", async () => {
    const twitch = fakeTwitch([SLOW_DOWN, SLOW_DOWN, ISSUED]);
    const { schedule, delays } = immediate();
    const { manager } = logins(twitch.baseUrl, { schedule });

    const login = await start(manager);
    expect((await settled(manager, login.loginId)).ok).toBe(true);
    expect(delays).toEqual([5_000, 10_000, 15_000]);
  });

  test("expires when Twitch says the code expired", async () => {
    const twitch = fakeTwitch([{ status: 400, body: { error: "expired_token" } }]);
    const { manager, storeToken } = logins(twitch.baseUrl);

    const login = await start(manager);
    const result = await settled(manager, login.loginId);
    expect(result.ok && result.state.status).toBe("expired");
    expect(storeToken).not.toHaveBeenCalled();
  });

  test("expires at its deadline without asking Twitch again", async () => {
    const twitch = fakeTwitch([PENDING]);
    let now = NOW;
    const { manager } = logins(twitch.baseUrl, { now: () => now });

    const login = await start(manager);
    now = NOW + 1_800_000;
    const result = await settled(manager, login.loginId);
    expect(result.ok && result.state).toMatchObject({ status: "expired" });
    expect(twitch.pollForms).toHaveLength(0);
  });

  test("ends denied when the streamer refuses", async () => {
    const twitch = fakeTwitch([PENDING, { status: 400, body: { error: "access_denied" } }]);
    const { manager, storeToken } = logins(twitch.baseUrl);

    const login = await start(manager);
    const result = await settled(manager, login.loginId);
    expect(result.ok && result.state).toMatchObject({ status: "denied", reason: "access_denied (HTTP 400)" });
    expect(storeToken).not.toHaveBeenCalled();
  });

  test.each([
    // The retry after the outage backs off past the interval: double it, less up to a quarter of jitter.
    ["no jitter drawn", 0, [5_000, 7_500, 5_000]],
    ["half the jitter", 0.5, [5_000, 8_750, 5_000]],
    ["almost all the jitter", 0.999, [5_000, 9_998, 5_000]],
  ])("keeps polling through a Twitch outage, backing off (%s)", async (_, random, expected) => {
    const twitch = fakeTwitch([{ status: 503, body: {} }, PENDING, ISSUED]);
    const { schedule, delays } = immediate();
    const { manager } = logins(twitch.baseUrl, { schedule, random: () => random });

    const login = await start(manager);
    expect(await settled(manager, login.loginId)).toMatchObject({ ok: true, state: { status: "linked" } });
    expect(delays).toEqual(expected);
  });

  test("backs off further on each outage in a row, up to a minute", async () => {
    const outage: Answer = { status: 503, body: {} };
    const twitch = fakeTwitch([outage, outage, outage, outage, ISSUED]);
    const { schedule, delays } = immediate();
    const { manager } = logins(twitch.baseUrl, { schedule, random: () => 0 });

    const login = await start(manager);
    expect(await settled(manager, login.loginId)).toMatchObject({ ok: true, state: { status: "linked" } });
    expect(delays).toEqual([5_000, 7_500, 15_000, 30_000, 45_000]);
  });

  test("fails when the token cannot be stored", async () => {
    const twitch = fakeTwitch([ISSUED]);
    const { manager, storeToken } = logins(twitch.baseUrl);
    storeToken.mockImplementation(async () => {
      throw new Error("db proxy down");
    });

    const login = await start(manager);
    const result = await settled(manager, login.loginId);
    expect(result.ok && result.state).toMatchObject({
      status: "failed",
      reason: "could not store the Twitch token: db proxy down",
    });
  });

  test("a cancelled login stops polling and is forgotten", async () => {
    const twitch = fakeTwitch([PENDING]);
    const pending: (() => void)[] = [];
    const { manager, storeToken } = logins(twitch.baseUrl, {
      schedule: (run) => {
        pending.push(run);
        return () => pending.splice(pending.indexOf(run), 1);
      },
    });

    const login = await start(manager);
    expect(pending).toHaveLength(1);
    expect(manager.cancel(login.loginId)).toEqual({ cancelled: true });
    expect(pending).toHaveLength(0);
    expect(manager.get(login.loginId)).toMatchObject({ ok: false, code: "not_found" });
    expect(manager.cancel(login.loginId)).toEqual({ cancelled: false });
    expect(twitch.pollForms).toHaveLength(0);
    expect(storeToken).not.toHaveBeenCalled();
  });

  test("a new login replaces the one in progress", async () => {
    const twitch = fakeTwitch([PENDING]);
    const pending: (() => void)[] = [];
    const { manager } = logins(twitch.baseUrl, {
      schedule: (run) => {
        pending.push(run);
        return () => pending.splice(pending.indexOf(run), 1);
      },
    });

    const first = await start(manager);
    const second = await start(manager);
    expect(pending).toHaveLength(1);
    expect(manager.get(first.loginId)).toMatchObject({ ok: false, code: "not_found" });
    expect(manager.get(second.loginId)).toMatchObject({ ok: true, state: { status: "pending" } });
  });

  test("stop at shutdown cancels the poll and refuses new logins", async () => {
    const twitch = fakeTwitch([PENDING]);
    const pending: (() => void)[] = [];
    const { manager } = logins(twitch.baseUrl, {
      schedule: (run) => {
        pending.push(run);
        return () => pending.splice(pending.indexOf(run), 1);
      },
    });

    await start(manager);
    manager.stop();
    expect(pending).toHaveLength(0);
    expect(await manager.start()).toMatchObject({ ok: false, code: "failed" });
  });
});

describe("starting a device login", () => {
  test("refuses without a public client id, before calling Twitch", async () => {
    const twitch = fakeTwitch([PENDING]);
    const { manager } = logins(twitch.baseUrl, { clientId: null });
    const result = await manager.start();
    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(!result.ok && result.error).toContain("WOOFX3_TWITCH_PUBLIC_CLIENT_ID");
    expect(twitch.deviceForms).toHaveLength(0);
  });

  test("refuses scopes that are not Twitch scope names", async () => {
    const twitch = fakeTwitch([PENDING]);
    const { manager } = logins(twitch.baseUrl);
    expect(await manager.start([])).toMatchObject({ ok: false, code: "invalid_scopes" });
    expect(await manager.start(["chat:read", "x&client_id=other"])).toMatchObject({
      ok: false,
      code: "invalid_scopes",
    });
    expect(twitch.deviceForms).toHaveLength(0);
  });

  test("asks for the scopes given", async () => {
    const twitch = fakeTwitch([PENDING]);
    const { manager } = logins(twitch.baseUrl, { schedule: () => () => {} });
    await start(manager, ["chat:read", "user:bot"]);
    expect(twitch.deviceForms[0]).toEqual({ client_id: "public-app", scopes: "chat:read user:bot" });
  });
});
