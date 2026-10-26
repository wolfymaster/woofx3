import { describe, expect, test } from "bun:test";
import type { AdBreakUpcoming } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import { TWITCH_DEFAULTS } from "../../../config/twitch";
import type { Clock, TimerHandle, Timers } from "../../../host/deps";
import { halfRandom } from "../../../host/testing";
import { AdBreakScheduler, type AdBreakSchedulerOptions } from "./adBreakScheduler";
import { type AdSchedule, TwitchApiError } from "./twitch";

const OPTIONS: AdBreakSchedulerOptions = {
  pollIntervalMs: TWITCH_DEFAULTS.adSchedulePollIntervalMs,
  readTimeoutMs: TWITCH_DEFAULTS.adScheduleReadTimeoutMs,
  missingScopeBackoffMs: TWITCH_DEFAULTS.adScheduleMissingScopeBackoffMs,
  unauthorizedBackoffMs: TWITCH_DEFAULTS.adScheduleUnauthorizedBackoffMs,
  rateLimitBackoff: TWITCH_DEFAULTS.adScheduleRateLimitBackoff,
};

/** Timers fire only when a test advances time past them. */
class FakeClock implements Clock, Timers {
  private timers: { at: number; fn: () => void; cleared: boolean }[] = [];

  constructor(private nowMs: number) {}

  now(): number {
    return this.nowMs;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer = { at: this.nowMs + ms, fn, cleared: false };
    this.timers.push(timer);
    return timer;
  }

  /** Cancels every timer set so far. */
  cancelAll(): void {
    for (const timer of this.timers) {
      timer.cleared = true;
    }
  }

  clearTimeout(handle: TimerHandle): void {
    (handle as { cleared: boolean }).cleared = true;
  }

  setInterval(): TimerHandle {
    throw new Error("the scheduler chains timeouts; it never sets an interval");
  }

  clearInterval(): void {
    throw new Error("the scheduler chains timeouts; it never sets an interval");
  }

