import { type Backoff, type BackoffConfig, createBackoff } from "@woofx3/common/runtime";
import type { Adapter, AdapterContext, AdapterStatus } from "./adapter";
import type { AdapterId } from "./adapter-ids";
import type { Clock, Logger, RandomSource, TimerHandle, Timers } from "./deps";
import { errorMessage } from "./deps";
import type { LinkState } from "./link-readers";
import { type BusClient, ScopeCounters, ScopedBus, type SubscriptionLimits } from "./scoped-bus";

export interface SupervisorConfig {
  backoff: BackoffConfig;
  park: { afterFailures: number; windowMs: number };
  stopDeadlineMs: number;
  subscriptionLimits: SubscriptionLimits;
}

export interface SupervisorDeps {
  bus: BusClient;
  dbProxyUrl: string;
  clock: Clock;
  random: RandomSource;
  timers: Timers;
  logger: Logger;
}

export interface AdapterCounts {
  starts: number;
  /** Failed starts plus faults: each one counts toward parking. */
  failures: number;
  /** Connection losses the adapter reported while running. */
  faults: number;
  /** Served-subject handlers that threw. */
  servedErrors: number;
  /** Stops (or bus closes) that outlived the stop deadline. */
  stopTimeouts: number;
}

export interface AdapterReport {
  id: AdapterId;
  status: AdapterStatus;
  changedAt: number;
  link: LinkState | null;
  counts: AdapterCounts;
  bus: ReturnType<ScopeCounters["snapshot"]>;
}

export type StatusListener = (id: AdapterId, status: AdapterStatus) => void;

class Slot {
  status: AdapterStatus = { state: "stopped" };
  changedAt: number;
  link: LinkState | undefined;
  /** A settings event named this adapter since its last step: unparks it and skips a pending backoff. */
  settingsChanged = false;
  /** Clock times of recent failures, pruned to the park window. */
  recentFailures: number[] = [];
  readonly counts: AdapterCounts = { starts: 0, failures: 0, faults: 0, servedErrors: 0, stopTimeouts: 0 };
  readonly busCounters = new ScopeCounters();
  /** Bumped on every start, so a fault reported by an earlier run is recognised and ignored. */
  epoch = 0;
  pendingFault: string | undefined;
  abort: AbortController | undefined;
  scope: ScopedBus | undefined;
  retryTimer: TimerHandle | undefined;
  busy = false;
  again = false;
  idle: Promise<void> = Promise.resolve();

  constructor(
    readonly id: AdapterId,
    readonly adapter: Adapter,
    readonly backoff: Backoff,
    now: number
  ) {
    this.changedAt = now;
  }
}

type Bounded = { kind: "done" } | { kind: "failed"; error: unknown } | { kind: "timeout" };

/**
 * Runs each adapter while its link says it should. A reconciler: every pass
 * compares what is desired with what is running and makes one move, and
 * passes for one adapter never overlap, so an adapter is never started twice
 * or stopped mid-start. A failure leaves it degraded and retried with capped
 * backoff; too many failures in the park window leave it parked until a
 * settings event names it.
 */
export class Supervisor {
  private readonly slots = new Map<AdapterId, Slot>();
  private readonly listeners = new Set<StatusListener>();
  private shuttingDown = false;

  constructor(
    adapters: ReadonlyMap<AdapterId, Adapter>,
    private readonly config: SupervisorConfig,
    private readonly deps: SupervisorDeps
  ) {
    if (!(Number.isInteger(config.park.afterFailures) && config.park.afterFailures > 0)) {
      throw new Error(`park.afterFailures must be a whole number above 0, got ${config.park.afterFailures}`);
    }
    for (const [id, adapter] of adapters) {
      this.slots.set(id, new Slot(id, adapter, createBackoff(config.backoff, deps.random), deps.clock.now()));
    }
  }

  get adapterIds(): AdapterId[] {
    return [...this.slots.keys()];
  }

  /**
   * Applies new link states. `changed` names the adapters a settings event was
   * about. Adapters missing from `links` keep their last state. Resolves once
   * every adapter touched has settled.
   */
  reconcile(links: ReadonlyMap<AdapterId, LinkState>, changed: ReadonlySet<AdapterId>): Promise<void> {
    const settling: Promise<void>[] = [];
    for (const [id, link] of links) {
      const slot = this.slots.get(id);
      if (slot === undefined) {
        continue;
      }
      slot.link = link;
      if (changed.has(id)) {
        slot.settingsChanged = true;
      }
      if (!this.desired(slot)) {
        // A start in progress gives up now instead of finishing first.
        slot.abort?.abort();
      }
      settling.push(this.kick(slot));
    }
    return Promise.all(settling).then(() => undefined);
  }

  status(id: AdapterId): AdapterStatus {
    return this.slot(id).status;
  }

