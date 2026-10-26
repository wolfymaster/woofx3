import { PLATFORM_IDS } from "@woofx3/api/platform-gateway";
import { EventType as SessionEventType } from "@woofx3/common/cloudevents/Session/events";
import { type SessionBus, subscribeToSessionUpdates } from "@woofx3/common/cloudevents/session-subscriber";
import type { DispatcherDb } from "../chat/db-client";
import { ClaimRegistry } from "../companion/claims";
import { COMPANION_GATEWAY_GRANTS, EngineCompanionGateway } from "../companion/companion-gateway";
import type { Fetch } from "../companion/dialer";
import type { OpenSocket } from "../companion/endpoint-sessions";
import type { EndpointStore } from "../companion/endpoint-store";
import type { NameResolver } from "../companion/local-address";
import type { ChatConfig } from "../config/chat";
import type { CompanionConfig } from "../config/companion";
import type { GatewayConfig } from "../config/gateway";
import type { HostConfig } from "../config/host";
import { EgressRegistry } from "../gateway/egress-registry";
import { PlatformGateway } from "../gateway/platform-gateway";
import type { DbProxyClientConfig } from "../services/db-proxy";
import type { Adapter } from "./adapter";
import type { AdapterId } from "./adapter-ids";
import { bounded } from "./bounded";
import { ChatService } from "./chat-service";
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

/**
 * db-proxy counts as unreachable once this many passes in a row got no link
 * read back, for the same reason: one can be a slow read, two cannot.
 */
export const DB_PROXY_UNREACHABLE_PASSES = 2;

/**
 * Where a host is in its one pass through start and stop. A host runs once:
 * the application builds a fresh one for every run, so a stopped host never
 * starts again.
 */
export type HostState = "idle" | "starting" | "running" | "stopping" | "stopped";

/** What the companion gateway is built with. */
export interface HostCompanionDeps {
  config: CompanionConfig;
  /** Where endpoint settings and the relay configuration are read from. */
  store: EndpointStore;
  /** The relay's ticket exchange. */
  fetch: Fetch;
  /** Resolves a `.local` name in a module endpoint's address. */
  resolver: NameResolver;
  /** Opens the websockets module requests are written to. */
  openSocket: OpenSocket;
}

