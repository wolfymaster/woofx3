import { PLATFORM_IDS } from "@woofx3/api/platform-gateway";
import { EventType as SessionEventType } from "@woofx3/common/cloudevents/Session/events";
import { type SessionBus, subscribeToSessionUpdates } from "@woofx3/common/cloudevents/session-subscriber";
import { ClaimRegistry } from "../companion/claims";
import { COMPANION_GATEWAY_GRANTS, EngineCompanionGateway } from "../companion/companion-gateway";
import type { Fetch } from "../companion/dialer";
import type { EndpointStore } from "../companion/endpoint-store";
import type { CompanionConfig } from "../config/companion";
import type { GatewayConfig } from "../config/gateway";
import type { HostConfig } from "../config/host";
import { EgressRegistry } from "../gateway/egress-registry";
import { PlatformGateway } from "../gateway/platform-gateway";
import type { DbProxyClientConfig } from "../services/db-proxy";
import type { Adapter } from "./adapter";
import type { AdapterId } from "./adapter-ids";
import { bounded } from "./bounded";
import { type Clock, errorMessage, type IdSource, type Logger, type RandomSource, type Timers } from "./deps";
import type { HealthSnapshot } from "./health";
import { HostRequests } from "./host-requests";
import type { LinkReaderRegistry, LinkStore } from "./link-readers";
import { type BusClient, ScopeCounters, ScopedBus, subjectCovered } from "./scoped-bus";
import { ServedSubjects } from "./served-subjects";
import { SettingsWatcher, watchedSubjects } from "./settings-watcher";
import { Supervisor } from "./supervisor";

/** The scope name of the host's own subscriptions, in refusals and log lines. */
export const HOST_SCOPE = "host";

/**
 * The reconcile loop counts as stopped once its last pass is this many
 * backstop intervals old: one missed tick can be a slow db-proxy read, two
 * cannot.
 */
export const LOOP_STALE_INTERVALS = 2;

/** What the companion gateway is built with. */
export interface HostCompanionDeps {
  config: CompanionConfig;
  /** Where endpoint settings and the relay configuration are read from. */
  store: EndpointStore;
  /** The relay's ticket exchange. */
  fetch: Fetch;
}

export interface HostDeps {
  config: HostConfig;
  gateway: GatewayConfig;
  companion: HostCompanionDeps;
  dbProxy: DbProxyClientConfig;
  bus: BusClient;
  busConnected: () => boolean;
  linkStore: LinkStore;
  adapters: ReadonlyMap<AdapterId, Adapter>;
  hostStates: ReadonlyMap<AdapterId, unknown>;
  readers: LinkReaderRegistry;
  clock: Clock;
  random: RandomSource;
  ids: IdSource;
  timers: Timers;
  logger: Logger;
}

/**
 * The always-on part of connectors: it watches link settings, runs each
 * adapter while it is desired, and answers every served subject. It knows
 * nothing about how it is delivered; the application starts and stops it.
 */
export class Host {
  private readonly supervisor: Supervisor;
  private readonly requests: HostRequests;
  private readonly hostCounters = new ScopeCounters();
  private readonly scope: ScopedBus;
  private readonly served: ServedSubjects;
  private readonly watcher: SettingsWatcher;
  private readonly gateway: PlatformGateway;
  private readonly companion: EngineCompanionGateway;
  private running = false;
  /** How long stop gives the adapters and the held requests together: the larger of the stop deadline and any budget. */
  private readonly drainMs: number;

