import type { AdSchedule } from "@woofx3/api";
import type { AdBreakUpcoming } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import { TwitchCommandError, type TwitchCommandErrorCode } from "./twitch-ads";

export const DEFAULT_AD_BREAK_LEAD_SECONDS: readonly number[] = [60];

const POLL_INTERVAL_MS = 60_000;

/**
 * How long to stop asking Twitch after a failure that asking again soon
 * cannot fix. A missing scope needs the streamer to relink, so it waits
 * longest; a rate limit doubles from its base on each consecutive refusal.
 */
const BACKOFF_MS: Record<Exclude<TwitchCommandErrorCode, "failed" | "unavailable">, number> = {
  missing_scope: 15 * 60_000,
  unauthorized: 5 * 60_000,
  unlinked: 5 * 60_000,
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
  /** True while a stream segment is open; Twitch is not asked otherwise. */
  isSegmentOpen(): Promise<boolean>;
  fetchSchedule(): Promise<AdSchedule>;
  publishUpcoming(event: AdBreakUpcoming): void;
  logger: SharedLogger;
  /** Seconds before an ad to announce it; each fires at most once per ad. */
  leadSeconds?: readonly number[];
  clock?: SchedulerClock;
}

/**
 * Publishes `channel.ad_break.upcoming` ahead of each scheduled Twitch ad, so
 * a workflow can warn chat or switch scenes before the break rather than
 * after it starts. Twitch has no EventSub topic for this; the only source is
 * the ad schedule, which has to be polled.
 *
 * It lives in the api, beside StreamGaugeSampler, because the api is what
 * knows whether a stream segment is open, and Twitch is polled only then.
 * The schedule itself is read through the twitch service, which holds the
 * token and already answers `getAdSchedule` for the dashboard.
 *
 * The schedule is read once a minute; each lead time is then armed as its
 * own timer so the announcement lands on time rather than up to a minute
 * late. Every read re-arms from scratch, so a snooze (which moves
 * `nextAdAt`) cancels the old announcement and schedules a new one: an
 * announcement is keyed by the ad's time, and a moved ad is a new ad.
 *
 * Assumes one api instance per engine, as the engine is deployed today. The
 * "announced" set lives in memory, so two instances would each announce
 * every ad, and a restart inside a lead window announces that ad again.
 */
export class AdBreakScheduler {
  private readonly leadSeconds: readonly number[];
  private readonly clock: SchedulerClock;
  private pollTimer: unknown = null;
  private leadTimers: unknown[] = [];
  private announced = new Set<string>();
  private backoffUntil = 0;
  private rateLimitStreak = 0;
  private lastFailureCode: TwitchCommandErrorCode | null = null;
  private stopped = true;

  constructor(private deps: AdBreakSchedulerDeps) {
    const leads = deps.leadSeconds ?? DEFAULT_AD_BREAK_LEAD_SECONDS;
    if (leads.length === 0 || leads.some((lead) => !Number.isInteger(lead) || lead <= 0)) {
      throw new Error(`AdBreakScheduler: lead times must be positive whole seconds, got [${leads.join(", ")}]`);
    }
    this.leadSeconds = [...new Set(leads)].sort((a, b) => b - a);
    this.clock = deps.clock ?? REAL_CLOCK;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.schedulePoll(0);
    this.deps.logger.info("AdBreakScheduler started", { leadSeconds: this.leadSeconds });
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer !== null) {
      this.clock.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.clearLeadTimers();
  }

  /**
   * Chains one timeout per poll rather than an interval, so a slow read can
   * never overlap the next one.
   */
  private schedulePoll(delayMs: number): void {
    if (this.stopped) {
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
      this.schedulePoll(POLL_INTERVAL_MS);
    }, delayMs);
  }

  /** One read of the schedule, if the stream is live. Exposed for tests. */
  async pollOnce(): Promise<void> {
    let live: boolean;
    try {
      live = await this.deps.isSegmentOpen();
    } catch (err) {
      this.deps.logger.warn("AdBreakScheduler: could not read the stream session; ad schedule not checked", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!live) {
      this.clearLeadTimers();
      this.announced.clear();
      return;
    }

    const now = this.clock.now();
    if (now < this.backoffUntil) {
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

    this.arm(schedule);
  }

  private arm(schedule: AdSchedule): void {
    this.clearLeadTimers();
    if (this.stopped) {
      return;
    }
    if (schedule.nextAdAt === null) {
      this.announced.clear();
      return;
    }
    const nextAdAtMs = Date.parse(schedule.nextAdAt);
    if (Number.isNaN(nextAdAtMs)) {
      this.deps.logger.warn("AdBreakScheduler: Twitch sent an unreadable nextAdAt", { nextAdAt: schedule.nextAdAt });
      return;
    }
    const nextAdAt = new Date(nextAdAtMs).toISOString();
    for (const key of this.announced) {
      if (!key.startsWith(`${nextAdAt}|`)) {
        this.announced.delete(key);
      }
    }

    const now = this.clock.now();
    if (now >= nextAdAtMs) {
      return;
    }

    // Leads whose moment has already passed (the ad was scheduled, or first
    // seen, closer than they ask for) collapse into one announcement now,
    // rather than a burst of several for the same ad.
    const overdue = this.leadSeconds.filter(
      (lead) => nextAdAtMs - lead * 1000 <= now && !this.announced.has(keyOf(nextAdAt, lead))
    );
    if (overdue.length > 0) {
      for (const lead of overdue) {
        this.announced.add(keyOf(nextAdAt, lead));
      }
      this.announce(nextAdAt, nextAdAtMs, schedule.durationSeconds);
    }

    for (const lead of this.leadSeconds) {
      const key = keyOf(nextAdAt, lead);
      const fireAtMs = nextAdAtMs - lead * 1000;
      if (fireAtMs <= now || this.announced.has(key)) {
        continue;
      }
      const handle = this.clock.setTimeout(() => {
        if (this.announced.has(key)) {
          return;
        }
        this.announced.add(key);
        this.announce(nextAdAt, nextAdAtMs, schedule.durationSeconds);
      }, fireAtMs - now);
      this.leadTimers.push(handle);
    }
  }

  private announce(nextAdAt: string, nextAdAtMs: number, durationSeconds: number): void {
    if (this.stopped) {
      return;
    }
    const secondsUntil = Math.max(0, Math.round((nextAdAtMs - this.clock.now()) / 1000));
    this.deps.publishUpcoming({ nextAdAt, secondsUntil, durationSeconds });
  }

  private recordFailure(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const code: TwitchCommandErrorCode = err instanceof TwitchCommandError ? err.code : "failed";
    let backoffMs = 0;
    switch (code) {
      case "rate_limited": {
        backoffMs = Math.min(BACKOFF_MS.rate_limited * 2 ** this.rateLimitStreak, MAX_BACKOFF_MS);
        this.rateLimitStreak += 1;
        break;
      }
      case "missing_scope":
      case "unauthorized":
      case "unlinked": {
        backoffMs = BACKOFF_MS[code];
        break;
      }
      case "failed":
      case "unavailable": {
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

  private clearLeadTimers(): void {
    for (const handle of this.leadTimers) {
      this.clock.clearTimeout(handle);
    }
    this.leadTimers = [];
  }
}

function keyOf(nextAdAt: string, lead: number): string {
  return `${nextAdAt}|${lead}`;
}
