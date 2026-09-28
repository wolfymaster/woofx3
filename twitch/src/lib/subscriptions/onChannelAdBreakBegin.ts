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

/** The fields of Twurple's begin event this service reads. */
export type AdBreakBeginInput = Pick<EventSubChannelAdBreakBeginEvent, "durationSeconds" | "isAutomatic" | "startDate">;

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
 */
export class AdBreakAnnouncer {
  private pending: { handle: unknown; publishEnd: () => void } | null = null;

  constructor(
    private ctx: Context,
    private timers: AdBreakTimers = REAL_TIMERS
  ) {}

  begin(event: AdBreakBeginInput): void {
    this.flushPendingEnd();

    const durationSeconds = event.durationSeconds;
    const startedAtMs = event.startDate.getTime();
    const startedAt = event.startDate.toISOString();
    const endedAt = new Date(startedAtMs + durationSeconds * 1000).toISOString();

    const [topic, data] = this.ctx.events.Twitch().adBreakBegin({
      durationSeconds,
      isAutomatic: event.isAutomatic,
      startedAt,
      endsAt: endedAt,
    });
    this.ctx.messageBus.publish(topic, data);

    const publishEnd = () => {
      this.pending = null;
      const [endTopic, endData] = this.ctx.events.Twitch().adBreakEnd({
        durationSeconds,
        isAutomatic: event.isAutomatic,
        startedAt,
        endedAt,
      });
      this.ctx.messageBus.publish(endTopic, endData);
    };
    const handle = this.timers.setTimeout(publishEnd, Math.max(0, durationSeconds * 1000));
    this.pending = { handle, publishEnd };
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

export default function onChannelAdBreakBegin(ctx: Context, listener: EventSubWsListener): EventSubSubscription {
  const announcer = new AdBreakAnnouncer(ctx);
  return listener.onChannelAdBreakBegin(ctx.broadcaster.id, (event: EventSubChannelAdBreakBeginEvent) => {
    announcer.begin(event);
  });
}
