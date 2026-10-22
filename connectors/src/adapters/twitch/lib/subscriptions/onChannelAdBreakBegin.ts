import type { EventSubChannelAdBreakBeginEvent, EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";

export interface AdBreakTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: AdBreakTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The fields of Twurple's begin event this service reads. Twurple passes
 * Twitch's raw values through its getters, so they are typed loosely here
 * and coerced in `begin`.
 */
export interface AdBreakBeginInput {
  durationSeconds: unknown;
  isAutomatic: unknown;
  startDate: Date;
}

/**
 * Publishes `channel.ad_break.begin` when a break starts, and
 * `channel.ad_break.end` when it is due to finish.
 *
 * Twitch has no ad-break-end EventSub topic, so the end event is synthesized
 * from the begin event's duration. A workflow that switches to an "ad" scene
 * on begin needs something to switch back on, and a timer here is the only
 * source for it. Only one break can run at a time, so a begin that arrives
 * while an end is still pending publishes that end at once rather than
 * dropping it.
 *
 * EventSub delivers at least once, so a begin with the same start time as
 * the pending break is a redelivery and is ignored.
 */
export class AdBreakAnnouncer {
  private pending: { handle: unknown; publishEnd: () => void; startedAt: string } | null = null;

  constructor(
    private ctx: Context,
    private timers: AdBreakTimers = REAL_TIMERS
  ) {}

  begin(event: AdBreakBeginInput): void {
    const durationSeconds = Math.max(0, Math.trunc(Number(event.durationSeconds) || 0));
    const isAutomatic = event.isAutomatic === true || event.isAutomatic === "true";
    let startedAtMs = event.startDate.getTime();
    if (Number.isNaN(startedAtMs)) {
      startedAtMs = Date.now();
      this.ctx.logger.warn("twitch: ad break begin had an unreadable started_at; using the time it arrived");
    }
    const startedAt = new Date(startedAtMs).toISOString();
    if (this.pending?.startedAt === startedAt) {
      return;
    }
    this.flushPendingEnd();
    const endedAt = new Date(startedAtMs + durationSeconds * 1000).toISOString();

    const [topic, data] = this.ctx.events.Twitch().adBreakBegin({
      durationSeconds,
      isAutomatic,
      startedAt,
      endsAt: endedAt,
    });
    this.ctx.messageBus.publish(topic, data);

    const publishEnd = () => {
      this.pending = null;
      const [endTopic, endData] = this.ctx.events.Twitch().adBreakEnd({
        durationSeconds,
        isAutomatic,
        startedAt,
        endedAt,
      });
      this.ctx.messageBus.publish(endTopic, endData);
    };
    const handle = this.timers.setTimeout(publishEnd, Math.max(0, durationSeconds * 1000));
    this.pending = { handle, publishEnd, startedAt };
  }

  /**
   * Drop a pending end without publishing it, for when the service is
   * disconnecting and its bus is going away with it.
   */
  dispose(): void {
    if (this.pending !== null) {
      this.timers.clearTimeout(this.pending.handle);
      this.pending = null;
    }
  }

  private flushPendingEnd(): void {
    if (this.pending === null) {
      return;
    }
    const { handle, publishEnd } = this.pending;
    this.timers.clearTimeout(handle);
    publishEnd();
  }
}

export default function onChannelAdBreakBegin(
  ctx: Context,
  listener: EventSubWsListener,
  announcer: AdBreakAnnouncer
): EventSubSubscription {
  return listener.onChannelAdBreakBegin(ctx.broadcaster.id, (event: EventSubChannelAdBreakBeginEvent) => {
    announcer.begin(event);
  });
}
