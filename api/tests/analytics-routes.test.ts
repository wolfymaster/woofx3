import { describe, expect, test } from "bun:test";
import type {
  Leaderboard,
  LeaderboardQuery,
  StreamGaugeSample,
  StreamSessionTotals,
  ViewerTotals,
  ViewerTotalsQuery,
} from "@woofx3/api";
import type * as stream_gauge from "@woofx3/db/stream_gauge.pb";
import type * as user_event from "@woofx3/db/user_event.pb";
import { analyticsRoutes } from "../src/routes/analytics";

const SESSION = "7f0c5a1e-0000-4000-8000-000000000001";

function at(iso: string): { seconds: bigint; nanos: number } {
  const ms = Date.parse(iso);
  return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
}

function sample(
  minute: string,
  metrics: Partial<
    Pick<stream_gauge.StreamGaugeSample, "viewerCount" | "followerTotal" | "subscriberTotal" | "subscriberPoints">
  >
): stream_gauge.StreamGaugeSample {
  return {
    id: `g-${minute}`,
    segmentId: "seg-1",
    sessionId: SESSION,
    sampledAt: at(minute),
    createdAt: at(minute),
    ...metrics,
  };
}

const TOTALS: user_event.StreamSessionEventTotals = {
  bits: 1500n,
  cheers: 4n,
  subs: 6n,
  giftedSubs: 10n,
  follows: 12n,
  raids: 1n,
  raiders: 42n,
};

interface Fake {
  totals?: user_event.StreamSessionEventTotals | null;
  samples?: stream_gauge.StreamGaugeSample[] | null;
  viewer?: user_event.ViewerEventTotals | null;
  entries?: user_event.LeaderboardEntry[] | null;
}

/** The routes touch only `db`, so that is all the host needs here. */
function setup(fake: Fake) {
  const viewerRequests: user_event.GetViewerEventTotalsRequest[] = [];
  const leaderboardRequests: user_event.ListViewerLeaderboardRequest[] = [];
  const ctx = {
    db: {
      async findStreamSessionEventTotals() {
        return fake.totals === undefined ? TOTALS : fake.totals;
      },
      async findStreamGaugeSamples() {
        return fake.samples === undefined ? [] : fake.samples;
      },
      async findViewerEventTotals(req: user_event.GetViewerEventTotalsRequest) {
        viewerRequests.push(req);
        return fake.viewer ?? null;
      },
      async findViewerLeaderboard(req: user_event.ListViewerLeaderboardRequest) {
        leaderboardRequests.push(req);
        return fake.entries === undefined ? [] : fake.entries;
      },
    },
  };
  const routes = analyticsRoutes as unknown as {
    getStreamSessionTotals(id: string): Promise<StreamSessionTotals | null>;
    getViewerTotals(q: ViewerTotalsQuery): Promise<ViewerTotals | null>;
    getLeaderboard(q: LeaderboardQuery): Promise<Leaderboard | null>;
    getStreamSessionGauges(id: string): Promise<StreamGaugeSample[] | null>;
  };
  return {
    viewerRequests,
    leaderboardRequests,
    totals: (id: string) => routes.getStreamSessionTotals.call(ctx, id),
    viewer: (q: ViewerTotalsQuery) => routes.getViewerTotals.call(ctx, q),
    leaderboard: (q: LeaderboardQuery) => routes.getLeaderboard.call(ctx, q),
    gauges: (id: string) => routes.getStreamSessionGauges.call(ctx, id),
  };
}

describe("getStreamSessionTotals", () => {
  test("combines the event totals with viewer figures from the samples", async () => {
    const api = setup({
      samples: [
        sample("2026-09-27T20:00:00Z", { viewerCount: 10n }),
        // A failed viewer read is not a zero.
        sample("2026-09-27T20:01:00Z", { followerTotal: 500n }),
        sample("2026-09-27T20:02:00Z", { viewerCount: 25n }),
        sample("2026-09-27T20:03:00Z", { viewerCount: 20n }),
      ],
    });

    expect(await api.totals(SESSION)).toEqual({
      sessionId: SESSION,
      bits: 1500,
      cheers: 4,
      subs: 6,
      giftedSubs: 10,
      follows: 12,
      raids: 1,
      raiders: 42,
      peakViewers: 25,
      averageViewers: 18,
      viewerSampleMinutes: 3,
    });
  });

  test("viewer figures are null, not zero, when nothing was sampled", async () => {
    const totals = await setup({ samples: [] }).totals(SESSION);

    expect(totals?.peakViewers).toBeNull();
    expect(totals?.averageViewers).toBeNull();
    expect(totals?.viewerSampleMinutes).toBe(0);
  });

  test("is null for an unknown session", async () => {
    expect(await setup({ totals: null }).totals(SESSION)).toBeNull();
    expect(await setup({ samples: null }).totals(SESSION)).toBeNull();
  });

  test("rejects an empty id", async () => {
    await expect(setup({}).totals("")).rejects.toThrow("sessionId");
  });
});

