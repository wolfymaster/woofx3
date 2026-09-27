import type { SharedLogger } from "@woofx3/common/logging";
import type { RecordStreamGaugeSampleRequest } from "@woofx3/db/stream_gauge.pb";
import { type DbClient, DbError } from "./db-client";
import { timestampFromDate } from "./routes/helpers";
import type { HelixGauges, HelixRead, SubscriptionTotals } from "./twitch-helix-gauges";

const MINUTE_MS = 60_000;

/**
 * How far into its minute a tick runs. Clear of the boundary, so a clock that
 * is slightly behind db-proxy's does not stamp the previous minute.
 */
const TICK_OFFSET_MS = 5_000;

/**
 * How long a sample may keep waiting out Helix rate limits. Past this it is
 * recorded with whatever was read, so a sample never spills into the next
 * minute's tick.
 */
const RATE_LIMIT_BUDGET_MS = 45_000;

/** Wait before retrying a 429 that named no reset time; doubles per attempt. */
const RATE_LIMIT_FALLBACK_MS = 1_000;

export interface SamplerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_CLOCK: SamplerClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface Readings {
  viewers: HelixRead<number>;
  followers: HelixRead<number>;
  subscriptions: HelixRead<SubscriptionTotals>;
}

type Metric = keyof Readings;

const METRICS: readonly Metric[] = ["viewers", "followers", "subscriptions"];

/**
 * Records viewer count, follower total and subscriber totals once a minute
 * while the stream is live (docs/services/analytics.md).
 *
 * It runs in the api, next to `getStreamStatus`, rather than as a module
 * background task: it calls Helix with the broadcaster's token and writes a
 * system table, and module code may do neither
 * (docs/services/engine-integrity.md). The api already holds the db-proxy
 * client and the token setting, and runs the session resolver that opens and
 * closes segments.
 *
 * A minute is sampled only when a segment is open and Helix agrees the stream
 * is live, so an offline session gets no rows rather than a flat line of
 * zeroes, and the minutes around a transition are left unsampled rather than
 * guessed. Each metric that could not be read is omitted from its row; a 429
 * is waited out within the minute before a metric is given up on.
 */
