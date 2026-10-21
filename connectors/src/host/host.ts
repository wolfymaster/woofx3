import type { HostConfig } from "../config/host";
import type { Adapter } from "./adapter";
import type { AdapterId } from "./adapter-ids";
import type { Clock, IdSource, Logger, RandomSource, Timers } from "./deps";
import type { HealthSnapshot } from "./health";
import { HostRequests } from "./host-requests";
import type { LinkReaderRegistry, SettingsReader } from "./link-readers";
import { type BusClient, ScopeCounters, ScopedBus } from "./scoped-bus";
import { ServedSubjects } from "./served-subjects";
import { SETTINGS_SUBJECTS, SettingsWatcher } from "./settings-watcher";
import { Supervisor } from "./supervisor";

/** The scope name of the host's own subscriptions, in refusals and log lines. */
export const HOST_SCOPE = "host";

/**
 * The reconcile loop counts as stopped once its last pass is this many
 * backstop intervals old: one missed tick can be a slow db-proxy read, two
 * cannot.
 */
export const LOOP_STALE_INTERVALS = 2;

export interface HostDeps {
  config: HostConfig;
  dbProxyUrl: string;
  bus: BusClient;
  busConnected: () => boolean;
  settings: SettingsReader;
  adapters: ReadonlyMap<AdapterId, Adapter>;
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
  private running = false;

  constructor(private readonly deps: HostDeps) {
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
        dbProxyUrl: deps.dbProxyUrl,
        clock: deps.clock,
        random: deps.random,
        timers: deps.timers,
        logger: deps.logger,
      }
    );
    this.requests = new HostRequests({ clock: deps.clock, ids: deps.ids, timers: deps.timers, logger: deps.logger });
    this.scope = new ScopedBus({
      scope: HOST_SCOPE,
      client: deps.bus,
      grants: {
        publishes: [],
        subscribes: [...SETTINGS_SUBJECTS, ...this.servedSubjects()],
        requests: [],
      },
      limits: deps.config.subscriptionLimits,
      logger: deps.logger.child({ scope: HOST_SCOPE }),
      counters: this.hostCounters,
    });
    this.served = new ServedSubjects({
      requests: this.requests,
      scope: this.scope,
      adapters: this.supervisor,
      logger: deps.logger,
    });
    this.watcher = new SettingsWatcher({
      adapters: this.supervisor.adapterIds,
      readers: deps.readers,
      settings: deps.settings,
      sink: this.supervisor,
      scope: this.scope,
      clock: deps.clock,
      timers: deps.timers,
      logger: deps.logger,
      reconcileIntervalMs: deps.config.reconcileIntervalMs,
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Serves every adapter's subjects, then reads the links and starts what is desired. */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("the host is already running");
    }
    this.running = true;
    for (const [id, adapter] of this.deps.adapters) {
      await this.served.serveAll(id, adapter.manifest.serves);
    }
    await this.watcher.start();
  }

  /** Stops reading settings, stops every adapter under its deadline, then stops answering. */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    await this.watcher.stop();
    await this.supervisor.stopAll();
    await this.scope.closeAll();
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
    };
  }

  private servedSubjects(): string[] {
    return [...this.deps.adapters.values()].flatMap((adapter) => adapter.manifest.serves.map((s) => s.subject));
  }
}
