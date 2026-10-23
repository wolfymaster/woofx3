import { afterEach, describe, expect, it } from "bun:test";
import {
  COMPANION_GATEWAY_SUBJECTS,
  type ModuleEndpointReply,
  parseModuleEndpointReply,
} from "@woofx3/common/cloudevents/Companion/module-request";
import type { RelayGrant, StoredRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";
import { OBS_ENDPOINT } from "../adapters/obs/settings";
import { CompanionEnvSchema, companionConfig } from "../config/companion";
import { HostRequests } from "../host/host-requests";
import { ScopeCounters, ScopedBus } from "../host/scoped-bus";
import { bytes, countingIds, emptyEndpointStore, FakeBus, FakeTime, RecordingLogger, text } from "../host/testing";
import { ClaimRegistry } from "./claims";
import { COMPANION_GATEWAY_GRANTS, EngineCompanionGateway } from "./companion-gateway";
import type { Fetch } from "./dialer";
import type { EndpointStore, StoredModuleSetting } from "./endpoint-store";
import { type DeviceScript, echo, eventually, FakeDevice } from "./fake-device";
import { MODULE_SETTING_UPDATED_SUBJECT } from "./route-watch";

const SUBJECT = COMPANION_GATEWAY_SUBJECTS.moduleRequest;
const MODULE = "vtube_studio";
const TICKET = "T".repeat(43);
const BRIDGE = "https://c-x.woofx3.tv";

const MANIFEST = JSON.stringify({
  id: MODULE,
  local: [
    { id: "vts", name: "VTube Studio", protocol: "websocket", hostSetting: "vtsHost", portSetting: "vtsPort" },
    { id: "lamp", name: "Lamp", protocol: "http", hostSetting: "lampHost", portSetting: "lampPort" },
  ],
});

const RELAYED: StoredRelayConfig = {
  bridgeOrigin: BRIDGE,
  endpoints: [{ moduleId: MODULE, endpointId: "vts" }],
  clientId: "dash",
};
const GRANT: RelayGrant = {
  bridgeOrigin: BRIDGE,
  endpoints: RELAYED.endpoints,
  credential: "wfxr1.k1.cGF5bG9hZA.c2ln",
  expiresAt: 2_000_000_000_000,
};

/** A bus whose api answers bridge credential requests with `grant`. */
class RelayBus extends FakeBus {
  constructor(private readonly grant: RelayGrant | null) {
    super();
  }

  override async request(subject: string): Promise<{ subject: string; data: Uint8Array }> {
    return { subject, data: bytes(JSON.stringify({ relay: this.grant })) };
  }
}

const devices: FakeDevice[] = [];
const gateways: EngineCompanionGateway[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.stop()));
  for (const device of devices.splice(0)) {
    device.stop();
  }
});

interface Options {
  env?: Record<string, unknown>;
  script?: DeviceScript;
  store?: Partial<EndpointStore>;
  /** Through the companion: the relay's ticket exchange. */
  fetch?: Fetch;
  grant?: RelayGrant | null;
}

async function setup(options: Options = {}) {
  const device = new FakeDevice(options.script ?? echo);
  devices.push(device);
  const time = new FakeTime();
  const logger = new RecordingLogger();
  const bus = new RelayBus(options.grant === undefined ? GRANT : options.grant);
  const settings: StoredModuleSetting[] = [
    { key: "vtsHost", value: "127.0.0.1" },
    { key: "vtsPort", value: String(device.port) },
  ];
  const requests = new HostRequests({ clock: time, ids: countingIds(), timers: time, logger });
  const dialed: string[] = [];
  const gateway = new EngineCompanionGateway({
    config: companionConfig(CompanionEnvSchema.parse(options.env ?? { woofx3Hosting: "local" })),
    claims: ClaimRegistry.fromManifests([{ id: "obs", localEndpoints: [OBS_ENDPOINT] }]),
    store: {
      ...emptyEndpointStore,
      moduleManifest: async (id) => (id === MODULE || id === OBS_ENDPOINT.moduleId ? MANIFEST : null),
      moduleSettings: async () => settings,
      ...options.store,
    },
    fetch: options.fetch ?? (async () => Response.json({ ticket: TICKET, expiresInMs: 30_000 })),
    resolver: async (name) => {
      throw new Error(`no name resolution in this test (${name})`);
    },
    openSocket: (url) => {
      dialed.push(url);
      // The fake relay: a bridge url is answered by the device on loopback, path and ticket kept.
      const target = new URL(url);
      const local =
        target.protocol === "wss:" ? `ws://127.0.0.1:${device.port}${target.pathname}${target.search}` : url;
      return new WebSocket(local);
    },
    requests,
    clock: time,
    timers: time,
    ids: countingIds(),
    logger,
  });
  gateways.push(gateway);
  const scope = new ScopedBus({
    scope: "host",
    client: bus,
    grants: {
      publishes: [],
      subscribes: [...COMPANION_GATEWAY_GRANTS.subscribes, SUBJECT],
      requests: [...COMPANION_GATEWAY_GRANTS.requests],
    },
    limits: { concurrency: 8, queueCap: 8 },
    logger,
    counters: new ScopeCounters(),
    clock: time,
  });
  await gateway.start(scope);

  /** Sends a request, returning the reply once it is written. */
  const ask = async (request: Record<string, unknown>): Promise<ModuleEndpointReply> => {
    const replies = bus.deliver(SUBJECT, bytes(JSON.stringify(request)), "inbox.1");
    await eventually(() => replies.length > 0, `a reply to ${JSON.stringify(request)}`);
    const parsed = parseModuleEndpointReply(JSON.parse(text(replies[0] as Uint8Array)));
    if (!parsed.ok) {
      throw new Error(`the reply breaks the contract: ${parsed.error.field} ${parsed.error.problem}`);
    }
    return parsed.value;
  };
  /** Sends a request without waiting; read the reply from the returned list. */
  const start = (request: Record<string, unknown>) => bus.deliver(SUBJECT, bytes(JSON.stringify(request)), "inbox.2");
  return { device, gateway, bus, time, logger, ask, start, dialed, requests };
}

