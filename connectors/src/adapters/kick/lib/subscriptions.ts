import { type Backoff, createBackoff } from "@woofx3/common/runtime/backoff";
import { errorMessage, type Logger, type RandomSource, type TimerHandle, type Timers } from "../../../host/deps";
import { describeKickFailure, type KickApi, type KickEventName, type KickSubscription } from "./kick-api";

/** The Kick events the adapter subscribes to, each mapped in ./events.ts. */
export const KICK_SUBSCRIBED_EVENTS: readonly KickEventName[] = [
  { name: "chat.message.sent", version: 1 },
  { name: "channel.followed", version: 1 },
  { name: "channel.subscription.new", version: 1 },
  { name: "channel.subscription.renewal", version: 1 },
  { name: "channel.subscription.gifts", version: 1 },
  { name: "channel.reward.redemption.updated", version: 1 },
  { name: "livestream.status.updated", version: 1 },
  { name: "kicks.gifted", version: 1 },
];

/** Where one subscribed event stands after the last pass that reached Kick. */
export type SubscriptionState = { state: "subscribed" } | { state: "failed"; reason: string };

export interface SubscriptionReconcilerConfig {
  intervalMs: number;
  backoff: { baseMs: number; maxMs: number };
}

export interface SubscriptionReconcilerDeps {
  api: Pick<KickApi, "subscriptions" | "subscribe" | "unsubscribe">;
  timers: Timers;
  random: RandomSource;
  logger: Logger;
  config: SubscriptionReconcilerConfig;
}

/**
 * Keeps the adapter's Kick event subscriptions in place. Kick unsubscribes
 * an app from an event after about a day of failed deliveries and never
 * says so, so every pass lists what exists, creates what is missing and
 * deletes duplicates of the same event and version, keeping the oldest. A
 * pass runs at start, on `reconcileNow` (after a relink), and every
 * `intervalMs`; a pass that could not reach Kick retries with a capped,
 * jittered backoff that resets once a pass succeeds.
 */
export class SubscriptionReconciler {
  private readonly backoff: Backoff;
  private timer: TimerHandle | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private readonly states = new Map<string, SubscriptionState>();
  private lastError: string | null = null;

  constructor(private readonly deps: SubscriptionReconcilerDeps) {
    this.backoff = createBackoff(deps.config.backoff, deps.random);
  }

  /** Runs the first pass and schedules the next; resolves once the first pass settled. */
  async start(): Promise<void> {
    if (!this.stopped) {
      throw new Error("the Kick subscription reconciler is already running");
    }
    this.stopped = false;
    await this.reconcileNow();
  }

  /** Cancels the next pass and waits for one in flight. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimer();
    await this.running;
  }

  /** Runs a pass now (or joins the one in flight) and reschedules the next. */
  async reconcileNow(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running === undefined) {
      this.clearTimer();
      this.running = this.pass().finally(() => {
        this.running = undefined;
      });
    }
    await this.running;
  }

  /** Per event `name@version`, for /health. */
  detail(): { events: Record<string, SubscriptionState>; lastError: string | null } {
    return { events: Object.fromEntries(this.states), lastError: this.lastError };
  }

  private async pass(): Promise<void> {
    let delay: number;
    try {
      const failure = await this.reconcile();
      if (failure === null) {
        this.lastError = null;
        this.backoff.reset();
        delay = this.deps.config.intervalMs;
      } else {
        this.lastError = failure;
        delay = this.backoff.next();
        this.deps.logger.warn("kick: event subscriptions could not be checked; retrying", { err: failure, delay });
      }
    } catch (err) {
      this.lastError = errorMessage(err);
      delay = this.backoff.next();
      this.deps.logger.error("kick: event subscription pass failed; retrying", { err: this.lastError, delay });
    }
    if (!this.stopped) {
      this.timer = this.deps.timers.setTimeout(() => {
        this.timer = undefined;
        void this.reconcileNow();
      }, delay);
    }
  }

  /** One pass; the reason it could not reach Kick, or null when it did. */
  private async reconcile(): Promise<string | null> {
    const listed = await this.deps.api.subscriptions();
    if (!listed.ok) {
      return describeKickFailure(listed.error);
    }
    const byKey = new Map<string, KickSubscription[]>();
    for (const subscription of listed.value) {
      const key = eventKey(subscription.event, subscription.version);
      byKey.set(key, [...(byKey.get(key) ?? []), subscription]);
    }

    const duplicates: string[] = [];
    for (const subscriptions of byKey.values()) {
      const [, ...extra] = [...subscriptions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      duplicates.push(...extra.map((s) => s.id));
    }
    if (duplicates.length > 0) {
      const removed = await this.deps.api.unsubscribe(duplicates);
      if (!removed.ok) {
        this.deps.logger.warn("kick: could not remove duplicate event subscriptions", {
          err: describeKickFailure(removed.error),
        });
      }
    }

    const missing = KICK_SUBSCRIBED_EVENTS.filter((event) => !byKey.has(eventKey(event.name, event.version)));
    for (const event of KICK_SUBSCRIBED_EVENTS) {
      if (byKey.has(eventKey(event.name, event.version))) {
        this.states.set(eventKey(event.name, event.version), { state: "subscribed" });
      }
    }
    if (missing.length === 0) {
      return null;
    }
    const created = await this.deps.api.subscribe(missing);
    if (!created.ok) {
      for (const event of missing) {
        this.states.set(eventKey(event.name, event.version), {
          state: "failed",
          reason: describeKickFailure(created.error),
        });
      }
      return describeKickFailure(created.error);
    }
    for (const event of missing) {
      const key = eventKey(event.name, event.version);
      const outcome = created.value.find((o) => o.name === event.name && o.version === event.version);
      if (outcome?.subscriptionId != null && outcome.error == null) {
        this.states.set(key, { state: "subscribed" });
        continue;
      }
      const reason = outcome?.error ?? "Kick did not answer for this event";
      this.states.set(key, { state: "failed", reason });
      this.deps.logger.warn("kick: Kick refused an event subscription", { event: key, reason });
    }
    return null;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      this.deps.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

function eventKey(name: string, version: number): string {
  return `${name}@${version}`;
}
