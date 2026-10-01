import type { AdBreakUpcoming } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import { type AdSchedule, TwitchApiError, type TwitchApiErrorCode } from "./twitch";

const POLL_INTERVAL_MS = 60_000;

/**
 * How long to stop asking Twitch after a failure that asking again soon
 * cannot fix. A missing scope needs the streamer to relink, so it waits
 * longest; a rate limit doubles from its base on each consecutive refusal.
 */
const BACKOFF_MS: Record<Exclude<TwitchApiErrorCode, "failed">, number> = {
  missing_scope: 15 * 60_000,
  unauthorized: 5 * 60_000,
  rate_limited: 2 * 60_000,
};
const MAX_BACKOFF_MS = 30 * 60_000;

export interface SchedulerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_CLOCK: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface AdBreakSchedulerDeps {
  fetchSchedule(): Promise<AdSchedule>;
  publishUpcoming(event: AdBreakUpcoming): void;
  logger: SharedLogger;
  /**
   * Seconds before an ad to announce it, read on every poll so a changed
   * setting applies within a minute. Must resolve to positive whole seconds.
   */
  readLeadSeconds(): Promise<number>;
  clock?: SchedulerClock;
}

/**
 * Publishes `channel.ad_break.upcoming` ahead of each scheduled Twitch ad, so
 * a workflow can warn chat or switch scenes before the break rather than
 * after it starts. Twitch has no EventSub topic for this; the only source is
 * the Helix ad schedule, which has to be polled.
 *
 * Twitch is polled only while the stream is live. The owner reports that
 * through `setLive`, from this service's own `stream.online` /
 * `stream.offline` subscriptions plus one Helix read at connect (EventSub
 * does not replay an online event that happened before the service started).
 *
 * The schedule is read once a minute and the announcement is then armed as
 * a timer, so it lands on time rather than up to a minute late. Every read re-arms from scratch, so a snooze (which moves
 * `nextAdAt`) cancels the old announcement and schedules a new one: an
 * announcement is keyed by the ad's time, and a moved ad is a new ad.
 *
 * Assumes one twitch service per engine, as the engine is deployed today.
 * Which ad was announced lives in memory, so two instances would each announce
 * every ad, and a restart inside a lead window announces that ad again.
 */
export class AdBreakScheduler {
  private readonly clock: SchedulerClock;
  private pollTimer: unknown = null;
  private leadTimer: unknown = null;
  /** The `nextAdAt` of the ad already announced: each ad is announced once. */
  private announcedAdAt: string | null = null;
  private backoffUntil = 0;
  private rateLimitStreak = 0;
  private lastFailureCode: TwitchApiErrorCode | null = null;
  private live = false;
  /**
   * Bumped on every live transition. A poll chain carries the value it
   * started under and stops when it changes, so going offline and back
   * online while a read is in flight cannot leave two chains running.
   */
  private liveEpoch = 0;
  /** Whether a stream.online/offline event has set `live` yet. */
  private liveFromEvent = false;
  private stopped = false;

  constructor(private deps: AdBreakSchedulerDeps) {
    this.clock = deps.clock ?? REAL_CLOCK;
  }

  /** The stream went online or offline, as EventSub reported it. */
  setLive(live: boolean): void {
    this.liveFromEvent = true;
    this.applyLive(live);
  }

  /**
   * The live state read from Helix at connect. Ignored once an EventSub
   * event has arrived, since that read may have been answered before the
   * event and would otherwise undo it.
   */
  seedLive(live: boolean): void {
    if (this.liveFromEvent) {
      return;
    }
    this.applyLive(live);
  }

  /** Terminal: nothing is polled or announced after this. */
  stop(): void {
    this.stopped = true;
    this.applyLive(false);
  }