export interface HostDeps {
  config: HostConfig;
  gateway: GatewayConfig;
  chat: ChatConfig;
  companion: HostCompanionDeps;
  dbProxy: DbProxyClientConfig;
  /** Replaces the dispatcher's db-proxy client; tests pass an in-memory fake. */
  dispatcherDb?: DispatcherDb;
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
  private readonly chat: ChatService;
  private readonly companion: EngineCompanionGateway;
  private lifecycle: HostState = "idle";
  /** How long stop gives the adapters and the held requests together: the longest of the stop deadline and the served budgets. */
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
    // Built before the supervisor, which hands each adapter its scoped handle,
    // and stopped after it, so no adapter run outlives it.
    this.companion = new EngineCompanionGateway({
      config: deps.companion.config,
      claims: ClaimRegistry.fromManifests([...deps.adapters.values()].map((adapter) => adapter.manifest)),
      store: deps.companion.store,
      fetch: deps.companion.fetch,
      resolver: deps.companion.resolver,
      openSocket: deps.companion.openSocket,
      requests: this.requests,
      clock: deps.clock,
      timers: deps.timers,
      ids: deps.ids,
      logger: deps.logger.child({ component: "companion-gateway" }),
    });
    assertNoSecondResponder(deps.adapters, [...this.gateway.served, ...this.companion.served]);
    const longestBudgetMs = Math.max(0, ...this.servedBudgets());
    this.drainMs = Math.max(deps.config.stopDeadlineMs, longestBudgetMs);
    const stopWorstCaseMs = deps.config.dbProxyTimeoutMs + deps.chat.drainMs + this.drainMs;
    if (deps.config.shutdownDeadlineMs <= stopWorstCaseMs) {
      throw new Error(
        `the shutdown deadline (${deps.config.shutdownDeadlineMs}ms) must exceed the db-proxy timeout plus the chat drain plus the longest of the stop deadline and the served budgets (${stopWorstCaseMs}ms)`
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
    this.chat = new ChatService({
      config: deps.chat,
      dbProxy: deps.dbProxy,
      db: deps.dispatcherDb,
      bus: deps.bus,
      limits: deps.config.subscriptionLimits,
      drainMs: deps.chat.drainMs,
      clock: deps.clock,
      random: deps.random,
      timers: deps.timers,
      logger: deps.logger.child({ component: "chat" }),
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

  get state(): HostState {
    return this.lifecycle;
  }

  /** Started and not yet stopping: what the bus heartbeat reports as ready. */
  get isRunning(): boolean {
    return this.lifecycle === "running";
  }

  /**
   * Follows the stream session, serves every adapter's subjects and the
   * gateway's, starts the chat dispatcher (its replies go through the
   * gateway), then reads the links and starts what is desired.
   */
  async start(): Promise<void> {
    if (this.lifecycle !== "idle") {
      throw new Error(`the host can start only once, from idle; it is ${this.lifecycle}`);
    }
    this.lifecycle = "starting";
    // The session every event is stamped with is process-wide, so the host
    // follows it rather than each adapter run: an adapter that starts after a
    // session change still stamps the current session.
    await subscribeToSessionUpdates(sessionBus(this.scope), this.deps.logger);
    this.assertStillStarting();
    for (const [id, adapter] of this.deps.adapters) {
      await this.served.serveAll(id, adapter.manifest.serves);
      this.assertStillStarting();
    }
    await this.gateway.serve(this.scope);
    this.assertStillStarting();
    await this.companion.start(this.scope);
    this.assertStillStarting();
    await this.chat.start();
    this.assertStillStarting();
    await this.watcher.start();
    this.assertStillStarting();
    this.lifecycle = "running";
  }

  /**
   * Stops reading settings (at most one read timeout), drains the chat lines
   * in flight (at most the chat drain time) while the gateway and the
   * adapters still answer, then stops every adapter and stops answering
   * together. Held requests settle as their adapters stop, or at their
   * budget, so that half takes at most the larger of the stop deadline and
   * the longest budget. The constructor checks the shutdown deadline covers
   * all three steps. The companion gateway stops last, once no adapter can
   * ask it for a route.
   *
   * A host still starting is stopped as if it were running, so a start that
   * failed partway is cleaned up. Stopping a host that never started only
   * retires it, and a second stop returns at once.
   */
  async stop(): Promise<void> {
    if (this.lifecycle === "idle") {
      this.lifecycle = "stopped";
      return;
    }
    if (this.lifecycle === "stopping" || this.lifecycle === "stopped") {
      return;
    }
    this.lifecycle = "stopping";
    await this.watcher.stop();
    await this.chat.drain();
    const [, drained] = await Promise.all([
      this.supervisor.stopAll(),
      bounded(() => this.scope.closeAll(), this.drainMs, this.deps.timers),
    ]);
    await this.chat.close();
    if (drained.kind === "timeout") {
      this.deps.logger.error("host requests still running past the stop deadline; leaving them", {
        drainMs: this.drainMs,
      });
    } else if (drained.kind === "failed") {
      this.deps.logger.error("closing the host bus scope failed", { error: errorMessage(drained.error) });
    }
    await this.companion.stop();
    this.lifecycle = "stopped";
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
      failedLinkPasses: this.watcher.consecutiveFailedPasses,
      dbProxyUnreachableAfterPasses: DB_PROXY_UNREACHABLE_PASSES,
      adapters: this.supervisor.report(),
      hostRequests: this.requests.snapshot(),
      hostBus: this.hostCounters.snapshot(),
      gateway: this.gateway.snapshot(),
      chat: this.chat.snapshot(),
      companion: this.companion.status(),
    };
  }

  /**
   * A stop that began while starting owns the state and tears down only
   * what was set up before it, so the start goes no further: anything set up
   * after that point would outlive the stop.
   */
  private assertStillStarting(): void {
    if (this.lifecycle !== "starting") {
      throw new Error(`the host was stopped while starting; it is ${this.lifecycle}`);
    }
  }

  /** Every subject the host answers: each adapter's served subjects, the platform gateway's and the companion gateway's. */
  private answered(): Array<{ subject: string; budgetMs: number }> {
    return [
      ...[...this.deps.adapters.values()].flatMap((adapter) => adapter.manifest.serves),
      ...this.gateway.served,
      ...this.companion.served,
    ];
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
