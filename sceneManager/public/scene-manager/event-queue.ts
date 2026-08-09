// Client-side, per-widget-instance dispatch policy — the direct
// replacement for streamware's server-side `EventQueueManager`,
// generalized from "one alert at a time, app-wide" to "one queue per
// registered widget instance, configured by that widget." This is
// distinct from `delivery-store.ts` on the backend: that guarantees
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

import type { EventQueueConfig } from "@woofx3/module-sdk";
import { evaluateExpression } from "./resolver";

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

const DEFAULT_MAX_IN_FLIGHT = 1;

interface PendingItem extends QueuedEvent {
  priority: number;
}

class InstanceQueue {
  private readonly pending: PendingItem[] = [];
  private readonly inFlight = new Map<string, ReturnType<typeof setTimeout> | null>();

  constructor(
    private readonly config: EventQueueConfig,
    private readonly deliver: DeliverFn,
    private readonly onTimeout: TimeoutFn
  ) {}

  enqueue(item: QueuedEvent): void {
    const priority = this.priorityOf(item);
    const entry: PendingItem = { ...item, priority };
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
    this.pump();
  }

  /** Widget acked completion (or the shim auto-completed). Idempotent
   *  — a duplicate/late ack for an item no longer in flight is a
   *  no-op. */
  complete(eventId: string): void {
    const timer = this.inFlight.get(eventId);
    if (timer) {
      clearTimeout(timer);
    }
    if (this.inFlight.delete(eventId)) {
      this.pump();
    }
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
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (this.config.retryTimeoutMs) {
        timer = setTimeout(() => {
          this.inFlight.delete(item.eventId);
          this.onTimeout(item.eventId);
          this.pump();
        }, this.config.retryTimeoutMs);
      }
      this.inFlight.set(item.eventId, timer);
    }
  }
}

/**
 * Owns one `InstanceQueue` per registered widget instance. `subId` is
 * the P1 subscription id the shim assigned — kept distinct from
 * `instanceId` because a widget could (in principle) open more than
 * one event subscription; today's callers use exactly one per
 * instance, but the manager doesn't assume that.
 */
export class EventQueueManager {
  private readonly queues = new Map<string, InstanceQueue>();
  private readonly subToInstance = new Map<string, string>();

  register(subId: string, instanceId: string, config: EventQueueConfig | undefined, deliver: DeliverFn, onTimeout: TimeoutFn): void {
    this.subToInstance.set(subId, instanceId);
    this.queues.set(instanceId, new InstanceQueue(config ?? {}, deliver, onTimeout));
  }

  unregister(subId: string): void {
    const instanceId = this.subToInstance.get(subId);
    this.subToInstance.delete(subId);
    if (instanceId) {
      this.queues.delete(instanceId);
    }
  }

  /** Route an SSE delivery to the target instance's queue, if one is registered. */
  enqueue(instanceId: string, item: QueuedEvent): boolean {
    const queue = this.queues.get(instanceId);
    if (!queue) {
      return false;
    }
    queue.enqueue(item);
    return true;
  }

  /** Widget completion, routed by the P1 subId the shim echoed back. */
  complete(subId: string, eventId: string): void {
    const instanceId = this.subToInstance.get(subId);
    if (!instanceId) {
      return;
    }
    this.queues.get(instanceId)?.complete(eventId);
  }
}
