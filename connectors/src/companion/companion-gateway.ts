// The companion gateway: the engine's one runtime path to endpoints on the
// streamer's network. It knows which endpoints the host adapters claim, how
// to reach each one (directly or through the companion's relay bridge), and
// who may ask; it knows no device protocol. Always on, for the life of the
// host. See docs/services/companion-gateway.md.

import { RELAY_CREDENTIAL_SUBJECT, requestRelayCredentialOverNats } from "@woofx3/common/cloudevents/Relay/relay";
import type { CompanionConfig } from "../config/companion";
import type { AdapterId } from "../host/adapter-ids";
import type { Clock, IdSource, Logger, Timers } from "../host/deps";
import type { HostRequests } from "../host/host-requests";
import type { ScopedBus } from "../host/scoped-bus";
import { BridgeOpens } from "./bridge-opens";
import { type ClaimRegistry, endpointKey } from "./claims";
import { EndpointDialer, type Fetch } from "./dialer";
import type { EndpointStore } from "./endpoint-store";
import { EndpointSessions, type OpenSocket } from "./endpoint-sessions";
import { boundedResolver, type NameResolver } from "./local-address";
import { modulePolicy } from "./module-route-policy";
import { ModuleRequests } from "./module-requests";
import { adapterPolicy, type RoutePolicy } from "./route-policy";
import { type LastRoute, ROUTE_WATCH_SUBJECTS, RouteWatch } from "./route-watch";
import type {
  CompanionGateway,
  CompanionGatewayStatus,
  CompanionHandle,
  EndpointResolution,
  EndpointStatus,
  LocalEndpointRef,
  ResolveOptions,
} from "./types";

/** What the companion gateway does on the host's bus scope, for the host to grant. */
export const COMPANION_GATEWAY_GRANTS = {
  subscribes: ROUTE_WATCH_SUBJECTS,
  requests: [RELAY_CREDENTIAL_SUBJECT],
} as const;

export interface CompanionGatewayDeps {
  config: CompanionConfig;
  claims: ClaimRegistry;
  /** Read afresh on every resolution. */
  store: EndpointStore;
  fetch: Fetch;
  /** Resolves a `.local` name in a module endpoint's address. */
  resolver: NameResolver;
  openSocket: OpenSocket;
  /** Serves module requests on the host's scope. */
  requests: HostRequests;
  clock: Clock;
  timers: Timers;
  ids: IdSource;
  logger: Logger;
}

/** The latest attempt for one claimed endpoint. */
interface EndpointRecord {
  ref: LocalEndpointRef;
  owner: AdapterId;
  attempt: LastRoute | null;
  failure: EndpointStatus["lastFailure"];
}

export class EngineCompanionGateway implements CompanionGateway {
  private scope: Pick<ScopedBus, "request" | "subscribe"> | null = null;
  /** Aborted by stop: every resolution in flight is abandoned. */
  private readonly lifetime = new AbortController();
  private readonly opens: BridgeOpens;
  private readonly dialer: EndpointDialer;
  private readonly watch: RouteWatch;
  /** Every claimed endpoint is resolved under the adapter policy; module requests get their own. */
  private readonly claimedPolicy: RoutePolicy;
  private readonly records = new Map<string, EndpointRecord>();
  private readonly sessions: EndpointSessions;
  private readonly moduleRequests: ModuleRequests;