  /** Calls `listener` after every status change; returns the unsubscribe. */
  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The link state the last reconcile applied, or null before the first read. */
  link(id: AdapterId): LinkState | null {
    return this.slot(id).link ?? null;
  }

  /** Resolves once no adapter has a pass running. Retries waiting on backoff timers do not count. */
  async whenIdle(): Promise<void> {
    await Promise.all([...this.slots.values()].map((slot) => slot.idle));
  }

  recordServedError(id: AdapterId): void {
    this.slot(id).counts.servedErrors++;
  }

  report(): AdapterReport[] {
    return [...this.slots.values()].map((slot) => ({
      id: slot.id,
      status: slot.status,
      changedAt: slot.changedAt,
      link: slot.link ?? null,
      counts: { ...slot.counts },
      bus: slot.busCounters.snapshot(),
    }));
  }

  /** Stops every adapter in parallel, each under the stop deadline. Nothing starts afterwards. */
  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(
      [...this.slots.values()].map((slot) => {
        slot.abort?.abort();
        return this.kick(slot);
      })
    );
  }

  private slot(id: AdapterId): Slot {
    const slot = this.slots.get(id);
    if (slot === undefined) {
      throw new Error(`no adapter "${id}" is loaded`);
    }
    return slot;
  }

  private desired(slot: Slot): boolean {
    return !this.shuttingDown && slot.link !== undefined && slot.adapter.desired(slot.link);
  }

  private kick(slot: Slot): Promise<void> {
    if (slot.busy) {
      slot.again = true;
      return slot.idle;
    }
    slot.busy = true;
    slot.idle = (async () => {
      try {
        do {
          slot.again = false;
          try {
            await this.step(slot);
          } catch (error) {
            this.deps.logger.error("supervisor step failed", { adapter: slot.id, error: errorMessage(error) });
          }
        } while (slot.again);
      } finally {
        slot.busy = false;
      }
    })();
    return slot.idle;
  }

  private async step(slot: Slot): Promise<void> {
    const settingsChanged = slot.settingsChanged;
    slot.settingsChanged = false;
    const fault = slot.pendingFault;
    slot.pendingFault = undefined;
    const state = slot.status.state;

    if (state === "connected" && fault !== undefined) {
      slot.counts.faults++;
      await this.fail(slot, fault);
      slot.again = true;
      return;
    }

    if (!this.desired(slot)) {
      if (state === "connected") {
        await this.stop(slot, "no longer desired");
        return;
      }
      if (state === "degraded" || state === "parked") {
        this.clearRetry(slot);
        this.setStatus(slot, { state: "stopped" });
      }
      return;
    }

    switch (slot.status.state) {
      case "stopped":
        await this.start(slot);
        return;
      case "degraded":
        if (settingsChanged || this.deps.clock.now() >= slot.status.retryAt) {
          await this.start(slot);
        }
        return;
      case "parked":
        if (settingsChanged) {
          this.deps.logger.info("adapter unparked by a settings change", { adapter: slot.id });
          slot.recentFailures = [];
          slot.backoff.reset();
          await this.start(slot);
        }
        return;
      case "connected":
      case "starting":
      case "stopping":
        return;
    }
  }

  private async start(slot: Slot): Promise<void> {
    this.clearRetry(slot);
    slot.epoch++;
    const epoch = slot.epoch;
    const abort = new AbortController();
    const scope = new ScopedBus({
      scope: slot.id,
      client: this.deps.bus,
      grants: slot.adapter.manifest,
      limits: this.config.subscriptionLimits,
      logger: this.deps.logger,
      counters: slot.busCounters,
    });
    slot.abort = abort;
    slot.scope = scope;
    slot.counts.starts++;
    this.setStatus(slot, { state: "starting" });

    const ctx: AdapterContext = {
      logger: this.deps.logger.child({ adapter: slot.id }),
      bus: scope,
      dbProxyUrl: this.deps.dbProxyUrl,
      reportFault: (reason) => this.fault(slot, epoch, reason),
    };
    const started = await this.settleStart(slot, ctx, abort.signal);
    if (abort.signal.aborted) {
      if (started.kind === "timeout") {
        slot.counts.stopTimeouts++;
        this.deps.logger.error("adapter start ignored its abort past the stop deadline; stopping it anyway", {
          adapter: slot.id,
          stopDeadlineMs: this.config.stopDeadlineMs,
        });
      }
      await this.stop(slot, "stopped while starting");
      return;
    }
    if (started.kind === "failed") {
      await this.fail(slot, errorMessage(started.error));
      return;
    }
    slot.backoff.reset();
    this.setStatus(slot, { state: "connected", since: this.deps.clock.now() });
  }

  private async stop(slot: Slot, reason: string): Promise<void> {
    this.setStatus(slot, { state: "stopping" });
    await this.release(slot, reason);
    this.setStatus(slot, { state: "stopped" });
  }

  private async fail(slot: Slot, reason: string): Promise<void> {
    slot.counts.failures++;
    this.deps.logger.warn("adapter failed", { adapter: slot.id, reason });
    this.setStatus(slot, { state: "stopping" });
    await this.release(slot, `failed: ${reason}`);

    const now = this.deps.clock.now();
    slot.recentFailures = slot.recentFailures.filter((at) => now - at < this.config.park.windowMs);
    slot.recentFailures.push(now);
    if (slot.recentFailures.length >= this.config.park.afterFailures) {
      this.deps.logger.error("adapter parked until its settings change", {
        adapter: slot.id,
        reason,
        failures: slot.recentFailures.length,
        windowMs: this.config.park.windowMs,
      });
      this.setStatus(slot, { state: "parked", reason });
      return;
    }
    const delay = slot.backoff.next();
    this.setStatus(slot, { state: "degraded", reason, retryAt: now + delay });
    slot.retryTimer = this.deps.timers.setTimeout(() => {
      slot.retryTimer = undefined;
      void this.kick(slot);
    }, delay);
  }

  /** Aborts, stops and closes the adapter's bus scope, each bounded by the stop deadline. */
  private async release(slot: Slot, reason: string): Promise<void> {
    slot.abort?.abort();
    slot.abort = undefined;
    const scope = slot.scope;
    slot.scope = undefined;

    const stopped = await this.bounded(() => slot.adapter.stop(reason));
    this.logBounded(slot, "stop", stopped);
    if (scope !== undefined) {
      const closed = await this.bounded(() => scope.closeAll());
      this.logBounded(slot, "bus close", closed);
    }
  }

  private fault(slot: Slot, epoch: number, reason: string): void {
    if (epoch !== slot.epoch || slot.abort === undefined) {
      this.deps.logger.debug("ignoring a fault from a stopped run", { adapter: slot.id, reason });
      return;
    }
    slot.pendingFault = reason;
    void this.kick(slot);
  }

  /**
   * Waits for `start` to settle. A start runs as long as it needs while it is
   * wanted; once aborted it gets the stop deadline to give up, so a start
   * that ignores its signal cannot hold the adapter's passes forever.
   */
  private settleStart(slot: Slot, ctx: AdapterContext, signal: AbortSignal): Promise<Bounded> {
    return new Promise<Bounded>((resolve) => {
      let timer: TimerHandle | undefined;
      const onAbort = () => {
        timer = this.deps.timers.setTimeout(() => resolve({ kind: "timeout" }), this.config.stopDeadlineMs);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const settle = (outcome: Bounded) => {
        signal.removeEventListener("abort", onAbort);
        if (timer !== undefined) {
          this.deps.timers.clearTimeout(timer);
        }
        resolve(outcome);
      };
      let starting: Promise<void>;
      try {
        starting = slot.adapter.start(ctx, signal);
      } catch (error) {
        starting = Promise.reject(error);
      }
      starting.then(
        () => settle({ kind: "done" }),
        (error: unknown) => settle({ kind: "failed", error })
      );
    });
  }

  private bounded(work: () => Promise<void>): Promise<Bounded> {
    return new Promise<Bounded>((resolve) => {
      const timer = this.deps.timers.setTimeout(() => resolve({ kind: "timeout" }), this.config.stopDeadlineMs);
      let running: Promise<void>;
      try {
        running = work();
      } catch (error) {
        running = Promise.reject(error);
      }
      running.then(
        () => {
          this.deps.timers.clearTimeout(timer);
          resolve({ kind: "done" });
        },
        (error: unknown) => {
          this.deps.timers.clearTimeout(timer);
          resolve({ kind: "failed", error });
        }
      );
    });
  }

  private logBounded(slot: Slot, what: string, outcome: Bounded): void {
    if (outcome.kind === "timeout") {
      slot.counts.stopTimeouts++;
      this.deps.logger.error(`adapter ${what} did not finish within the stop deadline; marking it stopped`, {
        adapter: slot.id,
        stopDeadlineMs: this.config.stopDeadlineMs,
      });
    } else if (outcome.kind === "failed") {
      this.deps.logger.error(`adapter ${what} failed`, { adapter: slot.id, error: errorMessage(outcome.error) });
    }
  }

  private clearRetry(slot: Slot): void {
    if (slot.retryTimer !== undefined) {
      this.deps.timers.clearTimeout(slot.retryTimer);
      slot.retryTimer = undefined;
    }
  }

  private setStatus(slot: Slot, status: AdapterStatus): void {
    slot.status = status;
    slot.changedAt = this.deps.clock.now();
    for (const listener of this.listeners) {
      try {
        listener(slot.id, status);
      } catch (error) {
        this.deps.logger.error("status listener failed", { adapter: slot.id, error: errorMessage(error) });
      }
    }
  }
}
