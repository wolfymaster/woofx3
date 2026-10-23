import { afterEach, describe, expect, it } from "bun:test";
import type { EndpointResolution, EndpointUnavailable, RouteChangeListener } from "../../companion/types";
import { OBS_DEFAULTS, ObsEnvSchema, obsConfig } from "../../config/obs";
import { systemRandom, systemTimers, type Timers } from "../../host/deps";
import { type FakeObsOptions, type FakeObsServer, startFakeObs } from "./fake-obs-server";
import { openObsSession } from "./manager";
import { RefreshLatch } from "./refresh-latch";
import { createObsService, type ObsService } from "./service";
import type { ObsStatusReply } from "./status";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

const OVERLAY_PORT = 9101;

function service(
  fallback: { host: string; port: string } = { host: "127.0.0.1", port: "4455" },
  latch = new RefreshLatch()
): ObsService {
  const address = `${fallback.host}:${fallback.port}`;
  return createObsService({
    resolve: async () => ({ ok: true, route: "direct", url: `ws://${address}`, address }),
    watchRoute: () => () => {},
    latch,
    connection: obsConfig(ObsEnvSchema.parse({})).connection,
    random: systemRandom,
    timers: systemTimers,
    logger,
  });
}

/** A run that is never aborted by its host; each test stops the service itself. */
const forever = new AbortController().signal;

const refreshes = (fake: FakeObsServer) => fake.requests.filter((type) => type === "GetInputList").length;

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met within 5s");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe("createObsService", () => {
  it("reports a connection not yet attempted without touching OBS", () => {
    expect(service().status()).toMatchObject({ state: "connecting", failure: null, address: null });
  });

  it("stops cleanly without having started", async () => {
    const obs = service();
    await obs.stop();
    expect(obs.status().state).toBe("stopped");
  });
});

describe("routes from the companion gateway", () => {
  const unavailable: Array<[EndpointUnavailable, ObsStatusReply["failure"], ObsStatusReply["route"]]> = [
    [{ ok: false, reason: "relay", message: "refused", address: "c-x.woofx3.tv" }, "relay", "companion"],
    [{ ok: false, reason: "busy", message: "too many", address: "c-x.woofx3.tv" }, "relay", "companion"],
    [{ ok: false, reason: "store_unreadable", message: "db down" }, "unreachable", undefined],
  ];
  for (const [resolution, failure, route] of unavailable) {
    it(`reports ${resolution.reason} as ${failure} and keeps retrying`, async () => {
      let attempts = 0;
      const obs = createObsService({
        resolve: async () => {
          attempts++;
          return resolution;
        },
        watchRoute: () => () => {},
        latch: new RefreshLatch(),
        connection: obsConfig(ObsEnvSchema.parse({ woofx3ObsBackoffInitialMs: 10, woofx3ObsBackoffMaxMs: 20 }))
          .connection,
        random: systemRandom,
        timers: systemTimers,
        logger,
      });
      try {
        obs.start(forever);
        await until(() => attempts >= 2);
        const status = obs.status();
        expect(status.failure).toBe(failure);
        expect(status.route).toBe(route);
        expect(status.address).toBe(resolution.address ?? null);
      } finally {
        await obs.stop();
      }
    });
  }
});

