import type { AdBreakUpcoming } from "@woofx3/common/cloudevents/Twitch/events";
import { type Backoff, type BackoffConfig, createBackoff } from "@woofx3/common/runtime";
import { bounded } from "../../../host/bounded";
import type { Clock, Logger, RandomSource, TimerHandle, Timers } from "../../../host/deps";
import { type AdSchedule, TwitchApiError, type TwitchApiErrorCode } from "./twitch";

/** How often the schedule is read, and how long to leave it after a refusal. See TWITCH_DEFAULTS. */
export interface AdBreakSchedulerOptions {
  pollIntervalMs: number;
  /**
   * How long one schedule read may take before it counts as a failed read.
   * Below `pollIntervalMs`, so a hung read ends before the next poll is due.
   */
  readTimeoutMs: number;
  /** A missing scope needs the streamer to relink, so it waits longest. */
  missingScopeBackoffMs: number;
  unauthorizedBackoffMs: number;
  /** Jittered and doubling on each consecutive rate limit, reset by a successful read. */
  rateLimitBackoff: BackoffConfig;
}

export interface AdBreakSchedulerDeps {
  fetchSchedule(): Promise<AdSchedule>;
  publishUpcoming(event: AdBreakUpcoming): void;
  logger: Logger;
  /**
   * Seconds before an ad to announce it, read on every poll so a changed
   * setting applies within a minute. Must resolve to positive whole seconds.
   */
  readLeadSeconds(): Promise<number>;
  clock: Clock;
  timers: Timers;
  /** Jitter for the rate-limit backoff. */
  random: RandomSource;
  options: AdBreakSchedulerOptions;
}

/**
 * Publishes `channel.ad_break.upcoming` ahead of each scheduled Twitch ad, so
 * a workflow can warn chat or switch scenes before the break rather than
 * after it starts. Twitch has no EventSub topic for this; the only source is
 * the Helix ad schedule, which has to be polled.
 *
 * Twitch is polled only while the stream is live. The owner reports that
 * through `setLive`, from the twitch adapter's own `stream.online` /
 * `stream.offline` subscriptions plus one Helix read at connect (EventSub
 * does not replay an online event that happened before the adapter started).
 *
 * The schedule is read every poll interval and the announcement is then
 * armed as a timer, so it lands on time rather than up to an interval late.
 * Every read re-arms from scratch, so a snooze (which moves `nextAdAt`)
 * cancels the old announcement and schedules a new one: an announcement is
 * keyed by the ad's time, and a moved ad is a new ad.
 *
 * Which ad was announced lives in memory, so an adapter restart inside a
 * lead window announces that ad again. An engine runs one twitch adapter, so
 * no other instance announces it as well.
 */
export class AdBreakScheduler {
  private readonly clock: Clock;
  private readonly timers: Timers;
  private readonly rateLimitBackoff: Backoff;
  private pollTimer: TimerHandle | null = null;
  private leadTimer: TimerHandle | null = null;
  /** The `nextAdAt` of the ad already announced: each ad is announced once. */
  private announcedAdAt: string | null = null;
  private backoffUntil = 0;
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

  constructor(private readonly deps: AdBreakSchedulerDeps) {
    const { readTimeoutMs, pollIntervalMs } = deps.options;
    if (readTimeoutMs <= 0 || readTimeoutMs >= pollIntervalMs) {
      throw new Error(
        `AdBreakScheduler: readTimeoutMs (${readTimeoutMs}) must be positive and below pollIntervalMs (${pollIntervalMs})`
      );
    }
    this.clock = deps.clock;
    this.timers = deps.timers;
    this.rateLimitBackoff = createBackoff(deps.options.rateLimitBackoff, deps.random);
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
      this.timers.clearTimeout(this.pollTimer);
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
    this.pollTimer = this.timers.setTimeout(async () => {
      this.pollTimer = null;
      try {
        await this.pollOnce();
      } catch (err) {
        this.deps.logger.error("AdBreakScheduler: poll failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.schedulePoll(this.deps.options.pollIntervalMs, epoch);
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

    // A read that never settles would otherwise hold the poll chain, and
    // with it every later heads-up, for the rest of the stream.
    const read = await bounded(() => this.deps.fetchSchedule(), this.deps.options.readTimeoutMs, this.timers);
    if (read.kind === "timeout") {
      this.recordFailure(new Error(`ad schedule read took longer than ${this.deps.options.readTimeoutMs}ms`));
      return;
    }
    if (read.kind === "failed") {
      this.recordFailure(read.error);
      return;
    }
    const schedule = read.value;
    if (this.lastFailureCode !== null) {
      this.deps.logger.info("AdBreakScheduler: ad schedule readable again");
    }
    this.lastFailureCode = null;
    this.rateLimitBackoff.reset();
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
    this.leadTimer = this.timers.setTimeout(() => {
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
        backoffMs = this.rateLimitBackoff.next();
        break;
      }
      case "missing_scope": {
        backoffMs = this.deps.options.missingScopeBackoffMs;
        break;
      }
      case "unauthorized": {
        backoffMs = this.deps.options.unauthorizedBackoffMs;
        break;
      }
      case "invalid_arguments":
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
      this.timers.clearTimeout(this.leadTimer);
      this.leadTimer = null;
    }
  }
}
