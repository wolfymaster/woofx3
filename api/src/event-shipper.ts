import type { EventsTarget } from "@woofx3/api";
import type { CallbackEnvelope } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import { type Backoff, createBackoff, type RandomSource } from "@woofx3/common/runtime";

export interface EventShipperConfig {
  /** Envelopes held per target; past it the oldest is dropped. */
  maxBuffered: number;
  /** Envelopes per POST. */
  maxPostEvents: number;
  /** Per POST, response included. */
  timeoutMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** How long `stop` waits for buffered envelopes to be delivered. */
  drainTimeoutMs: number;
}

/** Waits `ms`, or less when `signal` aborts first. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

export interface EventShipperDeps {
  logger: SharedLogger;
  config: EventShipperConfig;
  random: RandomSource;
  sleep: Sleep;
  fetch: typeof fetch;
}

type PostOutcome = "delivered" | "dropped" | "retry";

interface Lane {
  target: EventsTarget;
  buffer: CallbackEnvelope[];
  backoff: Backoff;
  pumping: Promise<void> | null;
  /** Envelopes dropped for a full buffer since the last delivery. */
  dropped: number;
}

/**
 * Ships envelopes to events targets in batches: `{ events: [...] }` POSTed
 * with `Authorization: Bearer <token>`. Each target has its own FIFO with one
 * POST in flight, so envelopes reach it in the order they were shipped.
 *
 * A 5xx, 408, 429 or network failure retries the same batch after a capped,
 * jittered backoff that resets on success. A 401 or 403 means the target was
 * revoked, and any other 4xx means the batch was refused: both drop the batch
 * with an error. A retry never ends on its own, so the buffer cap is what
 * bounds memory while a target is down.
 */
export class EventShipper {
  private readonly lanes = new Map<string, Lane>();
  private readonly abort = new AbortController();
  private running = false;

  constructor(private readonly deps: EventShipperDeps) {
    const { config } = deps;
    if (!(config.maxBuffered >= config.maxPostEvents && config.maxPostEvents >= 1)) {
      throw new Error(
        `EventShipper needs maxBuffered >= maxPostEvents >= 1, got ${config.maxBuffered} and ${config.maxPostEvents}`
      );
    }
  }

  start(): void {
    this.running = true;
  }

  /** Queues `envelope` for `target`. Never throws and never waits. */
  ship(target: EventsTarget, envelope: CallbackEnvelope): void {
    if (!this.running) {
      this.deps.logger.error("EventShipper: dropped an event shipped while stopped", {
        eventType: envelope.type,
        envelopeId: envelope.id,
      });
      return;
    }
    const lane = this.lane(target);
    lane.buffer.push(envelope);
    this.trim(lane);
    if (lane.pumping === null) {
      lane.pumping = this.pump(lane);
    }
  }

  /**
   * Stops taking envelopes, waits up to `drainTimeoutMs` for the buffered ones
   * to be delivered, then abandons the rest with an error naming the count.
   */
  async stop(): Promise<void> {
    this.running = false;
    const pumping = [...this.lanes.values()].flatMap((lane) => (lane.pumping ? [lane.pumping] : []));
    const drainTimeout = new AbortController();
    await Promise.race([
      Promise.all(pumping).then(() => drainTimeout.abort()),
      this.deps.sleep(this.deps.config.drainTimeoutMs, drainTimeout.signal),
    ]);
    this.abort.abort();
    drainTimeout.abort();
    await Promise.all(pumping);
    const abandoned = [...this.lanes.values()].reduce((sum, lane) => sum + lane.buffer.length, 0);
    if (abandoned > 0) {
      this.deps.logger.error("EventShipper: stopped with events undelivered", { abandoned });
    }
  }

  private lane(target: EventsTarget): Lane {
    const key = `${target.url}\n${target.token}`;
    let lane = this.lanes.get(key);
    if (!lane) {
      const { backoffBaseMs: baseMs, backoffMaxMs: maxMs } = this.deps.config;
      lane = {
        target,
        buffer: [],
        backoff: createBackoff({ baseMs, maxMs }, this.deps.random),
        pumping: null,
        dropped: 0,
      };
      this.lanes.set(key, lane);
    }
    return lane;
  }

  /** Drops the oldest envelopes past `maxBuffered`, logging the first drop of each run of them. */
  private trim(lane: Lane): void {
    const excess = lane.buffer.length - this.deps.config.maxBuffered;
    if (excess <= 0) {
      return;
    }
    lane.buffer.splice(0, excess);
    if (lane.dropped === 0) {
      this.deps.logger.error("EventShipper: buffer full, dropping the oldest events", {
        url: lane.target.url,
        maxBuffered: this.deps.config.maxBuffered,
      });
    }
    lane.dropped += excess;
  }

  private async pump(lane: Lane): Promise<void> {
    while (lane.buffer.length > 0 && !this.abort.signal.aborted) {
      const batch = lane.buffer.splice(0, this.deps.config.maxPostEvents);
      const outcome = await this.post(lane.target, batch);
      if (outcome === "retry") {
        // Back in front, so order holds; the oldest go first if that overfills.
        lane.buffer.unshift(...batch);
        this.trim(lane);
        await this.deps.sleep(lane.backoff.next(), this.abort.signal);
        continue;
      }
      lane.backoff.reset();
      if (lane.dropped > 0) {
        this.deps.logger.error("EventShipper: events were dropped while the buffer was full", {
          url: lane.target.url,
          dropped: lane.dropped,
        });
        lane.dropped = 0;
      }
    }
    lane.pumping = null;
  }

  private async post(target: EventsTarget, events: CallbackEnvelope[]): Promise<PostOutcome> {
    const { logger, config } = this.deps;
    let status: number;
    try {
      const response = await this.deps.fetch(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` },
        body: JSON.stringify({ events }),
        redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(config.timeoutMs), this.abort.signal]),
      });
      status = response.status;
      await response.body?.cancel();
    } catch (err) {
      logger.warn("EventShipper: POST failed, retrying", {
        url: target.url,
        events: events.length,
        error: err instanceof Error ? err.message : String(err),
      });
      return "retry";
    }
    if (status >= 200 && status < 300) {
      return "delivered";
    }
    if (status === 408 || status === 429 || status >= 500) {
      logger.warn("EventShipper: target unavailable, retrying", { url: target.url, status, events: events.length });
      return "retry";
    }
    logger.error(
      status === 401 || status === 403
        ? "EventShipper: target refused the token, dropping events"
        : "EventShipper: target refused the events, dropping them",
      { url: target.url, status, events: events.length, envelopeIds: events.map((e) => e.id) }
    );
    return "dropped";
  }
}