  constructor(private readonly deps: HostDeps) {
    for (const id of deps.adapters.keys()) {
      if (!deps.hostStates.has(id)) {
        throw new Error(`the adapter "${id}" has no host state entry; loadAdapters builds both together`);
      }
    }
    this.requests = new HostRequests({ clock: deps.clock, ids: deps.ids, timers: deps.timers, logger: deps.logger });
    this.gateway = new PlatformGateway({
      config: deps.gateway,
      egress: EgressRegistry.fromManifests(
        [...deps.adapters.values()].map((adapter) => adapter.manifest),
        PLATFORM_IDS
      ),
      adapters: {
        status: (id) => this.supervisor.status(id),
        link: (id) => this.supervisor.link(id),
        onStatusChange: (listener) => this.supervisor.onStatusChange(listener),
      },
      requests: this.requests,
      clock: deps.clock,
      logger: deps.logger.child({ component: "platform-gateway" }),
    });
    assertNoSecondResponder(deps.adapters, this.gateway.served);
    // Built before the supervisor, which hands each adapter its scoped handle,
    // and stopped after it, so no adapter run outlives it.
    this.companion = new EngineCompanionGateway({
      config: deps.companion.config,
      claims: ClaimRegistry.fromManifests([...deps.adapters.values()].map((adapter) => adapter.manifest)),
      store: deps.companion.store,
      fetch: deps.companion.fetch,
      clock: deps.clock,
      timers: deps.timers,
      logger: deps.logger.child({ component: "companion-gateway" }),
    });
    const longestBudgetMs = Math.max(0, ...this.servedBudgets());
    this.drainMs = Math.max(deps.config.stopDeadlineMs, longestBudgetMs);
    const stopWorstCaseMs = deps.config.dbProxyTimeoutMs + this.drainMs;
    if (deps.config.shutdownDeadlineMs <= stopWorstCaseMs) {
      throw new Error(
        `the shutdown deadline (${deps.config.shutdownDeadlineMs}ms) must exceed the db-proxy timeout plus the larger of the stop deadline and the longest served budget (${stopWorstCaseMs}ms)`
      );
    }
    this.supervisor = new Supervisor(
      deps.adapters,
      {
        backoff: deps.config.backoff,
        park: deps.config.park,
        stopDeadlineMs: deps.config.stopDeadlineMs,
        subscriptionLimits: deps.config.subscriptionLimits,
      },
      {
        bus: deps.bus,
        dbProxy: deps.dbProxy,
        companion: this.companion,
        clock: deps.clock,
        random: deps.random,
        timers: deps.timers,
        logger: deps.logger,
      }
    );
    this.scope = new ScopedBus({
      scope: HOST_SCOPE,
      client: deps.bus,
      grants: {
        publishes: [],
        subscribes: [
          ...watchedSubjects(deps.readers),
          SessionEventType.SessionStarted,
          ...COMPANION_GATEWAY_GRANTS.subscribes,
          ...this.servedSubjects(),
        ],
        requests: [...COMPANION_GATEWAY_GRANTS.requests],
      },
      limits: deps.config.subscriptionLimits,
      logger: deps.logger.child({ scope: HOST_SCOPE }),
      counters: this.hostCounters,
      clock: deps.clock,
    });
    this.served = new ServedSubjects({
      requests: this.requests,
      scope: this.scope,
      adapters: this.supervisor,
      hostStates: deps.hostStates,
      logger: deps.logger,
    });
    this.watcher = new SettingsWatcher({
      adapters: this.supervisor.adapterIds,
      readers: deps.readers,
      store: deps.linkStore,
      sink: this.supervisor,
      scope: this.scope,
      clock: deps.clock,
      timers: deps.timers,
      logger: deps.logger,
      reconcileIntervalMs: deps.config.reconcileIntervalMs,
      readTimeoutMs: deps.config.dbProxyTimeoutMs,
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Follows the stream session, serves every adapter's subjects, then reads
   * the links and starts what is desired.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("the host is already running");
    }
    this.running = true;
    // The session every event is stamped with is process-wide, so the host
    // follows it rather than each adapter run: an adapter that starts after a
    // session change still stamps the current session.
    await subscribeToSessionUpdates(sessionBus(this.scope), this.deps.logger);
    for (const [id, adapter] of this.deps.adapters) {
      await this.served.serveAll(id, adapter.manifest.serves);
    }
    await this.gateway.serve(this.scope);
    await this.companion.start(this.scope);
    await this.watcher.start();
  }

  /**
   * Stops reading settings (at most one read timeout), then stops every
   * adapter and stops answering together. Held requests settle as their
   * adapters stop, or at their budget, so the second half takes at most the
   * larger of the stop deadline and the longest budget. The constructor
   * checks the shutdown deadline covers both halves. The companion gateway
   * stops last, once no adapter can ask it for a route.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    await this.watcher.stop();
    const [, drained] = await Promise.all([
      this.supervisor.stopAll(),
      bounded(() => this.scope.closeAll(), this.drainMs, this.deps.timers),
    ]);
    if (drained.kind === "timeout") {
      this.deps.logger.error("host requests still running past the stop deadline; leaving them", {
        drainMs: this.drainMs,
      });
    } else if (drained.kind === "failed") {
      this.deps.logger.error("closing the host bus scope failed", { error: errorMessage(drained.error) });
    }
    await this.companion.stop();
  }

  /** Resolves once no settings pass or adapter transition is in progress. For tests. */
  async settled(): Promise<void> {
    await this.watcher.idle();
    await this.supervisor.whenIdle();
  }

  snapshot(): HealthSnapshot {
    return {
      now: this.deps.clock.now(),
      busConnected: this.deps.busConnected(),
      lastPassAt: this.watcher.lastPass,
      loopStaleAfterMs: LOOP_STALE_INTERVALS * this.deps.config.reconcileIntervalMs,
      adapters: this.supervisor.report(),
      hostRequests: this.requests.snapshot(),
      hostBus: this.hostCounters.snapshot(),
      gateway: this.gateway.snapshot(),
      companion: this.companion.status(),
    };
  }

  /** Every subject the host answers: each adapter's served subjects and the gateway's. */
  private answered(): Array<{ subject: string; budgetMs: number }> {
    return [...[...this.deps.adapters.values()].flatMap((adapter) => adapter.manifest.serves), ...this.gateway.served];
  }

  private servedBudgets(): number[] {
    return this.answered().map((s) => s.budgetMs);
  }

  private servedSubjects(): string[] {
    return this.answered().map((s) => s.subject);
  }
}

/**
 * The host is the one responder on the gateway's subjects; an adapter whose
 * manifest would let it subscribe to one could answer a request first.
 */
function assertNoSecondResponder(
  adapters: ReadonlyMap<AdapterId, Adapter>,
  served: ReadonlyArray<{ subject: string }>
): void {
  for (const [id, adapter] of adapters) {
    for (const { subject } of served) {
      const covering = adapter.manifest.subscribes.find((pattern) => subjectCovered(pattern, subject));
      if (covering !== undefined) {
        throw new Error(`adapter "${id}" subscribes to "${covering}", which covers the host's ${subject}`);
      }
      if (adapter.manifest.serves.some((own) => own.subject === subject)) {
        throw new Error(`adapter "${id}" serves "${subject}", which the host serves itself`);
      }
    }
  }
}

const decoder = new TextDecoder();

/** The host scope as the shared session subscriber reads it. */
function sessionBus(scope: ScopedBus): SessionBus {
  return {
    subscribe: (subject, handler) =>
      scope.subscribe(subject, (msg) => handler({ json: () => JSON.parse(decoder.decode(msg.data)) })),
  };
}