  /** Like advance, but lets each fired async callback settle before the next. */
  async advanceAsync(ms: number): Promise<void> {
    const until = this.nowMs + ms;
    for (;;) {
      const due = this.timers.filter((t) => !t.cleared && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      due.cleared = true;
      this.nowMs = due.at;
      due.fn();
      await Bun.sleep(0);
    }
    this.nowMs = until;
  }

  /** Moves time forward, firing lead timers due on the way. The poll timer is
   *  driven by calling pollOnce directly, so it is never fired here. */
  advance(ms: number): void {
    const until = this.nowMs + ms;
    for (;;) {
      const due = this.timers.filter((t) => !t.cleared && t.at <= until && t.at > 0).sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      due.cleared = true;
      this.nowMs = due.at;
      due.fn();
    }
    this.nowMs = until;
  }
}

const T0 = Date.parse("2026-09-28T18:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const silentLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as SharedLogger;

function schedule(nextAdAtMs: number | null): AdSchedule {
  return {
    nextAdAt: nextAdAtMs === null ? null : iso(nextAdAtMs),
    lastAdAt: null,
    durationSeconds: 90,
    prerollFreeSeconds: 0,
    snoozeCount: 3,
    snoozeRefreshAt: null,
    serverNow: iso(T0),
  };
}

function harness(opts: { leadSeconds?: number; live?: boolean } = {}) {
  const clock = new FakeClock(T0);
  const published: AdBreakUpcoming[] = [];
  const warnings: Record<string, unknown>[] = [];
  const state = {
    live: opts.live ?? true,
    fetches: 0,
    leadSeconds: opts.leadSeconds ?? 60,
    next: schedule(T0 + 5 * 60_000) as AdSchedule | Error,
  };
  const scheduler = new AdBreakScheduler({
    fetchSchedule: async () => {
      state.fetches += 1;
      if (state.next instanceof Error) {
        throw state.next;
      }
      return state.next;
    },
    publishUpcoming: (event) => published.push(event),
    logger: { ...silentLogger, warn: (_msg: string, meta: Record<string, unknown>) => warnings.push(meta) } as never,
    readLeadSeconds: async () => state.leadSeconds,
    clock,
    timers: clock,
    random: halfRandom,
    options: OPTIONS,
  });
  // Live, with its own poll loop cancelled: the tests drive polls through
  // pollOnce.
  if (state.live) {
    scheduler.setLive(true);
  }
  clock.cancelAll();
  return { clock, published, warnings, state, scheduler };
}

describe("AdBreakScheduler", () => {
  test("announces the next ad once, the lead time ahead", async () => {
    const { clock, published, scheduler } = harness();

    await scheduler.pollOnce();
    clock.advance(3 * 60_000);
    expect(published).toEqual([]);

    clock.advance(60_000);
    expect(published).toEqual([{ nextAdAt: iso(T0 + 5 * 60_000), secondsUntil: 60, durationSeconds: 90 }]);

    // A later read of the same schedule must not announce it again.
    await scheduler.pollOnce();
    clock.advance(30_000);
    expect(published).toHaveLength(1);
  });

  test("a changed lead time applies at the next read", async () => {
    const { clock, published, state, scheduler } = harness();

    await scheduler.pollOnce();
    state.leadSeconds = 180;
    await scheduler.pollOnce();
    clock.advance(2 * 60_000);

    expect(published).toEqual([{ nextAdAt: iso(T0 + 5 * 60_000), secondsUntil: 180, durationSeconds: 90 }]);
  });

  test("raising the lead time after an announcement does not announce the ad again", async () => {
    const { clock, published, state, scheduler } = harness();

    await scheduler.pollOnce();
    clock.advance(4 * 60_000);
    expect(published).toHaveLength(1);

    state.leadSeconds = 120;
    await scheduler.pollOnce();
    clock.advance(30_000);
    expect(published).toHaveLength(1);
  });

  test("an ad first seen inside its lead window is announced once, right away", async () => {
    const { published, state, scheduler } = harness({ leadSeconds: 120 });
    state.next = schedule(T0 + 40_000);

    await scheduler.pollOnce();

    expect(published).toEqual([{ nextAdAt: iso(T0 + 40_000), secondsUntil: 40, durationSeconds: 90 }]);
  });

  test("a snooze moves the announcement to the new time", async () => {
    const { clock, published, state, scheduler } = harness();

    await scheduler.pollOnce();
    clock.advance(60_000);
    state.next = schedule(T0 + 10 * 60_000);
    await scheduler.pollOnce();
    clock.advance(4 * 60_000);
    expect(published).toEqual([]);

    clock.advance(5 * 60_000);
    expect(published).toEqual([{ nextAdAt: iso(T0 + 10 * 60_000), secondsUntil: 60, durationSeconds: 90 }]);
  });

  test("does not ask Twitch while offline, and drops armed announcements", async () => {
    const { clock, published, state, scheduler } = harness();

    await scheduler.pollOnce();
    scheduler.setLive(false);
    await scheduler.pollOnce();
    clock.advance(10 * 60_000);

    expect(state.fetches).toBe(1);
    expect(published).toEqual([]);
  });

  test("nothing is announced when Twitch has no ad scheduled", async () => {
    const { clock, published, state, scheduler } = harness();
    state.next = schedule(null);

    await scheduler.pollOnce();
    clock.advance(10 * 60_000);

    expect(published).toEqual([]);
  });

  test("backs off after a missing scope and warns once", async () => {
    const { clock, state, warnings, scheduler } = harness();
    state.next = new TwitchApiError("missing_scope", "reconnect Twitch to allow ad controls");

    await scheduler.pollOnce();
    clock.advance(60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(1);

    clock.advance(15 * 60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("missing_scope");
  });

  test("rate limits back off with jitter, doubling, and reset on success", async () => {
    // halfRandom draws half of each ceiling: 1 minute of the first 2, then 2 of 4.
    const { clock, state, scheduler } = harness();
    state.next = new TwitchApiError("rate_limited", "429");

    await scheduler.pollOnce();
    clock.advance(60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(2);

    // Second refusal in a row: two minutes, not one.
    clock.advance(60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(2);
    clock.advance(60_000);
    state.next = schedule(T0 + 60 * 60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(3);

    // A success resets the ceiling: the next refusal waits one minute again.
    state.next = new TwitchApiError("rate_limited", "429");
    await scheduler.pollOnce();
    expect(state.fetches).toBe(4);
    clock.advance(60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(5);
  });

  test("a stopped scheduler announces nothing, even from a poll already in flight", async () => {
    const { clock, published, scheduler } = harness();

    await scheduler.pollOnce();
    scheduler.stop();
    await scheduler.pollOnce();
    scheduler.setLive(true);
    clock.advance(10 * 60_000);

    expect(published).toEqual([]);
  });

  test("going live starts polling at once and every minute after; offline stops it", async () => {
    const clock = new FakeClock(T0);
    let fetches = 0;
    const scheduler = new AdBreakScheduler({
      fetchSchedule: async () => {
        fetches += 1;
        return schedule(null);
      },
      publishUpcoming: () => {},
      logger: silentLogger,
      readLeadSeconds: async () => 60,
      clock,
      timers: clock,
      random: halfRandom,
      options: OPTIONS,
    });

    clock.advance(5 * 60_000);
    expect(fetches).toBe(0);

    scheduler.setLive(true);
    await clock.advanceAsync(0);
    expect(fetches).toBe(1);
    await clock.advanceAsync(60_000);
    expect(fetches).toBe(2);

    scheduler.setLive(false);
    await clock.advanceAsync(10 * 60_000);
    expect(fetches).toBe(2);
  });

  test("a schedule read that never settles fails at its deadline and the next poll still runs", async () => {
    const clock = new FakeClock(T0);
    const warnings: Record<string, unknown>[] = [];
    let fetches = 0;
    const scheduler = new AdBreakScheduler({
      fetchSchedule: () => {
        fetches += 1;
        return fetches === 1 ? new Promise<AdSchedule>(() => {}) : Promise.resolve(schedule(null));
      },
      publishUpcoming: () => {},
      logger: { ...silentLogger, warn: (_msg: string, meta: Record<string, unknown>) => warnings.push(meta) } as never,
      readLeadSeconds: async () => 60,
      clock,
      timers: clock,
      random: halfRandom,
      options: OPTIONS,
    });

    scheduler.setLive(true);
    await clock.advanceAsync(OPTIONS.readTimeoutMs);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "failed" });

    await clock.advanceAsync(OPTIONS.pollIntervalMs);
    expect(fetches).toBe(2);
  });

  test("a read timeout that is not below the poll interval is refused", () => {
    const clock = new FakeClock(T0);
    for (const readTimeoutMs of [0, OPTIONS.pollIntervalMs]) {
      expect(
        () =>
          new AdBreakScheduler({
            fetchSchedule: async () => schedule(null),
            publishUpcoming: () => {},
            logger: silentLogger,
            readLeadSeconds: async () => 60,
            clock,
            timers: clock,
            random: halfRandom,
            options: { ...OPTIONS, readTimeoutMs },
          })
      ).toThrow("readTimeoutMs");
    }
  });

  test("the live state read at connect applies until an EventSub event arrives", async () => {
    const seeded = harness({ live: false });
    seeded.scheduler.seedLive(true);
    seeded.clock.cancelAll();
    await seeded.scheduler.pollOnce();
    expect(seeded.state.fetches).toBe(1);

    const raced = harness({ live: true });
    raced.scheduler.seedLive(false);
    await raced.scheduler.pollOnce();
    expect(raced.state.fetches).toBe(1);
  });

  test("a lead time that is not positive whole seconds fails the poll and arms nothing", async () => {
    for (const leadSeconds of [0, -5, 1.5]) {
      const { clock, published, scheduler } = harness({ leadSeconds });
      await expect(scheduler.pollOnce()).rejects.toThrow("positive whole seconds");
      clock.advance(5 * 60_000);
      expect(published).toEqual([]);
    }
  });
});
