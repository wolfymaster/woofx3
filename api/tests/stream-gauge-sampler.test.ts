import { describe, expect, mock, test } from "bun:test";
import { DbError } from "../src/db-client";
import {
  msUntilNextTick,
  rateLimitWait,
  type SamplerClock,
  StreamGaugeSampler,
  toRequest,
} from "../src/stream-gauge-sampler";
import type { HelixGauges, HelixRead, SubscriptionTotals } from "../src/twitch-helix-gauges";

const MINUTE = Date.UTC(2026, 8, 27, 20, 5, 0);

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function value<T>(v: T): HelixRead<T> {
  return { kind: "value", value: v };
}

/** A clock whose sleep advances it, so rate-limit waits take no real time. */
function fakeClock(start: number): SamplerClock & { slept: number[] } {
  let now = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
}

/** Helix reads that return each queued result in turn, repeating the last. */
function scripted<T>(...results: HelixRead<T>[]) {
  let i = 0;
  return mock(async () => results[Math.min(i++, results.length - 1)]);
}

function setup(opts: {
  live?: boolean;
  viewers?: ReturnType<typeof scripted<number>>;
  followers?: ReturnType<typeof scripted<number>>;
  subscriptions?: ReturnType<typeof scripted<SubscriptionTotals>>;
  record?: (req: unknown) => Promise<unknown>;
}) {
  const db = {
    ensureCurrentStreamSession: mock(async () => ({ isSegmentOpen: opts.live ?? true })),
    recordStreamGaugeSample: mock(opts.record ?? (async () => ({ created: true }))),
  } as any;
  const helix: HelixGauges = {
    viewerCount: opts.viewers ?? scripted(value(12)),
    followerTotal: opts.followers ?? scripted(value(3400)),
    subscriptions: opts.subscriptions ?? scripted(value({ total: 40, points: 52 })),
  };
  const clock = fakeClock(MINUTE + 5_000);
  const logger = fakeLogger();
  const sampler = new StreamGaugeSampler(db, helix, logger, clock);
  return { sampler, db, helix, clock, logger };
}

describe("StreamGaugeSampler.sampleOnce", () => {
  test("records every metric while a segment is open", async () => {
    const { sampler, db } = setup({});
    await sampler.sampleOnce();

    expect(db.recordStreamGaugeSample).toHaveBeenCalledTimes(1);
    expect(db.recordStreamGaugeSample.mock.calls[0][0]).toEqual({
      sampledAt: { seconds: BigInt((MINUTE + 5_000) / 1000), nanos: 0 },
      viewerCount: 12n,
      followerTotal: 3400n,
      subscriberTotal: 40n,
      subscriberPoints: 52n,
    });
  });

  test("does not call Helix or record while no segment is open", async () => {
    const { sampler, db, helix } = setup({ live: false });
    await sampler.sampleOnce();

    expect(helix.viewerCount).not.toHaveBeenCalled();
    expect(db.recordStreamGaugeSample).not.toHaveBeenCalled();
  });

  test("records nothing when Helix says the stream is not live", async () => {
    const { sampler, db } = setup({ viewers: scripted<number>({ kind: "offline" }) });
    await sampler.sampleOnce();

    expect(db.recordStreamGaugeSample).not.toHaveBeenCalled();
  });

  test("leaves a failed metric out instead of recording zero", async () => {
    const { sampler, db, logger } = setup({
      followers: scripted<number>({ kind: "failed", reason: "helix 401: unauthorized" }),
    });
    await sampler.sampleOnce();

    const req = db.recordStreamGaugeSample.mock.calls[0][0];
    expect(req.followerTotal).toBeUndefined();
    expect(req.viewerCount).toBe(12n);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("records nothing, and says so, when no metric could be read", async () => {
    const failed: HelixRead<never> = { kind: "failed", reason: "no twitch_token setting" };
    const { sampler, db, logger } = setup({
      viewers: scripted<number>(failed),
      followers: scripted<number>(failed),
      subscriptions: scripted<SubscriptionTotals>(failed),
    });
    await sampler.sampleOnce();

    expect(db.recordStreamGaugeSample).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("waits out a 429 until the named reset and re-reads only what was limited", async () => {
    const resetAt = MINUTE + 5_000 + 7_000;
    const followers = scripted<number>({ kind: "rate_limited", retryAtMs: resetAt }, value(3401));
    const { sampler, db, helix, clock } = setup({ followers });
    await sampler.sampleOnce();

    expect(clock.slept).toEqual([7_000]);
    expect(followers).toHaveBeenCalledTimes(2);
    expect(helix.viewerCount).toHaveBeenCalledTimes(1);
    expect(db.recordStreamGaugeSample.mock.calls[0][0].followerTotal).toBe(3401n);
  });

  test("gives up on a metric still rate limited when the minute runs out, and records the rest", async () => {
    const followers = scripted<number>({ kind: "rate_limited", retryAtMs: null });
    const { sampler, db, clock, logger } = setup({ followers });
    await sampler.sampleOnce();

    expect(clock.slept.length).toBeGreaterThan(0);
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(45_000);
    const req = db.recordStreamGaugeSample.mock.calls[0][0];
    expect(req.followerTotal).toBeUndefined();
    expect(req.viewerCount).toBe(12n);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("treats a segment closing mid-sample as the stream going offline", async () => {
    const { sampler, logger } = setup({
      record: async () => {
        throw new DbError("recordStreamGaugeSample", "failed_precondition", "no stream segment is open");
      },
    });
    await sampler.sampleOnce();

    expect(logger.error).not.toHaveBeenCalled();
  });

  test("logs a failed write", async () => {
    const { sampler, logger } = setup({
      record: async () => {
        throw new DbError("recordStreamGaugeSample", "internal", "disk full");
      },
    });
    await sampler.sampleOnce();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("toRequest", () => {
  test("returns null when nothing was read", () => {
    const failed: HelixRead<never> = { kind: "failed", reason: "x" };
    expect(toRequest(new Date(MINUTE), { viewers: failed, followers: failed, subscriptions: failed })).toBeNull();
  });
});

describe("rateLimitWait", () => {
  test("waits until the latest named reset", () => {
    const reads: HelixRead<unknown>[] = [
      { kind: "rate_limited", retryAtMs: 10_000 },
      { kind: "rate_limited", retryAtMs: 14_000 },
    ];
    expect(rateLimitWait(reads, 9_000, 0)).toBe(5_000);
  });

  test("backs off exponentially when no reset was named", () => {
    const reads: HelixRead<unknown>[] = [{ kind: "rate_limited", retryAtMs: null }];
    expect([0, 1, 2].map((attempt) => rateLimitWait(reads, 0, attempt))).toEqual([1_000, 2_000, 4_000]);
  });

  test("never re-reads immediately after a reset already in the past", () => {
    const reads: HelixRead<unknown>[] = [{ kind: "rate_limited", retryAtMs: 1_000 }];
    expect(rateLimitWait(reads, 5_000, 0)).toBe(1_000);
  });
});

describe("msUntilNextTick", () => {
  test("ticks five seconds into the next minute", () => {
    expect(msUntilNextTick(MINUTE)).toBe(5_000);
    expect(msUntilNextTick(MINUTE + 5_000)).toBe(60_000);
    expect(msUntilNextTick(MINUTE + 30_000)).toBe(35_000);
  });
});
