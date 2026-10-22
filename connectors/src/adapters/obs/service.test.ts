import { afterEach, describe, expect, it } from "bun:test";
import type { EndpointStore } from "../../companion/endpoint-store";
import { ObsEnvSchema, obsConfig } from "../../config/obs";
import { systemRandom, systemTimers } from "../../host/deps";
import { type FakeObsOptions, type FakeObsServer, startFakeObs } from "./fake-obs-server";
import { RefreshLatch } from "./refresh-latch";
import { createObsService, type ObsService } from "./service";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

const OVERLAY_PORT = 9101;

const emptyStore: EndpointStore = {
  moduleManifest: async () => null,
  moduleSettings: async () => [],
  moduleSecrets: async () => ({}),
  relayConfig: async () => null,
};

function service(
  fallback: { host: string; port: string } = { host: "127.0.0.1", port: "4455" },
  latch = new RefreshLatch()
): ObsService {
  return createObsService({
    store: emptyStore,
    relayCredential: async () => {
      throw new Error("nothing is routed through a companion in these tests");
    },
    fallback,
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
