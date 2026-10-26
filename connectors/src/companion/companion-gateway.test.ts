import { describe, expect, it } from "bun:test";
import type { RelayGrant, StoredRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";
import { OBS_ENDPOINT, obsAdapterFallback } from "../adapters/obs/settings";
import { CompanionEnvSchema, companionConfig } from "../config/companion";
import type { Clock } from "../host/deps";
import { HostRequests } from "../host/host-requests";
import type { BusMessage, ScopedHandler } from "../host/scoped-bus";
import {
  bytes,
  countingIds,
  emptyEndpointStore,
  FakeTime,
  flush,
  RecordingLogger,
  relayConfigStore,
  text,
} from "../host/testing";
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

/** A host scope that records subscriptions and answers dashboard credential requests with `grant`. */
class FakeScope {
  readonly handlers = new Map<string, ScopedHandler>();
  readonly requested: Array<{ subject: string; body: unknown }> = [];

  constructor(
    private readonly grant: RelayGrant | null = GRANT,
    private readonly clock: Clock = { now: () => 0 }
  ) {}

  async subscribe(subject: string, handler: ScopedHandler): Promise<void> {
    this.handlers.set(subject, handler);
  }

  async request(subject: string, data: Uint8Array): Promise<{ subject: string; data: Uint8Array }> {
    const body = JSON.parse(text(data)) as { clientId: string };
    this.requested.push({ subject, body });
    const reply = { status: "answered", clientId: body.clientId, answer: { relay: this.grant } };
    return { subject, data: bytes(JSON.stringify(reply)) };
  }

  /** Delivers a message to every matching handler and returns the replies it collects. */
  deliver(subject: string, data: Uint8Array): Uint8Array[] {
    const replies: Uint8Array[] = [];
    const msg: BusMessage = {
      subject,
      data,
      reply: "inbox",
      respond: (out) => {
        replies.push(out);
        return true;
      },
    };
    for (const [pattern, handler] of this.handlers) {
      const prefix = pattern.replace(/\*$/, "");
      if (pattern === subject || (pattern.endsWith("*") && subject.startsWith(prefix))) {
        void handler(msg, { receivedAt: this.clock.now() } as never);
      }
    }
    return replies;
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

  it("asks the api for the dashboard's credential only on the host scope it was started with", async () => {
    expect(COMPANION_GATEWAY_GRANTS.requests).toEqual(["engine.companion.dashboard_credential"]);
    const { companion } = gateway({ store: { relayConfig: async () => CONFIG } });
    const scope = new FakeScope();
    await companion.start(scope);
    await companion.forAdapter("obs").resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK });
    expect(scope.requested).toEqual([{ subject: "engine.companion.dashboard_credential", body: { clientId: "dash" } }]);
    await expect(companion.start(scope)).rejects.toThrow("already started");
  });

  it("serves the relay configuration writes and module requests, and subscribes to nothing else of the relay", async () => {
    const { companion } = gateway();
    const scope = new FakeScope();
    await companion.start(scope);
    expect(companion.served).toEqual([
      { subject: "engine.companion.relay_config.set", budgetMs: 4_500 },
      { subject: "engine.companion.module.request", budgetMs: 4_500 },
    ]);
    expect([...scope.handlers.keys()]).toEqual([
      "db.module.setting.updated.*",
      "engine.companion.relay_config.set",
      "engine.companion.module.request",
    ]);
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

describe("EngineCompanionGateway relay ownership", () => {
  const setConfig = (config: StoredRelayConfig | null) => bytes(JSON.stringify({ config }));

  async function started(store = relayConfigStore()) {
    const setup = gateway({ store });
    const scope = new FakeScope(GRANT, setup.time);
    await setup.companion.start(scope);
    return { ...setup, scope, store };
  }

  async function reply(replies: Uint8Array[]): Promise<unknown> {
    while (replies.length === 0) {
      await flush();
    }
    return JSON.parse(text(replies[0] as Uint8Array));
  }

  it("stores a configuration it is sent, and clears it on null", async () => {
    const { scope, store } = await started();
    expect(await reply(scope.deliver("engine.companion.relay_config.set", setConfig(CONFIG)))).toEqual({
      status: "stored",
    });
    expect(store.relay.config).toEqual(CONFIG);
    expect(await reply(scope.deliver("engine.companion.relay_config.set", setConfig(null)))).toEqual({
      status: "stored",
    });
    expect(store.relay.config).toBeNull();
  });

  it("refuses a configuration without a dashboard client id, and stores nothing", async () => {
    const { scope, store } = await started();
    const { clientId: _, ...anonymous } = CONFIG;
    const answer = await reply(
      scope.deliver("engine.companion.relay_config.set", bytes(JSON.stringify({ config: anonymous })))
    );
    expect(answer).toEqual({ status: "failed", error: "invalid: relay config clientId must be a non-empty string" });
    expect(store.relay.config).toBeNull();
  });

  it("answers a failed write as failed", async () => {
    const { scope } = await started({
      ...relayConfigStore(),
      writeRelayConfig: async () => {
        throw new Error("db-proxy SetSetting: unavailable");
      },
    } as ReturnType<typeof relayConfigStore>);
    expect(await reply(scope.deliver("engine.companion.relay_config.set", setConfig(CONFIG)))).toEqual({
      status: "failed",
      error: "db-proxy SetSetting: unavailable",
    });
  });

  it("clears the stored configuration when the dashboard answers that nothing is routed", async () => {
    const store = relayConfigStore(CONFIG);
    const setup = gateway({ store });
    await setup.companion.start(new FakeScope(null));
    expect(
      await setup.companion.forAdapter("obs").resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK })
    ).toMatchObject({ ok: true, route: "direct" });
    expect(store.relay.config).toBeNull();
  });
});

describe("EngineCompanionGateway route changes", () => {
  it("tells a claimed endpoint's listener when its module settings are written or the relay moves it", async () => {
    const store = relayConfigStore();
    const { companion, time } = gateway({ store });
    const scope = new FakeScope(GRANT, time);
    await companion.start(scope);
    const handle = companion.forAdapter("obs");
    await handle.resolve(OBS_ENDPOINT, { signal: live(), fallback: FALLBACK });
    const heard: string[] = [];
    const stop = handle.onRouteChange(OBS_ENDPOINT, (why) => heard.push(why));

    scope.deliver(
      "db.module.setting.updated.system",
      bytes(JSON.stringify({ type: "module.setting.updated", data: { moduleId: "woofx3_obs", key: "host" } }))
    );
    scope.deliver("engine.companion.relay_config.set", bytes(JSON.stringify({ config: null })));
    await flush();
    scope.deliver("engine.companion.relay_config.set", bytes(JSON.stringify({ config: CONFIG })));
    await flush();
    expect(heard).toEqual(["woofx3_obs settings changed", "Relay configuration changed"]);

    stop();
    scope.deliver(
      "db.module.setting.updated.system",
      bytes(JSON.stringify({ type: "module.setting.updated", data: { moduleId: "woofx3_obs", key: "host" } }))
    );
    expect(heard).toHaveLength(2);
  });
});
