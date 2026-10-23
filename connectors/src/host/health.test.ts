import { describe, expect, test } from "bun:test";
import { FakeDispatcherDb } from "../chat/testing";
import { ChatEnvSchema, chatConfig } from "../config/chat";
import { type GatewayConfig, GatewayEnvSchema, gatewayConfig } from "../config/gateway";
import { HOST_DEFAULTS, type HostConfig, HostEnvSchema, hostConfig } from "../config/host";
import { type HealthBody, handleHealthRequest, healthBody, startHealthServer } from "./health";
import { Host } from "./host";
import {
  countingIds,
  FakeAdapter,
  FakeBus,
  FakeTime,
  fixedLinkStore,
  halfRandom,
  RecordingLogger,
  shippedLinkReaders,
  testCompanion,
} from "./testing";

const config: HostConfig = hostConfig(HostEnvSchema.parse({}));
const gateway: GatewayConfig = gatewayConfig(GatewayEnvSchema.parse({}));

const linkedSettings = fixedLinkStore({ twitch_token: "tok", "integration.twitch.enabled": "true" });

async function runningHost(adapter: FakeAdapter, busUp = { value: true }) {
  const time = new FakeTime();
  const host = new Host({
    config,
    gateway,
    chat: chatConfig(ChatEnvSchema.parse({})),
    dispatcherDb: new FakeDispatcherDb(),
    companion: testCompanion(),
    dbProxy: { baseURL: "http://db.test" },
    bus: new FakeBus(),
    busConnected: () => busUp.value,
    linkStore: linkedSettings,
    adapters: new Map([["twitch", adapter]]),
    hostStates: new Map([["twitch", undefined]]),
    readers: shippedLinkReaders(),
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
    expect(body.counters.gateway).toEqual({
      outcomes: {},
      idempotency: { replayed: 0, coalesced: 0, mismatched: 0, held: 0 },
    });
    expect(body.counters.chat).toMatchObject({
      commands: expect.any(Object),
      lines: expect.any(Object),
      replies: { delivered: 0, failed: 0 },
      bus: expect.any(Object),
    });
  });

  test("a host with no adapters answers 200", async () => {
    const time = new FakeTime();
    const host = new Host({
      config,
      gateway,
      chat: chatConfig(ChatEnvSchema.parse({})),
      dispatcherDb: new FakeDispatcherDb(),
      companion: testCompanion(),
      dbProxy: { baseURL: "http://db.test" },
      bus: new FakeBus(),
      busConnected: () => true,
      linkStore: linkedSettings,
      adapters: new Map(),
      hostStates: new Map(),
      readers: shippedLinkReaders(),
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

  test("lists each claimed local endpoint under companion, with its owner, before anything dials", async () => {
    const adapter = new FakeAdapter("obs");
    Object.assign(adapter.manifest, { localEndpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }] });
    const time = new FakeTime();
    const host = new Host({
      config,
      gateway,
      companion: testCompanion(),
      chat: chatConfig(ChatEnvSchema.parse({})),
      dispatcherDb: new FakeDispatcherDb(),
      dbProxy: { baseURL: "http://db.test" },
      bus: new FakeBus(),
      busConnected: () => true,
      linkStore: linkedSettings,
      adapters: new Map([["obs", adapter]]),
      hostStates: new Map([["obs", undefined]]),
      readers: shippedLinkReaders(),
      clock: time,
      random: halfRandom,
      ids: countingIds(),
      timers: time,
      logger: new RecordingLogger(),
    });
    await host.start();
    await host.settled();
    const { body } = await getHealth(host);
    expect(body.companion).toEqual({
      hosting: null,
      endpoints: [
        { moduleId: "woofx3_obs", endpointId: "obs", owner: "obs", route: null, address: null, lastFailure: null },
      ],
      bridgeOpens: { inUse: 0, limit: 8, refused: 0 },
      modules: {
        sessions: {
          sessions: [],
          opening: 0,
          limit: 32,
          opens: 0,
          openFailures: {},
          closes: { idle: 0, route_change: 0, remote: 0, stopped: 0 },
          frames: { oversized: 0, binary: 0, unmatched: 0 },
        },
        requests: { send: {}, request: {} },
      },
    });
    await host.stop();
  });

  test("shows a module session's open time as ISO", async () => {
    const { host } = await runningHost(new FakeAdapter());
    const snapshot = host.snapshot();
    const session = {
      moduleId: "vts",
      endpointId: "vts",
      route: "direct" as const,
      address: "127.0.0.1:8001",
      sessionEpoch: "epoch-1",
      openedAt: 0,
      pending: 1,
    };
    const modules = { ...snapshot.companion.modules };
    modules.sessions = { ...modules.sessions, sessions: [session] };
    const body = healthBody({ ...snapshot, companion: { ...snapshot.companion, modules } });
    expect(body.companion.modules.sessions.sessions).toEqual([{ ...session, openedAt: "1970-01-01T00:00:00.000Z" }]);
    await host.stop();
  });

  test("shows a companion failure's time as ISO and redacts any secret-named key", async () => {
    const { host } = await runningHost(new FakeAdapter());
    const snapshot = host.snapshot();
    const endpoint = {
      moduleId: "woofx3_obs",
      endpointId: "obs",
      owner: "obs" as const,
      route: "companion" as const,
      address: "c-x.woofx3.tv",
      lastFailure: { reason: "relay" as const, message: "the companion relay refused the bridge (503)", at: 0 },
      ticket: "T".repeat(43),
      credential: "wfxr1.k1.cGF5bG9hZA.c2ln",
    };
    const body = healthBody({ ...snapshot, companion: { ...snapshot.companion, endpoints: [endpoint] } });
    expect(body.companion.endpoints).toEqual([
      {
        moduleId: "woofx3_obs",
        endpointId: "obs",
        owner: "obs",
        route: "companion",
        address: "c-x.woofx3.tv",
        lastFailure: {
          reason: "relay",
          message: "the companion relay refused the bridge (503)",
          at: "1970-01-01T00:00:00.000Z",
        },
        ticket: "[redacted]",
        credential: "[redacted]",
      } as never,
    ]);
    await host.stop();
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
