// Client-side, per-widget-instance dispatch policy: one queue per
// registered widget instance, configured by that widget. This is
// distinct from the scene manager's `delivery-store.ts`: that guarantees
// the browser session eventually sees every event at least once; this
// decides which iframe gets it, in what order, and how many at once.
//
// Completion (`event.complete`) always arrives via the widget-host-
// shim regardless of a subscription's `autoComplete` setting — the
// shim auto-posts it right after the handler returns when
// `autoComplete !== false`, or waits for an explicit call otherwise.
// So this queue never needs to special-case `autoComplete` itself; it
// only needs `retryTimeoutMs` (how long to wait for that completion
// before giving up and advancing) and `maxInFlight`.

import type { EventQueueConfig, WidgetEvent } from "@woofx3/module-sdk";
import { evaluateExpression } from "./expression";
import { BROWSER_HOST, type PageTimers } from "./page-host";

export interface QueuedEvent {
  eventId: string;
  type: string;
  key: string;
  value: unknown;
}

/** Returns `true` if the item was actually handed to the widget
 *  (bridge initialized + subscription open), `false` if it should be
 *  treated as un-deliverable right now (dropped, not retried — the
 *  subscription is gone, not merely slow). */
export type DeliverFn = (item: QueuedEvent) => boolean;

/** Called once a delivery attempt times out without a completion ack
 *  (only when `retryTimeoutMs` is configured). */
export type TimeoutFn = (eventId: string) => void;

/** Called for a delivery cancelled while in flight, so its widget can stop it. */
export type CancelFn = (eventId: string) => void;

const DEFAULT_MAX_IN_FLIGHT = 1;

/**
 * How many finished event ids an instance remembers. The server sends every
 * open delivery again when the stream reconnects, and an undelivered one
 * again every few seconds (the scene manager's delivery-store.ts), so a delivery that is
 * still queued, still playing, or whose ack is in flight can arrive twice.
 * Remembering it is what keeps one alert from playing twice.
 */
const REMEMBERED_FINISHED_EVENTS = 256;

interface PendingItem extends QueuedEvent {
  priority: number;
}

/**
 * The event ids an instance has finished, oldest first, capped at
 * `REMEMBERED_FINISHED_EVENTS`. One per instance, shared by each queue the
 * instance registers, so a frame swapped in knows what its predecessor
 * finished.
 */
class FinishedEvents {
  private readonly ids = new Set<string>();

  has(eventId: string): boolean {
    return this.ids.has(eventId);
  }

  add(eventId: string): void {
    this.ids.add(eventId);
    if (this.ids.size > REMEMBERED_FINISHED_EVENTS) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) {
        this.ids.delete(oldest);
      }
    }
  }
}

class InstanceQueue {
  private readonly pending: PendingItem[] = [];
  private readonly inFlight = new Map<string, { item: PendingItem; timer: unknown }>();

  constructor(
    private readonly config: EventQueueConfig,
    private readonly finished: FinishedEvents,
    private readonly deliver: DeliverFn,
    private readonly onTimeout: TimeoutFn,
    private readonly onCancel: CancelFn,
    private readonly timers: PageTimers
  ) {}

  enqueue(item: QueuedEvent): void {
    if (
      this.inFlight.has(item.eventId) ||
      this.finished.has(item.eventId) ||
      this.pending.some((pending) => pending.eventId === item.eventId)
    ) {
      return;
    }
    this.insert({ ...item, priority: this.priorityOf(item) });
    this.pump();
  }

  /** Take over what `previous` had not dispatched; it keeps what is in flight. */
  adoptPending(previous: InstanceQueue): void {
    for (const item of previous.pending.splice(0)) {
      this.enqueue(item);
    }
  }

  /**
   * Take over what `previous` dispatched and never finished: its frame is
   * gone, so the event is handed to this one instead of being lost.
   */
  adoptUnfinished(previous: InstanceQueue): void {
    for (const { item } of previous.inFlight.values()) {
      this.enqueue(item);
    }
  }

  /** Stop every timer; the queue is no longer used. */
  dispose(): void {
    for (const { timer } of this.inFlight.values()) {
      if (timer) {
        this.timers.clearTimeout(timer);
      }
    }
    this.pending.length = 0;
  }

  private insert(entry: PendingItem): void {
    const priority = entry.priority;
    if (!this.config.priorityExpr) {
      this.pending.push(entry);
    } else {
      // Higher priority value = more urgent = dispatched first.
      let i = 0;
      while (i < this.pending.length && this.pending[i]!.priority >= priority) {
        i += 1;
      }
      this.pending.splice(i, 0, entry);
    }
  }

  /** Widget acked completion (or the shim auto-completed). Idempotent
   *  — a duplicate/late ack for an item no longer in flight is a
   *  no-op. */
  complete(eventId: string): void {
    const timer = this.inFlight.get(eventId)?.timer;
    if (timer) {
      this.timers.clearTimeout(timer);
    }
    if (this.inFlight.delete(eventId)) {
      this.finished.add(eventId);
      this.pump();
    }
  }