describe("overlay refresh requests", () => {
  let fake: FakeObsServer | null = null;
  let obs: ObsService | null = null;
  let latch = new RefreshLatch();

  afterEach(async () => {
    await obs?.stop();
    fake?.stop();
    obs = null;
    fake = null;
    latch = new RefreshLatch();
  });

  function connect(fakeOptions: FakeObsOptions = {}): ObsService {
    fake = startFakeObs(fakeOptions);
    obs = service({ host: "127.0.0.1", port: String(fake.port) }, latch);
    return obs;
  }

  /** A second run of the adapter: a new service on the same fake OBS and the same latch. */
  async function restart(): Promise<ObsService> {
    await obs?.stop();
    obs = service({ host: "127.0.0.1", port: String((fake as FakeObsServer).port) }, latch);
    return obs;
  }

  it("refreshes once when a session is already open", async () => {
    const svc = connect();
    svc.start(forever);
    await until(() => svc.status().state === "connected");

    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await until(() => refreshes(fake as FakeObsServer) === 1);
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("refreshes on the next session, and only that one, when requested while disconnected", async () => {
    const svc = connect();
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(0);

    svc.start(forever);
    await until(() => refreshes(fake as FakeObsServer) === 1);
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  // A refresh cuts off whatever the overlays are playing, so a reconnect alone must not cause one.
  it("does not refresh again when the connection is re-established without a new request", async () => {
    const svc = connect();
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    svc.start(forever);
    await until(() => refreshes(fake as FakeObsServer) === 1);

    svc.connection.reconnectNow("test");
    await until(() => (fake as FakeObsServer).upgrades.length === 2);
    await until(() => svc.status().state === "connected");
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("keeps the request for the next session when OBS could not be asked", async () => {
    const svc = connect({ failRequests: { type: "GetInputList", times: 1 } });
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    svc.start(forever);
    await until(() => refreshes(fake as FakeObsServer) === 1);
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(1);

    svc.connection.reconnectNow("test");
    await until(() => refreshes(fake as FakeObsServer) === 2);
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(2);

    svc.connection.reconnectNow("test");
    await until(() => (fake as FakeObsServer).upgrades.length === 3);
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(2);
  });

  it("changes nothing for a boot id it has already consumed", async () => {
    const svc = connect();
    svc.start(forever);
    await until(() => svc.status().state === "connected");

    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await until(() => refreshes(fake as FakeObsServer) === 1);
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("changes nothing for a boot id that is already latched", async () => {
    const svc = connect();
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });

    svc.start(forever);
    await until(() => refreshes(fake as FakeObsServer) >= 1);
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("refreshes again for a new boot id", async () => {
    const svc = connect();
    svc.start(forever);
    await until(() => svc.status().state === "connected");

    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await until(() => refreshes(fake as FakeObsServer) === 1);
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-2" });
    await until(() => refreshes(fake as FakeObsServer) === 2);
  });

  it("runs a request made during a refresh once more afterwards", async () => {
    const svc = connect();
    svc.start(forever);
    await until(() => svc.status().state === "connected");

    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-2" });
    await until(() => refreshes(fake as FakeObsServer) === 2);
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(2);
  });

  it("refreshes on start for a request latched while no service ran", async () => {
    connect();
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(0);

    const svc = await restart();
    svc.start(forever);
    await until(() => refreshes(fake as FakeObsServer) === 1);
  });

  it("does not refresh a consumed boot id again after a restart", async () => {
    const first = connect();
    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    first.start(forever);
    await until(() => refreshes(fake as FakeObsServer) === 1);

    const second = await restart();
    second.start(forever);
    await until(() => second.status().state === "connected");
    expect(latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" })).toBe("repeat");
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("stops acting on new requests once stopped", async () => {
    const svc = connect();
    svc.start(forever);
    await until(() => svc.status().state === "connected");
    await svc.stop();

    latch.latch({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(0);
  });
});

describe("opening OBS on the route the gateway gave", () => {
  let fake: FakeObsServer | null = null;
  let obs: ObsService | null = null;
  afterEach(async () => {
    await obs?.stop();
    fake?.stop();
    obs = null;
    fake = null;
  });

  const TICKET = "T".repeat(43);
  const quickRetry = obsConfig(ObsEnvSchema.parse({ woofx3ObsBackoffInitialMs: 10, woofx3ObsBackoffMaxMs: 20 }));

  function serviceOn(
    resolution: EndpointResolution,
    watchRoute: (l: RouteChangeListener) => () => void = () => () => {}
  ) {
    let attempts = 0;
    obs = createObsService({
      resolve: async () => {
        attempts++;
        return resolution;
      },
      watchRoute,
      latch: new RefreshLatch(),
      connection: quickRetry.connection,
      random: systemRandom,
      timers: systemTimers,
      logger,
    });
    obs.start(forever);
    return { obs, attempts: () => attempts };
  }

  it("signs in with the route's password on a direct route", async () => {
    fake = startFakeObs({ password: "hunter2" });
    const { obs } = serviceOn({ ok: true, route: "direct", url: fake.url, password: "hunter2", address: "127.0.0.1" });
    await until(() => obs.status().state === "connected");
    expect(fake.protocols).toEqual(["obswebsocket.msgpack"]);
    expect(obs.status().route).toBe("direct");
  });

  it("reaches OBS at a bridge path whose ticket the server checks", async () => {
    fake = startFakeObs({ acceptUrl: (url) => url.searchParams.get("ticket") === TICKET });
    const { obs } = serviceOn({
      ok: true,
      route: "companion",
      url: `${fake.url}/bridge/woofx3_obs/obs?ticket=${TICKET}`,
      address: "c-x.woofx3.tv",
    });
    await until(() => obs.status().state === "connected");
    expect(fake.upgrades.map((u) => u.pathname)).toEqual(["/bridge/woofx3_obs/obs"]);
    expect(obs.status().route).toBe("companion");
  });

  it("reads a refused bridge upgrade as a relay failure, and a direct one as unreachable", async () => {
    fake = startFakeObs({ acceptUrl: () => false });
    const bridged = serviceOn({
      ok: true,
      route: "companion",
      url: `${fake.url}/bridge/woofx3_obs/obs?ticket=spent`,
      address: "c-x.woofx3.tv",
    });
    await until(() => bridged.attempts() >= 2);
    expect(bridged.obs.status()).toMatchObject({ failure: "relay", route: "companion", address: "c-x.woofx3.tv" });
    await bridged.obs.stop();

    const direct = serviceOn({ ok: true, route: "direct", url: fake.url, address: "127.0.0.1" });
    await until(() => direct.attempts() >= 2);
    expect(direct.obs.status().failure).toBe("unreachable");
  });

  it("reads a wrong password as an authentication failure on either route", async () => {
    fake = startFakeObs({ password: "hunter2" });
    for (const route of ["direct", "companion"] as const) {
      const run = serviceOn({ ok: true, route, url: fake.url, password: "wrong", address: "127.0.0.1" });
      await until(() => run.attempts() >= 2);
      expect(run.obs.status().failure).toBe("authentication");
      await run.obs.stop();
    }
  });

  it("reconnects when the gateway reports the route moved, and stops listening on stop", async () => {
    fake = startFakeObs();
    let moved: RouteChangeListener = () => {};
    let listening = 0;
    const { obs } = serviceOn({ ok: true, route: "direct", url: fake.url, address: "127.0.0.1" }, (listener) => {
      moved = listener;
      listening++;
      return () => {
        listening--;
      };
    });
    await until(() => obs.status().state === "connected");
    expect(fake.upgrades).toHaveLength(1);

    moved("the route moved");
    await until(() => (fake as FakeObsServer).upgrades.length === 2);

    expect(listening).toBe(1);
    await obs.stop();
    expect(listening).toBe(0);
  });
});

describe("openObsSession", () => {
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
      const opening = openObsSession({
        url: `ws://127.0.0.1:${silent.port}`,
        connectTimeoutMs: OBS_DEFAULTS.connectTimeoutMs,
        timers,
        signal: run.signal,
      }).catch((e) => e);
      await Bun.sleep(20);
      expect(pending.size).toBe(1);
      run.abort();
      expect(await opening).toBeInstanceOf(Error);
      expect(pending.size).toBe(0);
    } finally {
      silent.stop(true);
    }
  });
});