const send = (message: string, endpointId = "vts", moduleId = MODULE) => ({
  op: "send",
  moduleId,
  endpointId,
  message,
  budgetMs: 4_500,
});

const request = (message: string, value: string | number, budgetMs = 4_500) => ({
  op: "request",
  moduleId: MODULE,
  endpointId: "vts",
  message,
  budgetMs,
  match: { field: "requestID", value },
});

describe("module requests on a local engine", () => {
  it("send writes one frame and answers with the session epoch", async () => {
    const { ask, device } = await setup({ script: () => [] });
    expect(await ask(send('{"hello":true}'))).toEqual({ status: "ok", sessionEpoch: "id-1" });
    await eventually(() => device.frames.length === 1, "the frame at the device");
    expect(device.frames).toEqual(['{"hello":true}']);
  });

  it("request skips an unsolicited frame and answers with the matching one", async () => {
    const { ask, gateway } = await setup({
      script: (frame) => ['{"event":"unsolicited"}', '{"requestID":"r2"}', frame],
    });
    expect(await ask(request('{"requestID":"r1","data":"ping"}', "r1"))).toEqual({
      status: "ok",
      reply: '{"requestID":"r1","data":"ping"}',
      sessionEpoch: "id-1",
    });
    expect(gateway.status().modules.requests).toEqual({ send: {}, request: { ok: 1 } });
  });

  it("request answers timeout when nothing matches within the caller's budget", async () => {
    const { start, time, device } = await setup({ script: () => ['{"requestID":"other"}'] });
    const replies = start(request('{"requestID":"r1"}', "r1", 1_000));
    await eventually(() => device.frames.length === 1, "the request frame");
    await time.advance(1_000);
    await eventually(() => replies.length === 1, "the timeout reply");
    expect(JSON.parse(text(replies[0] as Uint8Array))).toEqual({
      status: "failed",
      code: "timeout",
      message: "no matching reply arrived before the budget ran out",
      sessionEpoch: "id-1",
    });
  });

  it("refuses a second request pending on the same match with busy", async () => {
    const { ask, start, device } = await setup({ script: () => [] });
    const first = start(request("{}", "r1"));
    await eventually(() => device.frames.length === 1, "the first request frame");
    expect(await ask(request("{}", "r1"))).toMatchObject({ status: "failed", code: "busy", sessionEpoch: "id-1" });
    device.push('{"requestID":"r1"}');
    await eventually(() => first.length === 1, "the first reply");
    expect(JSON.parse(text(first[0] as Uint8Array))).toMatchObject({ status: "ok", sessionEpoch: "id-1" });
  });

  it("reopens with a new epoch after a setting of the module changes", async () => {
    const { ask, bus, gateway } = await setup({ script: () => [] });
    expect(await ask(send("a"))).toEqual({ status: "ok", sessionEpoch: "id-1" });
    bus.deliver(
      MODULE_SETTING_UPDATED_SUBJECT.replace("*", MODULE),
      bytes(JSON.stringify({ data: { moduleId: MODULE, key: "vtsPort" } }))
    );
    await eventually(() => gateway.status().modules.sessions.closes.route_change === 1, "the route change");
    expect(await ask(send("b"))).toEqual({ status: "ok", sessionEpoch: "id-2" });
  });

  it("refuses an endpoint a host adapter claims", async () => {
    const { ask, device } = await setup();
    expect(await ask(send("{}", "obs", OBS_ENDPOINT.moduleId))).toEqual({
      status: "failed",
      code: "adapter_owned",
      message: "woofx3_obs/obs is reached through the obs adapter; module code cannot open it",
    });
    expect(device.connections).toEqual([]);
  });

  it("refuses an undeclared and an http endpoint", async () => {
    const { ask } = await setup();
    expect(await ask(send("{}", "lights"))).toMatchObject({ status: "failed", code: "not_declared" });
    expect(await ask(send("{}", "lamp"))).toMatchObject({ status: "failed", code: "protocol_unsupported" });
  });

  it("answers store_unreadable when db-proxy cannot be read", async () => {
    const { ask } = await setup({
      store: {
        moduleManifest: async () => {
          throw new Error("db-proxy GetModuleByModuleId: unavailable");
        },
      },
    });
    expect(await ask(send("{}"))).toMatchObject({ status: "failed", code: "store_unreadable" });
  });

  it("answers invalid for a request that breaks the contract", async () => {
    const { ask } = await setup();
    expect(await ask({ ...send("{}"), budgetMs: 10 })).toMatchObject({ status: "failed", code: "invalid" });
  });

  it("answers unavailable while a slow open runs past the budget, and the next call finds it", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { ask, start, time, device, gateway } = await setup({
      script: () => [],
      store: {
        moduleSettings: async () => {
          await gate;
          return [
            { key: "vtsHost", value: "127.0.0.1" },
            { key: "vtsPort", value: String(device.port) },
          ];
        },
      },
    });
    const replies = start(send("first", "vts"));
    await eventually(() => gateway.status().modules.sessions.opening === 1, "the open to start");
    await time.advance(4_500);
    await eventually(() => replies.length === 1, "the first reply");
    expect(JSON.parse(text(replies[0] as Uint8Array))).toEqual({
      status: "failed",
      code: "unavailable",
      message: "vtube_studio/vts is still connecting; try again shortly",
    });
    release();
    expect(await ask(send("second"))).toEqual({ status: "ok", sessionEpoch: "id-1" });
    await eventually(() => device.frames.length === 1, "the second frame");
    expect(device.frames).toEqual(["second"]);
  });

  it("closes every session when the gateway stops", async () => {
    const { ask, gateway, device } = await setup({ script: () => [] });
    await ask(send("{}"));
    expect(device.open).toBe(1);
    await gateway.stop();
    await eventually(() => device.open === 0, "the session to close");
    expect(gateway.status().modules.sessions.closes.stopped).toBe(1);
  });
});

