import type {
  Leaderboard,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardQuery,
  StreamGaugeSample,
  StreamSessionTotals,
  ViewerTotals,
  ViewerTotalsQuery,
} from "@woofx3/api";
import type * as stream_gauge from "@woofx3/db/stream_gauge.pb";
import type * as user_event from "@woofx3/db/user_event.pb";
import type { DbClient } from "../db-client";
import { timestampToEpochMs } from "../stream-session-resolver";
import { routeModule } from "./context";

const DEFAULT_LEADERBOARD_LIMIT = 10;
const MAX_LEADERBOARD_LIMIT = 100;

const LEADERBOARD_METRICS: Readonly<Record<LeaderboardMetric, user_event.LeaderboardMetric>> = {
  bits: "LEADERBOARD_METRIC_BITS",
  giftedSubs: "LEADERBOARD_METRIC_GIFTED_SUBS",
};

/**
 * A count from db-proxy as a number. Every count here is far below 2^53; one
 * that is not is a corrupt row, and rounding it would report a wrong total
 * as a right one.
 */
function count(value: bigint, field: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`${field} ${value} is outside the safe integer range`);
  }
  return n;
}

function optionalCount(value: bigint | null | undefined, field: string): number | null {
  return value === null || value === undefined ? null : count(value, field);
}

function readId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function readOptionalId(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : readId(value, field);
}

function toSample(sample: stream_gauge.StreamGaugeSample): StreamGaugeSample {
  const ms = timestampToEpochMs(sample.sampledAt);
  if (ms === undefined) {
    throw new Error(`gauge sample ${sample.id} has no sampledAt`);
  }
  return {
    sampledAt: new Date(ms).toISOString(),
    viewerCount: optionalCount(sample.viewerCount, "viewerCount"),
    followerTotal: optionalCount(sample.followerTotal, "followerTotal"),
    subscriberTotal: optionalCount(sample.subscriberTotal, "subscriberTotal"),
    subscriberPoints: optionalCount(sample.subscriberPoints, "subscriberPoints"),
  };
}

/**
 * Peak and mean over the minutes that have a viewer count. Unsampled minutes
 * and failed reads are left out rather than counted as zero, which would drag
 * the mean down for every minute Helix did not answer.
 */
function viewerFigures(
  samples: StreamGaugeSample[]
): Pick<StreamSessionTotals, "peakViewers" | "averageViewers" | "viewerSampleMinutes"> {
  const counts: number[] = [];
  for (const sample of samples) {
    if (sample.viewerCount !== null) {
      counts.push(sample.viewerCount);
    }
  }
  if (counts.length === 0) {
    return { peakViewers: null, averageViewers: null, viewerSampleMinutes: 0 };
  }
  let peak = 0;
  let sum = 0;
  for (const viewers of counts) {
    peak = Math.max(peak, viewers);
    sum += viewers;
  }
  return {
    peakViewers: peak,
    averageViewers: Math.round(sum / counts.length),
    viewerSampleMinutes: counts.length,
  };
}

function readLeaderboardQuery(query: LeaderboardQuery | undefined): {
  metric: LeaderboardMetric;
  sessionId: string | undefined;
  minTotal: number;
  limit: number;
} {
  const metric = query?.metric;
  if (metric !== "bits" && metric !== "giftedSubs") {
    throw new Error('metric must be "bits" or "giftedSubs"');
  }
  const minTotal = query?.minTotal ?? 1;
  if (!Number.isSafeInteger(minTotal) || minTotal < 1) {
    throw new Error("minTotal must be an integer of at least 1");
  }
  const limit = query?.limit ?? DEFAULT_LEADERBOARD_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LEADERBOARD_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_LEADERBOARD_LIMIT}`);
  }
  return { metric, sessionId: readOptionalId(query?.sessionId, "sessionId"), minTotal, limit };
}

function toEntry(entry: user_event.LeaderboardEntry): LeaderboardEntry {
  return {
    platform: entry.platform,
    platformUserId: entry.platformUserId,
    userName: entry.userName ?? null,
    total: count(entry.total, "total"),
    events: count(entry.events, "events"),
  };
}

/**
 * A session's totals, or null when the session does not exist. Shared by the
 * RPC and the session summary, so the UI's stored summary and a live read of
 * the same session can never disagree about what a figure means.
 */
export async function readStreamSessionTotals(
  db: Pick<DbClient, "findStreamSessionEventTotals" | "findStreamGaugeSamples">,
  sessionId: string
): Promise<StreamSessionTotals | null> {
  const id = readId(sessionId, "sessionId");
  const [totals, samples] = await Promise.all([db.findStreamSessionEventTotals(id), db.findStreamGaugeSamples(id)]);
  if (totals === null || samples === null) {
    return null;
  }
  return {
    sessionId: id,
    bits: count(totals.bits, "bits"),
    cheers: count(totals.cheers, "cheers"),
    subs: count(totals.subs, "subs"),
    giftedSubs: count(totals.giftedSubs, "giftedSubs"),
    follows: count(totals.follows, "follows"),
    raids: count(totals.raids, "raids"),
    raiders: count(totals.raiders, "raiders"),
    ...viewerFigures(samples.map(toSample)),
  };
}

export const analyticsRoutes = routeModule({
  async getStreamSessionTotals(sessionId: string): Promise<StreamSessionTotals | null> {
    return readStreamSessionTotals(this.db, sessionId);
  },

  async getViewerTotals(query: ViewerTotalsQuery): Promise<ViewerTotals | null> {
    const platform = readId(query?.platform, "platform");
    const platformUserId = readId(query?.platformUserId, "platformUserId");
    const sessionId = readOptionalId(query?.sessionId, "sessionId");
    const totals = await this.db.findViewerEventTotals({
      platform,
      platformUserId,
      ...(sessionId !== undefined ? { streamSessionId: sessionId } : {}),
    });
    if (totals === null) {
      return null;
    }
    return {
      platform,
      platformUserId,
      userName: totals.userName ?? null,
      sessionId: sessionId ?? null,
      bits: count(totals.bits, "bits"),
      cheers: count(totals.cheers, "cheers"),
      giftedSubs: count(totals.giftedSubs, "giftedSubs"),
      gifts: count(totals.gifts, "gifts"),
    };
  },

  async getLeaderboard(query: LeaderboardQuery): Promise<Leaderboard | null> {
    const { metric, sessionId, minTotal, limit } = readLeaderboardQuery(query);
    const entries = await this.db.findViewerLeaderboard({
      metric: LEADERBOARD_METRICS[metric],
      minTotal: BigInt(minTotal),
      limit,
      ...(sessionId !== undefined ? { streamSessionId: sessionId } : {}),
    });
    if (entries === null) {
      return null;
    }
    return { metric, sessionId: sessionId ?? null, minTotal, entries: entries.map(toEntry) };
  },

  async getStreamSessionGauges(sessionId: string): Promise<StreamGaugeSample[] | null> {
    const samples = await this.db.findStreamGaugeSamples(readId(sessionId, "sessionId"));
    return samples === null ? null : samples.map(toSample);
  },
});
