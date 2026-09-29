import { describe, expect, test } from "bun:test";
import type { AdBreakUpcoming } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import { AdBreakScheduler, parseAdBreakLeadSeconds, type SchedulerClock } from "./adBreakScheduler";
import { type AdSchedule, TwitchApiError } from "./twitch";

/** Timers fire only when a test advances time past them. */
class FakeClock implements SchedulerClock {
  private timers: { at: number; fn: () => void; cleared: boolean }[] = [];

  constructor(private nowMs: number) {}

  now(): number {
    return this.nowMs;
  }

  setTimeout(fn: () => void, ms: number): unknown {
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

  clearTimeout(handle: unknown): void {
    (handle as { cleared: boolean }).cleared = true;
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

function harness(opts: { leadSeconds?: number[]; live?: boolean } = {}) {
  const clock = new FakeClock(T0);
  const published: AdBreakUpcoming[] = [];
  const warnings: Record<string, unknown>[] = [];
  const state = {
    live: opts.live ?? true,
    fetches: 0,
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
    leadSeconds: opts.leadSeconds,
    clock,
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
  test("announces the next ad once, 60 seconds ahead by default", async () => {
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

  test("fires each configured lead time", async () => {
    const { clock, published, scheduler } = harness({ leadSeconds: [120, 30] });

    await scheduler.pollOnce();
    clock.advance(5 * 60_000);

    expect(published.map((e) => e.secondsUntil)).toEqual([120, 30]);
  });

  test("an ad first seen inside its lead window is announced once, right away", async () => {
    const { published, state, scheduler } = harness({ leadSeconds: [120, 60] });
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

  test("rate limits back off exponentially and reset on success", async () => {
    const { clock, state, scheduler } = harness();
    state.next = new TwitchApiError("rate_limited", "429");

    await scheduler.pollOnce();
    clock.advance(2 * 60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(2);

    // Second refusal in a row: four minutes, not two.
    clock.advance(2 * 60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(2);
    clock.advance(2 * 60_000);
    state.next = schedule(T0 + 60 * 60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(3);

    clock.advance(60_000);
    await scheduler.pollOnce();
    expect(state.fetches).toBe(4);
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
      clock,
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

  test("rejects lead times that are not positive whole seconds", () => {
    for (const leadSeconds of [[], [0], [-5], [1.5]]) {
      expect(() => harness({ leadSeconds })).toThrow("positive whole seconds");
    }
  });
});

describe("parseAdBreakLeadSeconds", () => {
  test("defaults to one announcement a minute ahead", () => {
    expect(parseAdBreakLeadSeconds(undefined)).toEqual([60]);
    expect(parseAdBreakLeadSeconds("")).toEqual([60]);
  });

  test("reads a number or a comma-separated list", () => {
    expect(parseAdBreakLeadSeconds(90)).toEqual([90]);
    expect(parseAdBreakLeadSeconds("120, 60")).toEqual([120, 60]);
  });

  test("fails fast on anything but positive whole seconds", () => {
    for (const bad of ["abc", "0", "-30", "1.5", "60,x"]) {
      expect(() => parseAdBreakLeadSeconds(bad)).toThrow("WOOFX3_TWITCH_AD_BREAK_LEAD_SECONDS");
    }
  });
});