describe("module requests on other hostings", () => {
  it("managed with no relay configuration: not_routed", async () => {
    const { ask } = await setup({ env: { woofx3Hosting: "managed" } });
    expect(await ask(send("{}"))).toEqual({
      status: "failed",
      code: "not_routed",
      message: "turn on the companion for this endpoint",
    });
  });

  it("self without WOOFX3_MODULE_LOCAL_DIRECT: not_routed; with it: dialed directly", async () => {
    const off = await setup({ env: { woofx3Hosting: "self" } });
    expect(await off.ask(send("{}"))).toMatchObject({ status: "failed", code: "not_routed" });
    const on = await setup({ env: { woofx3Hosting: "self", woofx3ModuleLocalDirect: true } });
    expect(await on.ask(send("{}"))).toEqual({ status: "ok", sessionEpoch: "id-1" });
  });

  it("managed, routed through the companion: one ticket per open, the bridge path, a session epoch", async () => {
    const { ask, device, dialed, gateway } = await setup({
      env: { woofx3Hosting: "managed" },
      store: { relayConfig: async () => RELAYED },
      script: echo,
    });
    expect(await ask(request('{"requestID":"r1"}', "r1"))).toEqual({
      status: "ok",
      reply: '{"requestID":"r1"}',
      sessionEpoch: "id-1",
    });
    expect(device.connections).toEqual([`/bridge/${MODULE}/vts?ticket=${TICKET}`]);
    expect(dialed).toEqual([`wss://c-x.woofx3.tv/bridge/${MODULE}/vts?ticket=${TICKET}`]);
    expect(gateway.status().modules.sessions.sessions).toMatchObject([
      { route: "companion", address: "c-x.woofx3.tv" },
    ]);
    expect(JSON.stringify(gateway.status())).not.toContain(TICKET);
  });

  it("managed, the relay out of tickets: busy", async () => {
    const { ask, device } = await setup({
      env: { woofx3Hosting: "managed" },
      store: { relayConfig: async () => RELAYED },
      fetch: async () => new Response("too many", { status: 429 }),
    });
    expect(await ask(send("{}"))).toMatchObject({ status: "failed", code: "busy" });
    expect(device.connections).toEqual([]);
  });

  it("local: a relay configuration listing the endpoint is ignored and the endpoint dialed directly", async () => {
    const { ask, dialed, device } = await setup({ store: { relayConfig: async () => RELAYED } });
    expect(await ask(send("{}"))).toEqual({ status: "ok", sessionEpoch: "id-1" });
    expect(dialed).toEqual([`ws://127.0.0.1:${device.port}`]);
  });

  it("managed, the relay configuration unreadable: store_unreadable", async () => {
    const { ask } = await setup({
      env: { woofx3Hosting: "managed" },
      store: {
        relayConfig: async () => {
          throw new Error("db-proxy GetSetting: unavailable");
        },
      },
    });
    expect(await ask(send("{}"))).toMatchObject({ status: "failed", code: "store_unreadable" });
  });
});
