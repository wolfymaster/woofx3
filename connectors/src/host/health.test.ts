import { describe, expect, test } from "bun:test";
import { HOST_DEFAULTS, type HostConfig, HostEnvSchema, hostConfig } from "../config/host";
import { type HealthBody, handleHealthRequest, startHealthServer } from "./health";
import { Host } from "./host";
import { LINK_READERS, type SettingsReader } from "./link-readers";
import { countingIds, FakeAdapter, FakeBus, FakeTime, halfRandom, RecordingLogger } from "./testing";

const config: HostConfig = hostConfig(HostEnvSchema.parse({}));

const linkedSettings: SettingsReader = {
  getSetting: async (key) => ({ twitch_token: "tok", "integration.twitch.enabled": "true" })[key] ?? null,
};

async function runningHost(adapter: FakeAdapter, busUp = { value: true }) {
  const time = new FakeTime();
  const host = new Host({
    config,
    dbProxyUrl: "http://db.test",
    bus: new FakeBus(),
    busConnected: () => busUp.value,
    settings: linkedSettings,
    adapters: new Map([["twitch", adapter]]),
    hostStates: new Map([["twitch", undefined]]),
    readers: LINK_READERS,
    clock: time,
    random: halfRandom,
    ids: countingIds(),
    timers: time,
    logger: new RecordingLogger(),
  });
  await host.start();
  await host.settled();
  return { host, time };
}

async function getHealth(host: Host, path = "/health"): Promise<{ status: number; body: HealthBody }> {
  const response = handleHealthRequest(new Request(`http://127.0.0.1${path}`), () => host.snapshot());
  return { status: response.status, body: (await response.json()) as HealthBody };
}

describe("health", () => {
  test("answers 200 with a parked adapter, reporting why it is parked", async () => {
    const adapter = new FakeAdapter("twitch", [
      {
        subject: "twitchapi",
        budgetMs: 9_000,
        handle: async () => new Uint8Array(),
        unavailableReply: () => new Uint8Array(),
      },
    ]);
    adapter.defaultStart = "reject";
    const { host, time } = await runningHost(adapter);
    for (let i = 0; i < HOST_DEFAULTS.parkAfterFailures; i++) {
      await time.advance(HOST_DEFAULTS.backoffMaxMs);
    }

    const { status, body } = await getHealth(host);
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.adapters).toEqual([
      expect.objectContaining({ id: "twitch", state: "parked", reason: "could not connect", retryAt: null }),
    ]);
    expect(body.adapters[0].counts.failures).toBe(HOST_DEFAULTS.parkAfterFailures);
    expect(body.counters.hostRequests.twitchapi).toEqual({
      received: 0,
      replied: 0,
      invalid: 0,
      internal: 0,
      expired: 0,
      no_inbox: 0,
    });
  });

  test("a host with no adapters answers 200", async () => {
    const time = new FakeTime();
    const host = new Host({
      config,
      dbProxyUrl: "http://db.test",
      bus: new FakeBus(),
      busConnected: () => true,
      settings: linkedSettings,
      adapters: new Map(),
      hostStates: new Map(),
      readers: LINK_READERS,
      clock: time,
      random: halfRandom,
      ids: countingIds(),
      timers: time,
      logger: new RecordingLogger(),
    });
    await host.start();

    const { status, body } = await getHealth(host);
    expect(status).toBe(200);
    expect(body.adapters).toEqual([]);
    await time.advance(3 * HOST_DEFAULTS.reconcileIntervalMs);
    expect((await getHealth(host)).status).toBe(200);
  });

  test("answers 503 while the bus is down", async () => {
    const busUp = { value: true };
    const { host } = await runningHost(new FakeAdapter(), busUp);
    expect((await getHealth(host)).status).toBe(200);

    busUp.value = false;
    const { status, body } = await getHealth(host);
    expect(status).toBe(503);
    expect(body.bus.connected).toBe(false);
  });

  test("answers 503 once the reconcile loop stops passing", async () => {
    const { host, time } = await runningHost(new FakeAdapter());
    await host.stop();
    await time.advance(2 * HOST_DEFAULTS.reconcileIntervalMs + 1);

    const { status, body } = await getHealth(host);
    expect(status).toBe(503);
    expect(body.loop.alive).toBe(false);
  });

  test("any other path is a 404 in the error envelope", async () => {
    const { host } = await runningHost(new FakeAdapter());
    const response = handleHealthRequest(new Request("http://127.0.0.1/metrics"), () => host.snapshot());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: "GET /metrics is not served here" } });
  });

  test("the server listens on loopback and serves the route", async () => {
    const { host } = await runningHost(new FakeAdapter());
    const server = startHealthServer(0, () => host.snapshot());
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as HealthBody).adapters[0].state).toBe("connected");
    } finally {
      await server.stop();
    }
  });

  test("shows an adapter's detail with secret-named keys redacted at any depth", async () => {
    const adapter = new FakeAdapter();
    adapter.detail = () => ({
      channel: "wolfy",
      accessToken: "abc",
      nested: { Password: "p", ok: 1, list: [{ ticket: "t", name: "n" }] },
      credentialId: "c",
    });
    const { host } = await runningHost(adapter);

    const { body } = await getHealth(host);
    expect(body.adapters[0].detail).toEqual({
      channel: "wolfy",
      accessToken: "[redacted]",
      nested: { Password: "[redacted]", ok: 1, list: [{ ticket: "[redacted]", name: "n" }] },
      credentialId: "[redacted]",
    });
  });

  test("detail is null for an adapter without one, and when it throws", async () => {
    const quiet = await runningHost(new FakeAdapter());
    expect((await getHealth(quiet.host)).body.adapters[0].detail).toBeNull();

    const broken = new FakeAdapter();
    broken.detail = () => {
      throw new Error("no detail today");
    };
    const { host } = await runningHost(broken);
    const { status, body } = await getHealth(host);
    expect(status).toBe(200);
    expect(body.adapters[0].detail).toBeNull();
  });

  test.each([
    [
      "a cyclic object",
      () => {
        const loop: Record<string, unknown> = {};
        loop.self = loop;
        return loop;
      },
    ],
    ["a BigInt", () => ({ big: 10n })],
  ])("detail is null and /health still answers when detail() returns %s", async (_name, make) => {
    const adapter = new FakeAdapter();
    adapter.detail = make;
    const { host } = await runningHost(adapter);
    const { status, body } = await getHealth(host);
    expect(status).toBe(200);
    expect(body.adapters[0].detail).toBeNull();
  });
});
