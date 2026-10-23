import { describe, expect, it } from "bun:test";
import type { RelayConfig } from "@woofx3/api";
import type { RelayGrant, StoredRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";
import { OBS_ENDPOINT, obsAdapterFallback } from "../adapters/obs/settings";
import { CompanionEnvSchema, companionConfig } from "../config/companion";
import type { BusMessage, ScopedHandler } from "../host/scoped-bus";
import { HostRequests } from "../host/host-requests";
import { bytes, countingIds, emptyEndpointStore, FakeTime, flush, RecordingLogger } from "../host/testing";
import { ClaimRegistry, UnclaimedEndpointError } from "./claims";
import { COMPANION_GATEWAY_GRANTS, EngineCompanionGateway } from "./companion-gateway";
import type { Fetch } from "./dialer";
import type { EndpointStore } from "./endpoint-store";
import type { LocalEndpointRef } from "./types";

const TICKET = "T".repeat(43);
const CONFIG: StoredRelayConfig = {
  bridgeOrigin: "https://c-x.woofx3.tv",
  endpoints: [OBS_ENDPOINT],
  clientId: "dash",
};
const GRANT: RelayGrant = {
  bridgeOrigin: CONFIG.bridgeOrigin,
  endpoints: CONFIG.endpoints,
  credential: "wfxr1.k1.cGF5bG9hZA.c2ln",
  expiresAt: 2_000_000_000_000,
};
const FALLBACK = obsAdapterFallback({ host: "127.0.0.1", port: "4455", token: "obs-secret" });
const LIGHTS: LocalEndpointRef = { moduleId: "woofx3_lights", endpointId: "bridge" };

/** A host scope that records subscriptions and answers credential requests with `grant`. */
class FakeScope {
  readonly handlers = new Map<string, ScopedHandler>();
  readonly requested: string[] = [];

  constructor(private readonly grant: RelayGrant | null = GRANT) {}

  async subscribe(subject: string, handler: ScopedHandler): Promise<void> {
    this.handlers.set(subject, handler);
  }

  async request(subject: string): Promise<{ subject: string; data: Uint8Array }> {
    this.requested.push(subject);
    return { subject, data: bytes(JSON.stringify({ relay: this.grant })) };
  }

  deliver(subject: string, data: Uint8Array): void {
    const msg: BusMessage = { subject, data, respond: () => false };
    for (const [pattern, handler] of this.handlers) {
      const prefix = pattern.replace(/\*$/, "");
      if (pattern === subject || (pattern.endsWith("*") && subject.startsWith(prefix))) {
        void handler(msg, { arrivedAt: 0 } as never);
      }
    }
  }
}

function gateway(options: { store?: Partial<EndpointStore>; fetch?: Fetch; env?: Record<string, unknown> } = {}) {
  const time = new FakeTime();
  const logger = new RecordingLogger();
  const companion = new EngineCompanionGateway({
    config: companionConfig(CompanionEnvSchema.parse(options.env ?? {})),
    claims: ClaimRegistry.fromManifests([{ id: "twitch" }, { id: "obs", localEndpoints: [OBS_ENDPOINT] }]),
    store: { ...emptyEndpointStore, ...options.store },
    fetch: options.fetch ?? (async () => Response.json({ ticket: TICKET, expiresInMs: 30_000 })),
    resolver: async (name) => {
      throw new Error(`no name resolution in this test (${name})`);
    },
    openSocket: (url) => new WebSocket(url),
    requests: new HostRequests({ clock: time, ids: countingIds(), timers: time, logger }),
    clock: time,
    timers: time,
    ids: countingIds(),
    logger,
  });
  return { companion, time, logger };
}

const live = () => new AbortController().signal;

describe("EngineCompanionGateway claims", () => {
  it("reports every claimed endpoint and its owner before anything resolves or runs", () => {
    const { companion } = gateway();
    expect(companion.status()).toEqual({
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
  });

  it("refuses a ref the adapter does not claim, and one another adapter claims", async () => {
    const { companion } = gateway();
    await companion.start(new FakeScope());
    expect(() => companion.forAdapter("obs").resolve(LIGHTS, { signal: live() })).toThrow(UnclaimedEndpointError);
    expect(() => companion.forAdapter("twitch").resolve(OBS_ENDPOINT, { signal: live() })).toThrow(
      'the adapter "twitch" does not claim the local endpoint woofx3_obs/obs'
    );
    expect(() => companion.forAdapter("obs").onRouteChange(LIGHTS, () => {})).toThrow(UnclaimedEndpointError);
  });

  it("asks for the relay credential only on the host scope it was started with", async () => {
    expect(COMPANION_GATEWAY_GRANTS.requests).toEqual(["engine.relay.credential"]);
    const { companion } = gateway({ store: { relayConfig: async () => CONFIG } });
    const scope = new FakeScope();
    await companion.start(scope);
    await companion.forAdapter("obs").resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK });
    expect(scope.requested).toEqual(["engine.relay.credential"]);
    await expect(companion.start(scope)).rejects.toThrow("already started");
  });
});

describe("EngineCompanionGateway resolution", () => {
  it("resolves a claimed ref under the adapter policy and reports the route", async () => {
    const { companion } = gateway();
    await companion.start(new FakeScope());
    expect(await companion.forAdapter("obs").resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK })).toEqual({
      ok: true,
      route: "direct",
      url: "ws://127.0.0.1:4455",
      password: "obs-secret",
      address: "127.0.0.1:4455",
    });
    expect(companion.status().endpoints[0]).toMatchObject({
      route: "direct",
      address: "127.0.0.1:4455",
      lastFailure: null,
    });
  });

  it("keeps a failure in its status until a resolution succeeds, and never a secret", async () => {
    let refuse = true;
    const { companion, time } = gateway({
      store: { relayConfig: async () => CONFIG },
      fetch: async () => (refuse ? new Response("no", { status: 503 }) : Response.json({ ticket: TICKET })),
    });
    await companion.start(new FakeScope());
    const handle = companion.forAdapter("obs");
    expect(await handle.resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK })).toMatchObject({
      ok: false,
      reason: "relay",
    });
    expect(companion.status().endpoints[0]).toEqual({
      moduleId: "woofx3_obs",
      endpointId: "obs",
      owner: "obs",
      route: "companion",
      address: "c-x.woofx3.tv",
      lastFailure: { reason: "relay", message: "the companion relay refused the bridge (503)", at: time.now() },
    });
    refuse = false;
    const found = await handle.resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK });
    expect(found).toMatchObject({ ok: true, route: "companion", url: expect.stringContaining(TICKET) });
    const status = JSON.stringify(companion.status());
    expect(companion.status().endpoints[0]?.lastFailure).toBeNull();
    for (const secret of [TICKET, GRANT.credential, "obs-secret"]) {
      expect(status).not.toContain(secret);
    }
  });

  it("throws when resolving before it was started, because that is a wiring bug", () => {
    const { companion } = gateway({ store: { relayConfig: async () => CONFIG } });
    expect(() => companion.forAdapter("obs").resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK })).toThrow(
      "not started"
    );
  });

  it("goes direct on a local engine whatever the relay configuration says", async () => {
    const { companion, logger } = gateway({
      store: { relayConfig: async () => CONFIG },
      env: { woofx3Hosting: "local" },
    });
    const scope = new FakeScope();
    await companion.start(scope);
    expect(
      await companion.forAdapter("obs").resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK })
    ).toMatchObject({
      ok: true,
      route: "direct",
    });
    expect(scope.requested).toEqual([]);
    expect(logger.at("warn")).toHaveLength(1);
    expect(companion.status().hosting).toBe("local");
  });

  it("abandons a resolution in flight when it stops", async () => {
    const hanging: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const { companion } = gateway({ store: { relayConfig: async () => CONFIG }, fetch: hanging });
    await companion.start(new FakeScope());
    const resolving = companion.forAdapter("obs").resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK });
    await flush();
    expect(companion.status().bridgeOpens.inUse).toBe(1);
    await companion.stop();
    await expect(resolving).rejects.toThrow("the companion gateway stopped");
    expect(companion.status().bridgeOpens.inUse).toBe(0);
    await expect(
      companion.forAdapter("obs").resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK })
    ).rejects.toThrow("the companion gateway stopped");
  });
});

describe("EngineCompanionGateway route changes", () => {
  it("tells a claimed endpoint's listener when its module settings are written or the relay moves it", async () => {
    let config: RelayConfig | null = null;
    const { companion } = gateway({
      store: { relayConfig: async () => (config === null ? null : { ...config, clientId: "dash" }) },
    });
    const scope = new FakeScope();
    await companion.start(scope);
    const handle = companion.forAdapter("obs");
    await handle.resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK });
    const heard: string[] = [];
    const stop = handle.onRouteChange(OBS_ENDPOINT, (why) => heard.push(why));

    scope.deliver("db.module.setting.updated.woofx3_obs", bytes(JSON.stringify({ data: { moduleId: "woofx3_obs" } })));
    scope.deliver("engine.relay.config.updated", bytes("{}"));
    await flush();
    config = CONFIG;
    scope.deliver("engine.relay.config.updated", bytes("{}"));
    await flush();
    expect(heard).toEqual(["woofx3_obs settings changed", "Relay configuration changed"]);

    stop();
    scope.deliver("db.module.setting.updated.woofx3_obs", bytes(JSON.stringify({ data: { moduleId: "woofx3_obs" } })));
    expect(heard).toHaveLength(2);
  });
});
