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
import type { LinkReaderRegistry, LinkReading, LinkState, LinkStore } from "./link-readers";
import type { BusMessage, ScopedBus } from "./scoped-bus";

/** The integration settings events the watcher reacts to, routed by the integration they name. */
export const SETTINGS_SUBJECTS = [INTEGRATION_ENABLED_UPDATED_SUBJECT, INTEGRATION_TOKEN_UPDATED_SUBJECT] as const;

/** Every subject the watcher subscribes to: the settings events, then each reader's own events once each. */
export function watchedSubjects(readers: LinkReaderRegistry): string[] {
  return [...SETTINGS_SUBJECTS, ...readerEventSubjects(readers)];
}

/**
 * The readers' own events, once each. A reader names a settings event through
 * `watches`, never `events`: that event is routed by the integration it names.
 */
function readerEventSubjects(readers: LinkReaderRegistry): string[] {
  const subjects = new Set<string>();
  for (const reader of Object.values(readers)) {
    for (const subject of reader.events) {
      if (SETTINGS_SUBJECTS.some((settings) => settings === subject)) {
        throw new Error(
          `a link reader lists the settings event "${subject}" in events; name its integration in watches`
        );
      }
      subjects.add(subject);
    }
  }
  return [...subjects];
}

/** Where new link states go: the supervisor. */
export interface LinkSink {
  reconcile(links: ReadonlyMap<AdapterId, LinkState>, changed: ReadonlySet<AdapterId>): Promise<void>;
}

export interface SettingsWatcherDeps {
  adapters: readonly AdapterId[];
  readers: LinkReaderRegistry;
  store: LinkStore;
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
 * link at start, again for the adapters a settings event names or whose
 * reader lists the event's subject, and all of them on the backstop interval
 * in case an event was missed. Passes run one
 * at a time and later requests merge into the next one, so an older read
 * never lands after a newer one.
 */
export class SettingsWatcher {
  private pending: PendingPass | undefined;
  private running: Promise<void> | undefined;
  private backstop: TimerHandle | undefined;
  private stopped = false;
  private lastPassAt: number | undefined;
  /** Passes in a row in which every link read failed or timed out; any read that succeeds resets it. */
  private failedPasses = 0;
  /** The flag reading already logged per adapter, so a missing or bad flag is logged once, not every pass. */
  private readonly flagLogged = new Map<AdapterId, string>();
  /** The ignored records each adapter's last reading named, so each is logged once while it stays. */
  private readonly ignoredLogged = new Map<AdapterId, ReadonlySet<string>>();

  constructor(private readonly deps: SettingsWatcherDeps) {}

  /** Subscribes to the settings and reader events, runs the first pass and arms the backstop. */
  async start(): Promise<void> {
    for (const subject of SETTINGS_SUBJECTS) {
      await this.deps.scope.subscribe(subject, (msg) => this.onSettingsEvent(msg));
    }
    for (const subject of readerEventSubjects(this.deps.readers)) {
      const named = this.deps.adapters.filter((id) => this.deps.readers[id].events.includes(subject));
      if (named.length > 0) {
        await this.deps.scope.subscribe(subject, () => this.request(named, named));
      }
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

  /**
   * Passes in a row that read at least one link and got none back, for
   * /health. Every read goes through db-proxy, so a run of them means db-proxy
   * is not answering even when the loop itself is alive.
   */
  get consecutiveFailedPasses(): number {
    return this.failedPasses;
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
          () => this.deps.readers[id].read(this.deps.store),
          this.deps.readTimeoutMs,
          this.deps.timers
        );
        // An adapter left out of `links` keeps the supervisor on the last state it was given.
        switch (outcome.kind) {
          case "done":
            this.logFlag(id, outcome.value.flag);
            this.logIgnored(id, outcome.value);
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
    // A pass that read nothing says nothing about db-proxy, so it leaves the count alone.
    if (pass.read.size > 0) {
      this.failedPasses = links.size === 0 ? this.failedPasses + 1 : 0;
    }
    if (links.size === 0) {
      return;
    }
    const changed = new Set([...pass.changed].filter((id) => links.has(id)));
    // Not awaited: an adapter slow to start must not hold up the next read.
    this.deps.sink.reconcile(links, changed).catch((error: unknown) => {
      this.deps.logger.error("reconcile failed", { error: errorMessage(error) });
    });
  }

  private logIgnored(id: AdapterId, reading: LinkReading): void {
    const seen = this.ignoredLogged.get(id);
    for (const record of reading.ignored) {
      if (seen?.has(record) !== true) {
        this.deps.logger.warn("link read ignored a stored record", { adapter: id, record });
      }
    }
    this.ignoredLogged.set(id, new Set(reading.ignored));
  }

  private logFlag(id: AdapterId, flag: IntegrationEnabled | null): void {
    if (flag === null) {
      return;
    }
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