  constructor(private readonly deps: CompanionGatewayDeps) {
    const logger = deps.logger;
    this.opens = new BridgeOpens(deps.config.maxBridgeOpens);
    const relayCredential = requestRelayCredentialOverNats((subject, data, opts) => {
      if (opts?.timeout === undefined) {
        throw new Error(`${subject}: a request needs a timeout`);
      }
      return this.started().request(subject, data, { timeout: opts.timeout });
    }, deps.config.relayCredentialTimeoutMs);
    this.dialer = new EndpointDialer({
      relayConfig: () => deps.store.relayConfig(),
      relayCredential,
      fetch: deps.fetch,
      opens: this.opens,
      hosting: deps.config.hosting,
      ticketTimeoutMs: deps.config.ticketTimeoutMs,
      timers: deps.timers,
      logger,
    });
    this.watch = new RouteWatch({
      relayConfig: () => deps.store.relayConfig(),
      lastRoute: (ref) => this.records.get(endpointKey(ref))?.attempt ?? null,
      hosting: deps.config.hosting,
      logger,
    });
    this.claimedPolicy = adapterPolicy({ store: deps.store, logger });
    // Unclaimed endpoints are reachable only by their own module's code, under a policy that fails closed.
    const unclaimedPolicy = modulePolicy({
      store: deps.store,
      claims: deps.claims,
      hosting: deps.config.hosting,
      localDirect: deps.config.moduleLocalDirect,
      resolver: boundedResolver(deps.resolver, deps.config.moduleSessions.resolveTimeoutMs, deps.timers),
    });
    this.sessions = new EndpointSessions({
      limits: deps.config.moduleSessions,
      resolve: (ref, signal) =>
        this.dialer.dial(unclaimedPolicy, ref, { signal: AbortSignal.any([signal, this.lifetime.signal]) }),
      onRouteChange: (ref, listener) => this.watch.listen(ref, listener),
      openSocket: deps.openSocket,
      clock: deps.clock,
      timers: deps.timers,
      ids: deps.ids,
      logger,
    });
    this.moduleRequests = new ModuleRequests({
      policy: unclaimedPolicy,
      sessions: this.sessions,
      budgetMs: deps.config.moduleSessions.requestBudgetMs,
      clock: deps.clock,
      timers: deps.timers,
      logger,
    });
    for (const { ref, owner } of deps.claims.claims()) {
      this.records.set(endpointKey(ref), { ref, owner, attempt: null, failure: null });
    }
  }

  /** The subjects the gateway answers, for the host's grants and drain budget. */
  get served(): ReadonlyArray<{ subject: string; budgetMs: number }> {
    return this.moduleRequests.served;
  }

  /**
   * Follows route changes and answers module requests on the host's scope,
   * which also carries the bridge credential requests.
   */
  async start(scope: Pick<ScopedBus, "request" | "subscribe">): Promise<void> {
    if (this.scope !== null) {
      throw new Error("the companion gateway is already started");
    }
    this.scope = scope;
    await this.watch.subscribe(scope);
    await this.deps.requests.serveRequest(scope, this.moduleRequests.spec());
  }

  forAdapter(id: AdapterId): CompanionHandle {
    return {
      resolve: (ref, opts) => {
        // Thrown synchronously, not returned as a rejection: an unclaimed ref is a bug in the adapter.
        this.deps.claims.assertClaimedBy(id, ref);
        this.started();
        return this.resolveClaimed(ref, opts);
      },
      onRouteChange: (ref, listener) => {
        this.deps.claims.assertClaimedBy(id, ref);
        return this.watch.listen(ref, listener);
      },
    };
  }

  status(): CompanionGatewayStatus {
    return {
      hosting: this.deps.config.hosting,
      endpoints: [...this.records.values()].map(({ ref, owner, attempt, failure }) => ({
        moduleId: ref.moduleId,
        endpointId: ref.endpointId,
        owner,
        route: attempt?.route ?? null,
        address: attempt?.address ?? null,
        lastFailure: failure,
      })),
      bridgeOpens: this.opens.status(),
      modules: { sessions: this.sessions.status(), requests: this.moduleRequests.snapshot() },
    };
  }

  async stop(): Promise<void> {
    this.lifetime.abort(new Error("the companion gateway stopped"));
    await this.sessions.stop();
    this.dialer.stop();
  }

  private async resolveClaimed(ref: LocalEndpointRef, opts: ResolveOptions): Promise<EndpointResolution> {
    const signal = AbortSignal.any([opts.signal, this.lifetime.signal]);
    const resolution = await this.dialer.dial(this.claimedPolicy, ref, { ...opts, signal });
    this.record(ref, resolution);
    return resolution;
  }

  private record(ref: LocalEndpointRef, resolution: EndpointResolution): void {
    const record = this.records.get(endpointKey(ref));
    if (record === undefined) {
      throw new Error(`no companion record for ${endpointKey(ref)}; every claimed endpoint is seeded at construction`);
    }
    if (resolution.ok) {
      record.attempt = { route: resolution.route, address: resolution.address };
      record.failure = null;
      return;
    }
    // A failure on the bridge still says where the attempt went, so a relay
    // configuration change that moves the endpoint off it is noticed.
    record.attempt = resolution.address === undefined ? null : { route: "companion", address: resolution.address };
    record.failure = { reason: resolution.reason, message: resolution.message, at: this.deps.clock.now() };
  }

  private started(): Pick<ScopedBus, "request"> {
    if (this.scope === null) {
      throw new Error("the companion gateway is not started");
    }
    return this.scope;
  }
}
