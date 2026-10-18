import { parseDataShape } from "@woofx3/api/ui-schema";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import type { Trigger } from "@woofx3/db/module_trigger.pb";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { DbClient } from "./db-client";

/** Where an event's data names the viewer it is about, from its trigger's `emits`. */
export interface ViewerIdentity {
  /** Dot path of the viewer's id. */
  path: string;
  /** Dot path of a boolean that is true when the platform withheld the identity. */
  anonymousWhen?: string;
  /** Dot path of the viewer's display name. */
  displayName?: string;
}

/** One subject the event log may record, and what its registered triggers say about it. */
export interface LoggedEvent {
  subject: string;
  /** The module that registered it, the `created_by_ref` of its trigger. */
  moduleId: string;
  /** True when any of its triggers is alert-worthy; see `isDefaultTaxonomy`. */
  onByDefault: boolean;
  /** Absent when its triggers mark no single viewer, or disagree on where it is. */
  identity?: ViewerIdentity;
}

export type EventCatalogListener = (events: ReadonlyMap<string, LoggedEvent>) => Promise<void> | void;

/**
 * Every registration and deregistration of a trigger, by any module. A module
 * install registers each of its triggers separately, so these arrive in bursts.
 */
const TRIGGER_CHANGE_SUBJECT = "db.module.trigger.>";

const EVENTBUS_TRANSPORT = "eventbus";

const SHARED_CHAT_PREFIX = "channel.shared";

/**
 * Subjects never offered, whatever their triggers say. Chat is the engine's
 * one high-volume subject and has its own channel. The shared-chat events
 * happened in another channel during a shared chat session, and would read as
 * this channel's subs and raids. Must match `EventLogSettings.offered` in
 * shared/clients/typescript/api/stream-events.ts.
 */
function isExcludedSubject(subject: string): boolean {
  return subject === EventType.ChatMessage || subject.startsWith(SHARED_CHAT_PREFIX);
}

/**
 * Taxonomy roots under `alert` that are not on by default: chat alerts fire
 * per message, and shared-chat alerts are about another channel.
 */
const NOT_DEFAULT_ALERT_ROOTS: readonly string[] = ["alert.chat", "alert.shared"];

/**
 * Whether a trigger taxonomy entry makes its event on by default: an `alert.*`
 * entry, the same set the dashboard's Alerts menu offers, except the
 * `NOT_DEFAULT_ALERT_ROOTS` and anything under them.
 */
export function isDefaultTaxonomy(entry: string): boolean {
  if (!entry.startsWith("alert.")) {
    return false;
  }
  return !NOT_DEFAULT_ALERT_ROOTS.some((root) => entry === root || entry.startsWith(`${root}.`));
}

/** NATS wildcard tokens. */
const WILDCARD = /(^|\.)(\*|>)(\.|$)/;

/**
 * The events the engine may log and push to browsers: every subject an active
 * `eventbus` trigger fires on, except
 *
 * - a wildcard pattern, which names a family of subjects (`chat.command.*`)
 *   rather than one event, and could reach subjects no module declared;
 * - an `isExcludedSubject`.
 *
 * These are the types the streamer may select (`EventLogSettings.offered`);
 * `EventLogSelectionSource` narrows them to what is logged and shown.
 *
 * Exported for tests.
 */
export function buildEventCatalog(triggers: readonly Trigger[]): Map<string, LoggedEvent> {
  const bySubject = new Map<string, Trigger[]>();
  for (const trigger of triggers) {
    const transport = trigger.transport === "" ? EVENTBUS_TRANSPORT : trigger.transport;
    if (transport !== EVENTBUS_TRANSPORT || trigger.event === "") {
      continue;
    }
    if (WILDCARD.test(trigger.event) || isExcludedSubject(trigger.event)) {
      continue;
    }
    const declared = bySubject.get(trigger.event);
    if (declared) {
      declared.push(trigger);
    } else {
      bySubject.set(trigger.event, [trigger]);
    }
  }

  const catalog = new Map<string, LoggedEvent>();
  for (const [subject, declared] of [...bySubject].sort(([a], [b]) => a.localeCompare(b))) {
    // Two modules may declare one subject; the pick must not depend on the
    // order the db returned them in.
    const moduleId = declared.map((trigger) => trigger.createdByRef).sort()[0] ?? "";
    const identity = agreedIdentity(declared);
    const onByDefault = declared.some((trigger) => trigger.taxonomy.some(isDefaultTaxonomy));
    catalog.set(subject, { subject, moduleId, onByDefault, ...(identity ? { identity } : {}) });
  }
  return catalog;
}

/**
 * The viewer identity every trigger of one subject declares, or undefined
 * when any of them declares none or they differ: a path that only some of
 * the subject's declarations vouch for cannot be trusted for its events.
 */
function agreedIdentity(declared: readonly Trigger[]): ViewerIdentity | undefined {
  const identities = declared.map(identityOf);
  const [first, ...rest] = identities;
  if (first === undefined) {
    return undefined;
  }
  const key = JSON.stringify(first);
  return rest.every((identity) => identity !== undefined && JSON.stringify(identity) === key) ? first : undefined;
}

/**
 * The trigger's one `string` viewer identity field. A trigger marking several,
 * or an `array` of viewers, names no single viewer to attribute its event to.
 */
function identityOf(trigger: Trigger): ViewerIdentity | undefined {
  const shape = parseDataShape(trigger.emits);
  const marked = shape?.fields.filter((field) => field.identity === "viewer") ?? [];
  const [field] = marked;
  if (marked.length !== 1 || field === undefined || field.type !== "string") {
    return undefined;
  }
  return {
    path: field.path,
    ...(field.anonymousWhen ? { anonymousWhen: field.anonymousWhen } : {}),
    ...(field.displayName ? { displayName: field.displayName } : {}),
  };
}