  private applyLive(live: boolean): void {
    if (this.stopped && live) {
      return;
    }
    if (live === this.live) {
      return;
    }
    this.live = live;
    this.liveEpoch += 1;
    if (live) {
      this.deps.logger.info("AdBreakScheduler: stream live; watching the ad schedule");
      this.schedulePoll(0, this.liveEpoch);
      return;
    }
    if (this.pollTimer !== null) {
      this.clock.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.clearLeadTimer();
    this.announcedAdAt = null;
  }

  /**
   * Chains one timeout per poll rather than an interval, so a slow read can
   * never overlap the next one.
   */
  private schedulePoll(delayMs: number, epoch: number): void {
    if (!this.live || epoch !== this.liveEpoch) {
      return;
    }
    this.pollTimer = this.clock.setTimeout(async () => {
      this.pollTimer = null;
      try {
        await this.pollOnce();
      } catch (err) {
        this.deps.logger.error("AdBreakScheduler: poll failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.schedulePoll(POLL_INTERVAL_MS, epoch);
    }, delayMs);
  }

  /** One read of the schedule, if the stream is live. Exposed for tests. */
  async pollOnce(): Promise<void> {
    if (!this.live) {
      return;
    }
    if (this.clock.now() < this.backoffUntil) {
      return;
    }

    let schedule: AdSchedule;
    try {
      schedule = await this.deps.fetchSchedule();
    } catch (err) {
      this.recordFailure(err);
      return;
    }
    if (this.lastFailureCode !== null) {
      this.deps.logger.info("AdBreakScheduler: ad schedule readable again");
    }
    this.lastFailureCode = null;
    this.rateLimitStreak = 0;
    this.backoffUntil = 0;

    const leadSeconds = await this.deps.readLeadSeconds();
    if (!Number.isInteger(leadSeconds) || leadSeconds <= 0) {
      throw new Error(`AdBreakScheduler: lead time must be positive whole seconds, got ${leadSeconds}`);
    }
    this.arm(schedule, leadSeconds);
  }

  private arm(schedule: AdSchedule, leadSeconds: number): void {
    this.clearLeadTimer();
    // The stream may have gone offline while the read was in flight.
    if (!this.live) {
      return;
    }
    if (schedule.nextAdAt === null) {
      this.announcedAdAt = null;
      return;
    }
    const nextAdAtMs = Date.parse(schedule.nextAdAt);
    if (Number.isNaN(nextAdAtMs)) {
      this.deps.logger.warn("AdBreakScheduler: unreadable nextAdAt", { nextAdAt: schedule.nextAdAt });
      return;
    }
    const nextAdAt = new Date(nextAdAtMs).toISOString();
    const now = this.clock.now();
    if (this.announcedAdAt === nextAdAt || now >= nextAdAtMs) {
      return;
    }

    // An ad scheduled, or first seen, closer than the lead time asks for is
    // announced right away with the real time left.
    const fireAtMs = nextAdAtMs - leadSeconds * 1000;
    if (fireAtMs <= now) {
      this.announceOnce(nextAdAt, nextAdAtMs, schedule.durationSeconds);
      return;
    }
    this.leadTimer = this.clock.setTimeout(() => {
      this.leadTimer = null;
      this.announceOnce(nextAdAt, nextAdAtMs, schedule.durationSeconds);
    }, fireAtMs - now);
  }

  private announceOnce(nextAdAt: string, nextAdAtMs: number, durationSeconds: number): void {
    if (this.announcedAdAt === nextAdAt) {
      return;
    }
    this.announcedAdAt = nextAdAt;
    this.announce(nextAdAt, nextAdAtMs, durationSeconds);
  }

  private announce(nextAdAt: string, nextAdAtMs: number, durationSeconds: number): void {
    if (!this.live) {
      return;
    }
    const secondsUntil = Math.max(0, Math.round((nextAdAtMs - this.clock.now()) / 1000));
    this.deps.publishUpcoming({ nextAdAt, secondsUntil, durationSeconds });
  }

  private recordFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const code: TwitchApiErrorCode = err instanceof TwitchApiError ? err.code : "failed";
    let backoffMs = 0;
    switch (code) {
      case "rate_limited": {
        backoffMs = Math.min(BACKOFF_MS.rate_limited * 2 ** this.rateLimitStreak, MAX_BACKOFF_MS);
        this.rateLimitStreak += 1;
        break;
      }
      case "missing_scope":
      case "unauthorized": {
        backoffMs = BACKOFF_MS[code];
        break;
      }
      case "failed": {
        backoffMs = 0;
        break;
      }
    }
    this.backoffUntil = this.clock.now() + backoffMs;

    // The same refusal repeats on every retry until someone acts, so it is
    // logged when it first appears rather than every poll.
    if (code !== this.lastFailureCode) {
      this.deps.logger.warn("AdBreakScheduler: could not read the ad schedule", { code, backoffMs, error: message });
    }
    this.lastFailureCode = code;
  }

  private clearLeadTimer(): void {
    if (this.leadTimer !== null) {
      this.clock.clearTimeout(this.leadTimer);
      this.leadTimer = null;
    }
  }
}