describe("getViewerTotals", () => {
  const VIEWER: user_event.ViewerEventTotals = {
    platform: "twitch",
    platformUserId: "1001",
    userName: "Alice",
    bits: 900n,
    cheers: 3n,
    giftedSubs: 5n,
    gifts: 1n,
  };

  test("returns lifetime totals without a session", async () => {
    const api = setup({ viewer: VIEWER });

    expect(await api.viewer({ platform: "twitch", platformUserId: "1001" })).toEqual({
      platform: "twitch",
      platformUserId: "1001",
      userName: "Alice",
      sessionId: null,
      bits: 900,
      cheers: 3,
      giftedSubs: 5,
      gifts: 1,
    });
    expect(api.viewerRequests).toEqual([{ platform: "twitch", platformUserId: "1001" }]);
  });

  test("scopes to a session and keeps a missing name null", async () => {
    const api = setup({ viewer: { ...VIEWER, userName: undefined } });

    const totals = await api.viewer({ platform: "twitch", platformUserId: "1001", sessionId: SESSION });

    expect(totals?.sessionId).toBe(SESSION);
    expect(totals?.userName).toBeNull();
    expect(api.viewerRequests[0]?.streamSessionId).toBe(SESSION);
  });

  test("is null for an unknown session", async () => {
    expect(
      await setup({ viewer: null }).viewer({ platform: "twitch", platformUserId: "1", sessionId: SESSION })
    ).toBeNull();
  });

  test("requires the viewer", async () => {
    await expect(setup({}).viewer({ platform: "twitch", platformUserId: "" })).rejects.toThrow("platformUserId");
    await expect(setup({}).viewer({ platform: "", platformUserId: "1" })).rejects.toThrow("platform");
  });
});

describe("getLeaderboard", () => {
  test("defaults and maps the metric", async () => {
    const api = setup({
      entries: [{ platform: "twitch", platformUserId: "1001", userName: "Alice", total: 900n, events: 3n }],
    });

    expect(await api.leaderboard({ metric: "bits" })).toEqual({
      metric: "bits",
      sessionId: null,
      minTotal: 1,
      entries: [{ platform: "twitch", platformUserId: "1001", userName: "Alice", total: 900, events: 3 }],
    });
    expect(api.leaderboardRequests).toEqual([{ metric: "LEADERBOARD_METRIC_BITS", minTotal: 1n, limit: 10 }]);
  });

  test("passes the threshold, limit and session through", async () => {
    const api = setup({ entries: [{ platform: "twitch", platformUserId: "2", total: 5n, events: 1n }] });

    const board = await api.leaderboard({ metric: "giftedSubs", sessionId: SESSION, minTotal: 5, limit: 3 });

    expect(board?.entries[0]?.userName).toBeNull();
    expect(api.leaderboardRequests).toEqual([
      { metric: "LEADERBOARD_METRIC_GIFTED_SUBS", minTotal: 5n, limit: 3, streamSessionId: SESSION },
    ]);
  });

  test("is null for an unknown session", async () => {
    expect(await setup({ entries: null }).leaderboard({ metric: "bits", sessionId: SESSION })).toBeNull();
  });

  test("validates before calling db-proxy", async () => {
    const api = setup({});
    await expect(api.leaderboard({ metric: "follows" as never })).rejects.toThrow("metric");
    await expect(api.leaderboard({ metric: "bits", minTotal: 0 })).rejects.toThrow("minTotal");
    await expect(api.leaderboard({ metric: "bits", minTotal: 1.5 })).rejects.toThrow("minTotal");
    await expect(api.leaderboard({ metric: "bits", limit: 0 })).rejects.toThrow("limit");
    await expect(api.leaderboard({ metric: "bits", limit: 101 })).rejects.toThrow("limit");
    await expect(api.leaderboard({ metric: "bits", sessionId: "" })).rejects.toThrow("sessionId");
    expect(api.leaderboardRequests).toEqual([]);
  });
});

describe("getStreamSessionGauges", () => {
  test("returns every metric with absent ones as null", async () => {
    const api = setup({
      samples: [
        sample("2026-09-27T20:00:00Z", {
          viewerCount: 10n,
          followerTotal: 500n,
          subscriberTotal: 40n,
          subscriberPoints: 45n,
        }),
        sample("2026-09-27T20:05:00Z", { followerTotal: 501n }),
      ],
    });

    expect(await api.gauges(SESSION)).toEqual([
      {
        sampledAt: "2026-09-27T20:00:00.000Z",
        viewerCount: 10,
        followerTotal: 500,
        subscriberTotal: 40,
        subscriberPoints: 45,
      },
      {
        sampledAt: "2026-09-27T20:05:00.000Z",
        viewerCount: null,
        followerTotal: 501,
        subscriberTotal: null,
        subscriberPoints: null,
      },
    ]);
  });

  test("is null for an unknown session", async () => {
    expect(await setup({ samples: null }).gauges(SESSION)).toBeNull();
  });
});
