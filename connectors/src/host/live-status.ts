import Event from "@woofx3/common/cloudevents/BaseEvent";
import { EventType, type StreamStatusObserved } from "@woofx3/common/cloudevents/StreamStatus/events";
import { encode } from "@woofx3/common/cloudevents/utils";
import { type BackoffConfig, createBackoff } from "@woofx3/common/runtime";
import type { AdapterId } from "./adapter-ids";
import { errorMessage, type Logger, type RandomSource, type Timers } from "./deps";

/** How long a failed read of the live state waits before trying again. */
export const LIVE_STATUS_READ_RETRY: BackoffConfig = { baseMs: 5_000, maxMs: 5 * 60_000 };

/** What a platform adapter tells the host about its stream. */
export interface LiveStatusHandle {
  /** Forgets what is known, for a connection that may now be a different account. */
  reset(): void;
  /**
   * Reads the state once, retrying a failure until it succeeds or `signal`
   * aborts, and publishes it. Call it after subscribing to the platform's
   * events, so a change during the read is not missed. An event that arrives
   * first wins, since the read may have been answered before it.
   */
  seed(read: (signal: AbortSignal) => Promise<StreamStatusObserved>, signal: AbortSignal): Promise<void>;
  /** The platform said the stream changed. Publishes nothing: `stream.online` already told everyone. */
  changed(status: StreamStatusObserved): void;
}

export interface LiveStatusDeps {
  publish(subject: string, data: Uint8Array): Promise<void>;
  random: RandomSource;
  timers: Timers;
  logger: Logger;
}

/** One adapter run's knowledge of its stream. Null `status` means unknown, which never reads as offline. */
interface LiveEntry {
  status: StreamStatusObserved | null;
  fromEvent: boolean;
  /** Bumped by reset, so a read started for an earlier connection stops. */
  generation: number;
}

/**
 * Each platform's live state, held by the host so that no platform needs its own
 * way of being asked. An adapter that never seeds simply has nothing to report.
 *
 * Together with the engine's request this makes startup order irrelevant: the
 * request covers an engine that came up after the read, and the publish after
 * the read covers an engine that came up first.
 */
export class LiveStatusBoard {
  private readonly entries = new Map<AdapterId, LiveEntry>();

  constructor(private readonly deps: LiveStatusDeps) {}

  /** Begins an adapter run. Its handle does nothing once `clear` ends the run. */
  forAdapter(id: AdapterId): LiveStatusHandle {
    const entry: LiveEntry = { status: null, fromEvent: false, generation: 0 };
    this.entries.set(id, entry);
    const current = () => this.entries.get(id) === entry;
    return {
      reset: () => {
        entry.status = null;
        entry.fromEvent = false;
        entry.generation++;
      },
      seed: (read, signal) => this.seed(id, entry, current, read, signal),
      changed: (status) => {
        entry.status = status;
        entry.fromEvent = true;
      },
    };
  }

  /** The adapter stopped, so nothing is known about its stream until it connects again. */
  clear(id: AdapterId): void {
    this.entries.delete(id);
  }

  /** Answers a request: publishes each state that is known. */
  async publishKnown(): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.status !== null) {
        await this.publish(id, entry.status);
      }
    }
  }

  private async seed(
    id: AdapterId,
    entry: LiveEntry,
    current: () => boolean,
    read: (signal: AbortSignal) => Promise<StreamStatusObserved>,
    signal: AbortSignal
  ): Promise<void> {
    const generation = entry.generation;
    const live = () => !signal.aborted && current() && entry.generation === generation;
    const backoff = createBackoff(LIVE_STATUS_READ_RETRY, this.deps.random);
    while (live()) {
      try {
        const status = await read(signal);
        if (!live() || entry.fromEvent) {
          return;
        }
        entry.status = status;
        await this.publish(id, status);
        return;
      } catch (err) {
        if (!live()) {
          return;
        }
        this.deps.logger.warn("could not read whether the stream is live; trying again", {
          adapter: id,
          err: errorMessage(err),
        });
      }
      await this.wait(backoff.next(), signal);
    }
  }

  /** A failed publish is logged and not retried: the engine's request at its next start asks again. */
  private async publish(id: AdapterId, status: StreamStatusObserved): Promise<void> {
    const event = Event<StreamStatusObserved>(
      { type: EventType.StreamStatusObserved, source: "connectors", platform: id },
      status
    );
    try {
      await this.deps.publish(EventType.StreamStatusObserved, encode(event));
    } catch (err) {
      this.deps.logger.warn("could not publish the stream's live state", { adapter: id, err: errorMessage(err) });
    }
  }

  private wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        this.deps.timers.clearTimeout(timer);
        resolve();
      };
      const timer = this.deps.timers.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
