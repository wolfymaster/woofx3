import { afterEach, describe, expect, it } from "bun:test";
import { createObsService, type ObsService } from "../../src/obs/service";
import { type FakeObsServer, startFakeObs } from "./fake-obs-server";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

const OVERLAY_PORT = 9101;

function service(obs: { host: string; port: string } = { host: "127.0.0.1", port: "4455" }) {
  const db = {
    getSetting: async () => null,
    getModuleManifest: async () => null,
    listModuleSettings: async () => [],
    getModuleSecretValues: async () => ({}),
  } as never;
  return createObsService({ db, nats: null, obs, logger });
}

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

  afterEach(async () => {
    await obs?.stop();
    fake?.stop();
    obs = null;
    fake = null;
  });

  function connect(): ObsService {
    fake = startFakeObs();
    obs = service({ host: "127.0.0.1", port: String(fake.port) });
    return obs;
  }

  it("refreshes once when a session is already open", async () => {
    const svc = connect();
    svc.start();
    await until(() => svc.status().state === "connected");

    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await until(() => refreshes(fake as FakeObsServer) === 1);
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("refreshes on the next session, and only that one, when requested while disconnected", async () => {
    const svc = connect();
    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(0);

    svc.start();
    await until(() => refreshes(fake as FakeObsServer) === 1);
    await settle();
    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  // A refresh cuts off whatever the overlays are playing, so a reconnect alone must not cause one.
  it("does not refresh again when the connection is re-established without a new request", async () => {
    const svc = connect();
    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    svc.start();
    await until(() => refreshes(fake as FakeObsServer) === 1);

    svc.connection.reconnectNow("test");
    await until(() => (fake as FakeObsServer).upgrades.length === 2);
    await until(() => svc.status().state === "connected");
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("changes nothing for a boot id it has already consumed", async () => {
    const svc = connect();
    svc.start();
    await until(() => svc.status().state === "connected");

    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await until(() => refreshes(fake as FakeObsServer) === 1);
    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("changes nothing for a boot id that is already latched", async () => {
    const svc = connect();
    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });

    svc.start();
    await until(() => refreshes(fake as FakeObsServer) >= 1);
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(1);
  });

  it("refreshes again for a new boot id", async () => {
    const svc = connect();
    svc.start();
    await until(() => svc.status().state === "connected");

    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    await until(() => refreshes(fake as FakeObsServer) === 1);
    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-2" });
    await until(() => refreshes(fake as FakeObsServer) === 2);
  });

  it("runs a request made during a refresh once more afterwards", async () => {
    const svc = connect();
    svc.start();
    await until(() => svc.status().state === "connected");

    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-1" });
    svc.requestOverlayRefresh({ overlayPort: OVERLAY_PORT, bootId: "boot-2" });
    await until(() => refreshes(fake as FakeObsServer) === 2);
    await settle();

    expect(refreshes(fake as FakeObsServer)).toBe(2);
  });
});
