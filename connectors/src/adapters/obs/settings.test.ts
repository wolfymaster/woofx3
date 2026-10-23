import { afterEach, describe, expect, it } from "bun:test";
import { OBS_DEFAULTS } from "../../config/obs";
import { systemTimers, type Timers } from "../../host/deps";
import { ObsRouteUnavailable, obsFailureKind } from "./connection";
import { type FakeObsServer, startFakeObs } from "./fake-obs-server";
import { OBS_FALLBACK_KEYS, obsAdapterFallback, openObsOverRoute } from "./settings";

const TICKET = "T".repeat(43);

describe("obsAdapterFallback", () => {
  it("hands connectors' configuration to the companion gateway, with the pre-local[] setting ids", () => {
    expect(obsAdapterFallback({ host: "127.0.0.1", port: "4455", token: "from-config" })).toEqual({
      keys: OBS_FALLBACK_KEYS,
      host: "127.0.0.1",
      port: "4455",
      password: "from-config",
    });
    expect(obsAdapterFallback({ host: "obs.lan", port: "4455" })).not.toHaveProperty("password");
  });
});

const CONNECT_LIMITS = {
  connectTimeoutMs: OBS_DEFAULTS.connectTimeoutMs,
  timers: systemTimers,
  signal: new AbortController().signal,
};

describe("opening OBS on a route", () => {
  let fake: FakeObsServer | null = null;
  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  it("negotiates the subprotocol, signs in, and asks OBS through the session", async () => {
    fake = startFakeObs({ password: "hunter2" });
    const session = await openObsOverRoute(
      {
        ok: true,
        route: "direct",
        url: fake.url,
        password: "hunter2",
        address: "127.0.0.1",
      },
      CONNECT_LIMITS
    );
    expect(fake.protocols).toEqual(["obswebsocket.msgpack"]);
    expect(fake.requests).toEqual([]);
    await session.client.request("GetSceneList");
    expect(fake.requests).toEqual(["GetSceneList"]);
    await session.close();
  });

  it("reaches OBS at a bridge path whose ticket the server checks", async () => {
    fake = startFakeObs({ acceptUrl: (url) => url.searchParams.get("ticket") === TICKET });
    const route = {
      ok: true as const,
      route: "companion" as const,
      url: `${fake.url}/bridge/woofx3_obs/obs?ticket=${TICKET}`,
      address: "127.0.0.1",
    };
    const session = await openObsOverRoute(route, CONNECT_LIMITS);
    expect(fake.upgrades.map((u) => u.pathname)).toEqual(["/bridge/woofx3_obs/obs"]);
    await session.close();
  });

  it("reads a refused bridge upgrade as a relay failure, and a direct one as unreachable", async () => {
    fake = startFakeObs({ acceptUrl: () => false });
    const bridged = await openObsOverRoute(
      {
        ok: true,
        route: "companion",
        url: `${fake.url}/bridge/woofx3_obs/obs?ticket=spent`,
        address: "c-x.woofx3.tv",
      },
      CONNECT_LIMITS
    ).catch((e) => e);
    expect(bridged).toBeInstanceOf(ObsRouteUnavailable);
    expect(bridged.address).toBe("c-x.woofx3.tv");
    expect(obsFailureKind(bridged)).toBe("relay");
    const direct = await openObsOverRoute(
      { ok: true, route: "direct", url: fake.url, address: "127.0.0.1" },
      CONNECT_LIMITS
    ).catch((e) => e);
    expect(obsFailureKind(direct)).toBe("unreachable");
  });

  it("ends a connect that never answers as soon as its signal aborts, leaving no timer behind", async () => {
    const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {} } });
    const pending = new Set<unknown>();
    const timers: Timers = {
      ...systemTimers,
      setTimeout: (fn, ms) => {
        const handle = systemTimers.setTimeout(fn, ms);
        pending.add(handle);
        return handle;
      },
      clearTimeout: (handle) => {
        pending.delete(handle);
        systemTimers.clearTimeout(handle);
      },
    };
    const run = new AbortController();
    try {
      const opening = openObsOverRoute(
        { ok: true, route: "direct", url: `ws://127.0.0.1:${silent.port}`, address: "127.0.0.1" },
        { ...CONNECT_LIMITS, timers, signal: run.signal }
      ).catch((e) => e);
      await Bun.sleep(20);
      expect(pending.size).toBe(1);
      run.abort();
      const err = await opening;
      expect(err).toBeInstanceOf(Error);
      expect(pending.size).toBe(0);
    } finally {
      silent.stop(true);
    }
  });

  it("reads a wrong password as an authentication failure on either route", async () => {
    fake = startFakeObs({ password: "hunter2" });
    for (const route of ["direct", "companion"] as const) {
      const err = await openObsOverRoute(
        { ok: true, route, url: fake.url, password: "wrong", address: "127.0.0.1" },
        CONNECT_LIMITS
      ).catch((e) => e);
      expect(err.code).toBe(4009);
      expect(obsFailureKind(err)).toBe("authentication");
    }
  });
});

describe("ObsRouteUnavailable", () => {
  const cases: Array<[ConstructorParameters<typeof ObsRouteUnavailable>[0], "relay" | "unreachable"]> = [
    ["relay", "relay"],
    ["busy", "relay"],
    ["store_unreadable", "unreachable"],
    ["not_routed", "unreachable"],
    ["not_declared", "unreachable"],
    ["protocol_unsupported", "unreachable"],
  ];
  for (const [reason, kind] of cases) {
    it(`reads the companion gateway's ${reason} as ${kind}`, () => {
      expect(obsFailureKind(new ObsRouteUnavailable(reason, "no route"))).toBe(kind);
    });
  }
});