export interface EventCatalogOptions {
  /** How long a trigger change waits for the rest of its burst. */
  settleMs?: number;
  /** The re-read that catches a trigger change whose event never arrived. */
  intervalMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * The set of events the engine may log and push to browsers, kept current with
 * the installed triggers. `EventLogSelectionSource` narrows it to the
 * streamer's selection for the log, and `StreamEventBroadcaster` to each
 * subscriber's types.
 *
 * It re-reads the triggers on every trigger change on the bus, and on an
 * interval as the safety net against a change event that never arrived. Until
 * the first read succeeds the set is empty, and a failed read is retried with
 * backoff, so an api that starts before barkloader has registered anything,
 * or before db-proxy answers, converges once they do.
 */
export class EventCatalog {
  private current: ReadonlyMap<string, LoggedEvent> = new Map();
  private listeners: EventCatalogListener[] = [];
  private loading: Promise<void> | null = null;
  private again = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private backoffMs: number;
  private readonly settleMs: number;
  private readonly intervalMs: number;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private nats: NATSClient,
    private db: Pick<DbClient, "listTriggers">,
    private logger: SharedLogger,
    options: EventCatalogOptions = {}
  ) {
    this.settleMs = options.settleMs ?? 250;
    this.intervalMs = options.intervalMs ?? 5 * 60_000;
    this.minBackoffMs = options.minBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.backoffMs = this.minBackoffMs;
  }

  /** The current set, keyed by subject. */
  get events(): ReadonlyMap<string, LoggedEvent> {
    return this.current;
  }

  /** Called with the new set each time it changes. A listener that throws is logged and skipped. */
  onChange(listener: EventCatalogListener): void {
    this.listeners.push(listener);
  }

  /** Reads the triggers once, then follows trigger changes. */
  async start(): Promise<void> {
    await this.nats.subscribe(TRIGGER_CHANGE_SUBJECT, (_msg: Msg) => {
      this.request();
    });
    await this.reload();
    this.interval = setInterval(() => {
      this.request();
    }, this.intervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    for (const timer of [this.settleTimer, this.retryTimer]) {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
    if (this.interval !== null) {
      clearInterval(this.interval);
    }
    this.settleTimer = null;
    this.retryTimer = null;
    this.interval = null;
  }

  /** Re-read after the burst this request belongs to has settled. */
  request(): void {
    if (this.settleTimer !== null) {
      return;
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      void this.reload();
    }, this.settleMs);
    this.settleTimer.unref?.();
  }

  /**
   * Re-read the triggers now. Reads never overlap: one asked for while another
   * runs is folded into a single read after it, so the last trigger change is
   * always read.
   */
  reload(): Promise<void> {
    if (this.loading !== null) {
      this.again = true;
      return this.loading;
    }
    this.loading = (async () => {
      do {
        this.again = false;
        await this.loadOnce();
      } while (this.again);
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async loadOnce(): Promise<void> {
    let triggers: Trigger[];
    try {
      triggers = await this.db.listTriggers();
    } catch (err) {
      this.logger.warn("EventCatalog: reading triggers failed; retrying", {
        retryInMs: this.backoffMs,
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleRetry();
      return;
    }
    this.backoffMs = this.minBackoffMs;

    const next = buildEventCatalog(triggers);
    if (sameCatalog(this.current, next)) {
      return;
    }
    this.current = next;
    this.logger.info("EventCatalog: event subjects changed", { subjects: next.size });
    for (const listener of this.listeners) {
      try {
        await listener(next);
      } catch (err) {
        this.logger.error("EventCatalog: listener failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.reload();
    }, delay);
    this.retryTimer.unref?.();
  }
}

function sameCatalog(a: ReadonlyMap<string, LoggedEvent>, b: ReadonlyMap<string, LoggedEvent>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [subject, event] of a) {
    const other = b.get(subject);
    if (other === undefined || JSON.stringify(other) !== JSON.stringify(event)) {
      return false;
    }
  }
  return true;
}

/**
 * Keeps one bus subscription per subject of a changing set, each delivering
 * to `handler`. Subjects leaving the set are unsubscribed, so a module's
 * events stop being handled once its triggers are gone.
 */
export class SubjectSubscriptions {
  private bound = new Map<string, { unsubscribe(): void }>();
  /** Syncs run one at a time, so two cannot both subscribe one new subject. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private nats: NATSClient,
    private handler: (subject: string, msg: Msg) => void,
    private logger: SharedLogger,
    private owner: string
  ) {}

  get subjects(): string[] {
    return [...this.bound.keys()];
  }

  /**
   * Subscribe to every subject not yet bound and drop every bound one not in
   * `subjects`. A subscribe that fails is logged and retried by the next sync.
   */
  sync(subjects: Iterable<string>): Promise<void> {
    const wanted = new Set(subjects);
    this.queue = this.queue.then(() => this.apply(wanted));
    return this.queue;
  }

  private async apply(wanted: ReadonlySet<string>): Promise<void> {
    for (const [subject, subscription] of this.bound) {
      if (!wanted.has(subject)) {
        subscription.unsubscribe();
        this.bound.delete(subject);
      }
    }
    for (const subject of wanted) {
      if (this.bound.has(subject)) {
        continue;
      }
      try {
        const subscription = await this.nats.subscribe(subject, (msg: Msg) => {
          this.handler(subject, msg);
        });
        this.bound.set(subject, subscription);
      } catch (err) {
        this.logger.error(`${this.owner}: subscribing failed`, {
          subject,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
