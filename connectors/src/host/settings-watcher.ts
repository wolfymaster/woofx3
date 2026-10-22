import {
  INTEGRATION_ENABLED_UPDATED_SUBJECT,
  INTEGRATION_TOKEN_UPDATED_SUBJECT,
  type IntegrationEnabled,
  type IntegrationId,
  isIntegrationId,
} from "@woofx3/common/integrations/integration-settings";
import type { AdapterId } from "./adapter-ids";
import { bounded } from "./bounded";
import { type Clock, errorMessage, type Logger, type TimerHandle, type Timers } from "./deps";
import type { LinkReaderRegistry, LinkState, SettingsReader } from "./link-readers";
import type { BusMessage, ScopedBus } from "./scoped-bus";

/** The settings events the watcher reacts to. The host scope must be allowed to subscribe to both. */
export const SETTINGS_SUBJECTS = [INTEGRATION_ENABLED_UPDATED_SUBJECT, INTEGRATION_TOKEN_UPDATED_SUBJECT] as const;

/** Where new link states go: the supervisor. */
export interface LinkSink {
  reconcile(links: ReadonlyMap<AdapterId, LinkState>, changed: ReadonlySet<AdapterId>): Promise<void>;
}

export interface SettingsWatcherDeps {
  adapters: readonly AdapterId[];
  readers: LinkReaderRegistry;
  settings: SettingsReader;
  sink: LinkSink;
  scope: ScopedBus;
  clock: Clock;
  timers: Timers;
  logger: Logger;
  reconcileIntervalMs: number;
  /** One adapter's link read may take this long before the pass gives up on it and keeps its last state. */
  readTimeoutMs: number;
}

/** One pass waiting to run: which adapters to read, and which of them a settings event named. */
interface PendingPass {
  read: Set<AdapterId>;
  changed: Set<AdapterId>;
}

/**
 * Keeps the supervisor fed with each adapter's link state. It reads every
 * link at start, again for the adapters a settings event names, and all of
 * them on the backstop interval in case an event was missed. Passes run one
 * at a time and later requests merge into the next one, so an older read
 * never lands after a newer one.
 */
export class SettingsWatcher {
  private pending: PendingPass | undefined;
  private running: Promise<void> | undefined;
  private backstop: TimerHandle | undefined;
  private stopped = false;
  private lastPassAt: number | undefined;
  /** The flag reading already logged per adapter, so a missing or bad flag is logged once, not every pass. */
  private readonly flagLogged = new Map<AdapterId, string>();

  constructor(private readonly deps: SettingsWatcherDeps) {}

  /** Subscribes to the settings events, runs the first pass and arms the backstop. */
  async start(): Promise<void> {
    for (const subject of SETTINGS_SUBJECTS) {
      await this.deps.scope.subscribe(subject, (msg) => this.onSettingsEvent(msg));
    }
    this.backstop = this.deps.timers.setInterval(() => {
      this.request(this.deps.adapters, []);
    }, this.deps.reconcileIntervalMs);
    this.request(this.deps.adapters, []);
    await this.idle();
  }

  /**
   * Stops the backstop and lets the pass in flight finish, which takes at
   * most readTimeoutMs. The host scope's close drops the subscriptions.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.pending = undefined;
    if (this.backstop !== undefined) {
      this.deps.timers.clearInterval(this.backstop);
      this.backstop = undefined;
    }
    await this.idle();
  }

  /** Clock time the last pass finished, for /health. */
  get lastPass(): number | undefined {
    return this.lastPassAt;
  }

  /** Resolves once no pass is running or waiting. */
  async idle(): Promise<void> {
    while (this.running !== undefined) {
      await this.running;
    }
  }

  private onSettingsEvent(msg: BusMessage): void {
    const integration = integrationOf(msg.data);
    if (integration === undefined) {
      this.deps.logger.warn("settings event without a known integration; ignored", { subject: msg.subject });
      return;
    }
    const named = this.deps.adapters.filter((id) => this.deps.readers[id].watches.includes(integration));
    if (named.length > 0) {
      this.request(named, named);
    }
  }

  private request(read: readonly AdapterId[], changed: readonly AdapterId[]): void {
    // A pass with nothing to read still runs: it is what shows /health the loop is alive.
    if (this.stopped) {
      return;
    }
    this.pending ??= { read: new Set(), changed: new Set() };
    for (const id of read) {
      this.pending.read.add(id);
    }
    for (const id of changed) {
      this.pending.changed.add(id);
    }
    if (this.running === undefined) {
      this.running = this.drain().finally(() => {
        this.running = undefined;
      });
    }
  }

  private async drain(): Promise<void> {
    while (this.pending !== undefined) {
      const pass = this.pending;
      this.pending = undefined;
      await this.runPass(pass);
    }
  }

  private async runPass(pass: PendingPass): Promise<void> {
    const links = new Map<AdapterId, LinkState>();
    await Promise.all(
      [...pass.read].map(async (id) => {
        const outcome = await bounded(
          () => this.deps.readers[id].read(this.deps.settings),
          this.deps.readTimeoutMs,
          this.deps.timers
        );
        // An adapter left out of `links` keeps the supervisor on the last state it was given.
        switch (outcome.kind) {
          case "done":
            this.logFlag(id, outcome.value.flag);
            links.set(id, { connected: outcome.value.connected, enabled: outcome.value.enabled });
            return;
          case "failed":
            this.deps.logger.warn("could not read link state; keeping the last one", {
              adapter: id,
              error: errorMessage(outcome.error),
            });
            return;
          case "timeout":
            this.deps.logger.warn("link state read timed out; keeping the last one", {
              adapter: id,
              readTimeoutMs: this.deps.readTimeoutMs,
            });
            return;
        }
      })
    );
    this.lastPassAt = this.deps.clock.now();
    if (links.size === 0) {
      return;
    }
    const changed = new Set([...pass.changed].filter((id) => links.has(id)));
    // Not awaited: an adapter slow to start must not hold up the next read.
    this.deps.sink.reconcile(links, changed).catch((error: unknown) => {
      this.deps.logger.error("reconcile failed", { error: errorMessage(error) });
    });
  }

  private logFlag(id: AdapterId, flag: IntegrationEnabled): void {
    const seen = flag.kind === "invalid" ? `invalid:${flag.raw}` : flag.kind;
    if (this.flagLogged.get(id) === seen) {
      return;
    }
    this.flagLogged.set(id, seen);
    if (flag.kind === "absent") {
      this.deps.logger.info("no enabled setting stored; enabled follows connected", { adapter: id });
    } else if (flag.kind === "invalid") {
      this.deps.logger.warn("enabled setting is neither true nor false; enabled follows connected", {
        adapter: id,
        value: flag.raw,
      });
    }
  }
}

const decoder = new TextDecoder();

/**
 * Both settings events are CloudEvents (the api's publishEvent) whose `data`
 * carries `{integration}`. Anything else is not an event this watcher acts on.
 */
function integrationOf(data: Uint8Array): IntegrationId | undefined {
  let event: unknown;
  try {
    event = JSON.parse(decoder.decode(data));
  } catch {
    // A body that is not JSON names no integration; the caller logs it.
    return undefined;
  }
  if (!isRecord(event) || !isRecord(event.data)) {
    return undefined;
  }
  const integration = event.data.integration;
  return isIntegrationId(integration) ? integration : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