export class StreamGaugeSampler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(
    private db: DbClient,
    private helix: HelixGauges,
    private logger: SharedLogger,
    private clock: SamplerClock = REAL_CLOCK
  ) {}

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.schedule();
    this.logger.info("StreamGaugeSampler started");
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Chains one timeout per tick rather than an interval, so a tick that is
   * still waiting out a rate limit can never overlap the next one.
   */
  private schedule(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.sampleOnce();
      } catch (err) {
        this.logger.error("StreamGaugeSampler: tick failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.schedule();
    }, msUntilNextTick(this.clock.now()));
  }

  /**
   * Takes and records one sample if the stream is live. Exposed for tests;
   * resolves once the sample is recorded or skipped.
   */
  async sampleOnce(): Promise<void> {
    const startedAt = this.clock.now();

    let live: boolean;
    try {
      const state = await this.db.ensureCurrentStreamSession({});
      live = state.isSegmentOpen === true;
    } catch (err) {
      this.logger.warn("StreamGaugeSampler: could not read the stream session; minute not sampled", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!live) {
      return;
    }

    const readings = await this.read(startedAt + RATE_LIMIT_BUDGET_MS);
    if (readings.viewers.kind === "offline") {
      this.logger.debug("StreamGaugeSampler: segment open but Helix reports the stream offline; minute not sampled");
      return;
    }

    const request = toRequest(new Date(startedAt), readings);
    const failed = METRICS.filter((metric) => readings[metric].kind !== "value").map((metric) => ({
      metric,
      reason: reasonOf(readings[metric]),
    }));
    if (request === null) {
      this.logger.warn("StreamGaugeSampler: no gauge could be read; minute not sampled", { failed });
      return;
    }
    if (failed.length > 0) {
      this.logger.warn("StreamGaugeSampler: recording a partial sample", { failed });
    }

    try {
      await this.db.recordStreamGaugeSample(request);
    } catch (err) {
      if (err instanceof DbError && err.code === "failed_precondition") {
        // The segment closed while Helix was being read.
        this.logger.debug("StreamGaugeSampler: stream went offline before the sample was recorded");
        return;
      }
      this.logger.error("StreamGaugeSampler: sample not recorded", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Reads every metric, re-reading the rate-limited ones until they answer or
   * `deadlineMs` passes. A metric still rate-limited at the deadline is
   * returned as such and left out of the sample.
   */
  private async read(deadlineMs: number): Promise<Readings> {
    const readings: Readings = {
      viewers: { kind: "failed", reason: "not read" },
      followers: { kind: "failed", reason: "not read" },
      subscriptions: { kind: "failed", reason: "not read" },
    };
    let pending: Metric[] = [...METRICS];

    for (let attempt = 0; ; attempt++) {
      const results = await Promise.all(pending.map((metric) => this.readOne(metric)));
      pending.forEach((metric, i) => {
        (readings as Record<Metric, HelixRead<unknown>>)[metric] = results[i];
      });
      pending = pending.filter((metric) => readings[metric].kind === "rate_limited");
      if (pending.length === 0) {
        return readings;
      }

      const now = this.clock.now();
      const waitMs = rateLimitWait(
        pending.map((metric) => readings[metric]),
        now,
        attempt
      );
      if (now + waitMs > deadlineMs) {
        return readings;
      }
      this.logger.info("StreamGaugeSampler: Helix rate limited; waiting before re-reading", {
        metrics: pending,
        waitMs,
      });
      await this.clock.sleep(waitMs);
    }
  }

  private readOne(metric: Metric): Promise<HelixRead<unknown>> {
    switch (metric) {
      case "viewers": {
        return this.helix.viewerCount();
      }
      case "followers": {
        return this.helix.followerTotal();
      }
      case "subscriptions": {
        return this.helix.subscriptions();
      }
    }
  }
}

/**
 * The write for one minute's readings, or null when none of them produced a
 * value. Exported for tests.
 */
export function toRequest(sampledAt: Date, readings: Readings): RecordStreamGaugeSampleRequest | null {
  const request: RecordStreamGaugeSampleRequest = { sampledAt: timestampFromDate(sampledAt) };
  let present = false;
  if (readings.viewers.kind === "value") {
    request.viewerCount = BigInt(readings.viewers.value);
    present = true;
  }
  if (readings.followers.kind === "value") {
    request.followerTotal = BigInt(readings.followers.value);
    present = true;
  }
  if (readings.subscriptions.kind === "value") {
    request.subscriberTotal = BigInt(readings.subscriptions.value.total);
    request.subscriberPoints = BigInt(readings.subscriptions.value.points);
    present = true;
  }
  return present ? request : null;
}

/**
 * How long to wait before re-reading: until the latest reset any of the
 * rate-limited reads named, or an exponential fallback when none named one.
 * Exported for tests.
 */
export function rateLimitWait(reads: readonly HelixRead<unknown>[], nowMs: number, attempt: number): number {
  let resetAtMs: number | null = null;
  for (const read of reads) {
    if (read.kind === "rate_limited" && read.retryAtMs !== null) {
      resetAtMs = resetAtMs === null ? read.retryAtMs : Math.max(resetAtMs, read.retryAtMs);
    }
  }
  const fallback = RATE_LIMIT_FALLBACK_MS * 2 ** attempt;
  if (resetAtMs === null) {
    return fallback;
  }
  return Math.max(resetAtMs - nowMs, RATE_LIMIT_FALLBACK_MS);
}

/** Milliseconds until the next tick, `TICK_OFFSET_MS` into a minute. Exported for tests. */
export function msUntilNextTick(nowMs: number): number {
  const intoMinute = nowMs % MINUTE_MS;
  const wait = TICK_OFFSET_MS - intoMinute;
  return wait > 0 ? wait : wait + MINUTE_MS;
}

function reasonOf(read: HelixRead<unknown>): string {
  switch (read.kind) {
    case "value": {
      return "read";
    }
    case "offline": {
      return "stream offline";
    }
    case "rate_limited": {
      return "rate limited";
    }
    case "failed": {
      return read.reason;
    }
  }
}