  /**
   * The server closed these deliveries: drop any still waiting, stop any in
   * flight, and ignore any that arrive later. A late arrival is possible
   * because the cancel and the delivery travel as separate frames.
   */
  cancel(eventIds: string[]): void {
    const cancelled = new Set(eventIds);
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (cancelled.has(this.pending[i]!.eventId)) {
        this.pending.splice(i, 1);
      }
    }
    for (const eventId of cancelled) {
      const flying = this.inFlight.get(eventId);
      if (flying) {
        if (flying.timer) {
          this.timers.clearTimeout(flying.timer);
        }
        this.inFlight.delete(eventId);
        this.onCancel(eventId);
      }
      this.finished.add(eventId);
    }
    this.pump();
  }

  /** The event ids this queue holds: waiting, or dispatched and not yet completed. */
  held(): string[] {
    return [...this.pending.map((item) => item.eventId), ...this.inFlight.keys()];
  }

  /** Number of items neither dispatched nor completed — diagnostic use. */
  size(): number {
    return this.pending.length + this.inFlight.size;
  }

  private priorityOf(item: QueuedEvent): number {
    if (!this.config.priorityExpr) {
      return 0;
    }
    const result = evaluateExpression(this.config.priorityExpr, {
      type: item.type,
      key: item.key,
      value: item.value,
    });
    return typeof result === "number" && Number.isFinite(result) ? result : 0;
  }

  private pump(): void {
    const maxInFlight = this.config.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    while (this.inFlight.size < maxInFlight && this.pending.length > 0) {
      const item = this.pending.shift()!;
      const delivered = this.deliver(item);
      if (!delivered) {
        // Subscription gone — not a transient failure worth retrying.
        continue;
      }
      let timer: unknown = null;
      if (this.config.retryTimeoutMs) {
        timer = this.timers.setTimeout(() => {
          this.inFlight.delete(item.eventId);
          this.finished.add(item.eventId);
          this.onTimeout(item.eventId);
          this.pump();
        }, this.config.retryTimeoutMs);
      }
      this.inFlight.set(item.eventId, { item, timer });
    }
  }
}

/** One queue registration: what its owner unregisters and completes through. */
export interface QueueRegistration {
  readonly instanceId: string;
}

interface Registration extends QueueRegistration {
  readonly queue: InstanceQueue;
}

/**
 * Owns the queue of each widget instance on the page. An instance has one
 * current queue; registering again (a frame swapped in for the placement's
 * old one) replaces it, and the new queue takes over everything not yet
 * dispatched. The replaced queue keeps what it has in flight until its owner
 * unregisters it, so a frame being retired finishes what it is showing, and
 * whatever it never finished is handed to the current queue then.
 */
export class EventQueueManager {
  private readonly current = new Map<string, Registration>();
  // Every registration not yet unregistered, by instance: during a frame swap
  // the replaced queue still holds what it is playing beside the current one.
  private readonly live = new Map<string, Set<Registration>>();
  private readonly finished = new Map<string, FinishedEvents>();

  /** Each queue's timeouts run on `timers`; the browser's when absent. */
  constructor(private readonly timers: PageTimers = BROWSER_HOST.timers) {}

  register(
    instanceId: string,
    config: EventQueueConfig | undefined,
    deliver: DeliverFn,
    onTimeout: TimeoutFn,
    onCancel: CancelFn = () => {}
  ): QueueRegistration {
    let finished = this.finished.get(instanceId);
    if (finished === undefined) {
      finished = new FinishedEvents();
      this.finished.set(instanceId, finished);
    }
    const queue = new InstanceQueue(config ?? {}, finished, deliver, onTimeout, onCancel, this.timers);
    const registration: Registration = { instanceId, queue };
    const previous = this.current.get(instanceId);
    this.current.set(instanceId, registration);
    let live = this.live.get(instanceId);
    if (live === undefined) {
      live = new Set();
      this.live.set(instanceId, live);
    }
    live.add(registration);
    if (previous !== undefined) {
      queue.adoptPending(previous.queue);
    }
    return registration;
  }

  /**
   * The owner is done with `registration`. When it is still the instance's
   * current queue the instance has no queue until one registers again; when
   * it was replaced, the current queue takes over what it never finished.
   */
  unregister(registration: QueueRegistration): void {
    const { instanceId, queue } = registration as Registration;
    const live = this.live.get(instanceId);
    live?.delete(registration as Registration);
    if (live?.size === 0) {
      this.live.delete(instanceId);
    }
    const current = this.current.get(instanceId);
    if (current === registration) {
      this.current.delete(instanceId);
    } else if (current !== undefined) {
      current.queue.adoptUnfinished(queue);
    }
    queue.dispose();
  }

  /**
   * Route an SSE delivery to the target instance's queue. False when the
   * instance has no queue yet, so the caller does not acknowledge it as
   * delivered and the server sends it again.
   */
  enqueue(instanceId: string, item: QueuedEvent): boolean {
    const registration = this.current.get(instanceId);
    if (!registration) {
      return false;
    }
    registration.queue.enqueue(item);
    return true;
  }

  /** Server-side cancellation of deliveries to one instance. */
  cancel(instanceId: string, eventIds: string[]): void {
    this.current.get(instanceId)?.queue.cancel(eventIds);
  }

  /**
   * A new stream's open deliveries, by instance: every event a queue holds
   * that is not among its instance's is cancelled, as a cancel frame would
   * have, since the server closed it while this page could not hear.
   */
  retainOpen(open: Readonly<Record<string, readonly string[]>>): void {
    for (const [instanceId, registrations] of this.live) {
      const keep = new Set(open[instanceId] ?? []);
      for (const { queue } of registrations) {
        const closed = queue.held().filter((eventId) => !keep.has(eventId));
        if (closed.length > 0) {
          queue.cancel(closed);
        }
      }
    }
  }

  /** The widget behind `registration` finished `eventId`. */
  complete(registration: QueueRegistration, eventId: string): void {
    (registration as Registration).queue.complete(eventId);
  }
}

/** Map a queued delivery onto the SDK's `WidgetEvent` shape. */
export function toWidgetEvent(item: QueuedEvent, nowMs: number): WidgetEvent {
  return {
    type: item.type,
    source: "scene-manager",
    time: new Date(nowMs).toISOString(),
    data: item.value,
    eventId: item.eventId,
  };
}
