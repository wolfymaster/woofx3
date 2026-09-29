import { describe, expect, test } from "bun:test";
import type { DashboardStats, RecentActivity } from "@woofx3/api";
import type * as user_event from "@woofx3/db/user_event.pb";
import { dashboardRoutes, RECENT_ACTIVITY_WINDOW_MS } from "../src/routes/dashboard";
import { dashboardStatsRoutes } from "../src/routes/dashboard-stats";

function at(iso: string): { seconds: bigint; nanos: number } {
  const ms = Date.parse(iso);
  return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
}

function event(overrides: Partial<user_event.UserEvent>): user_event.UserEvent {
  return {
    id: "ue-1",
    eventId: "ce-1",
    source: "twitch",
    eventType: "channel.cheer",
    platform: "twitch",
    eventValue: "{}",
    occurredAt: at("2026-09-27T12:00:00Z"),
    createdAt: at("2026-09-27T12:00:00Z"),
    ...overrides,
  };
}

interface Fake {
  events?: user_event.UserEvent[];
  total?: bigint;
}

/** The routes touch only `db` and `logger`, so that is all the host needs. */
function setup(fake: Fake = {}) {
  const recentRequests: user_event.ListRecentUserEventsRequest[] = [];
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    db: {
      async listRecentUserEvents(req: user_event.ListRecentUserEventsRequest) {
        recentRequests.push(req);
        return { events: fake.events ?? [], total: fake.total ?? 0n };
      },
      async listWorkflows() {
        return { workflows: [{ enabled: true }, { enabled: false }], totalCount: 2 };
      },
      async listWorkflowExecutions() {
        return { executions: [{}] };
      },
      async listModules() {
        return [];
      },
    },
  };
  const dashboard = dashboardRoutes as unknown as {
    getDashboard(): Promise<{ recentActivity: RecentActivity[]; workflows: Record<string, number> }>;
  };
  const stats = dashboardStatsRoutes as unknown as { getDashboardStats(): Promise<DashboardStats> };
  return {
    recentRequests,
    getDashboard: () => dashboard.getDashboard.call(ctx),
    getDashboardStats: () => stats.getDashboardStats.call(ctx),
  };
}

function sinceMs(req: user_event.ListRecentUserEventsRequest | undefined): number {
  const since = req?.since;
  if (!since) {
    throw new Error("no since");
  }
  return Number(since.seconds) * 1000 + Math.floor(since.nanos / 1_000_000);
}

describe("getDashboard", () => {
  test("feeds recent activity from the event log", async () => {
    const { getDashboard, recentRequests } = setup({
      events: [
        event({ id: "ue-2", eventType: "channel.subscription.gift", userName: "Bob", amount: 5n }),
        event({ id: "ue-1", eventType: "channel.cheer", amount: 100n, occurredAt: at("2026-09-27T11:00:00Z") }),
        event({ id: "ue-0", eventType: "channel.follow", userName: "Alice" }),
      ],
      total: 3n,
    });
    const before = Date.now();
    const dashboard = await getDashboard();
    expect(dashboard.recentActivity).toEqual([
      {
        type: "channel.subscription.gift",
        platform: "twitch",
        userName: "Bob",
        amount: 5,
        timestamp: "2026-09-27T12:00:00.000Z",
      },
      { type: "channel.cheer", platform: "twitch", userName: null, amount: 100, timestamp: "2026-09-27T11:00:00.000Z" },
      {
        type: "channel.follow",
        platform: "twitch",
        userName: "Alice",
        amount: null,
        timestamp: "2026-09-27T12:00:00.000Z",
      },
    ]);
    expect(dashboard.workflows).toEqual({ total: 2, enabled: 1, running: 1 });
    expect(recentRequests[0]?.limit).toBe(20);
    const windowStart = sinceMs(recentRequests[0]);
    expect(windowStart).toBeGreaterThanOrEqual(before - RECENT_ACTIVITY_WINDOW_MS - 1000);
    expect(windowStart).toBeLessThanOrEqual(Date.now() - RECENT_ACTIVITY_WINDOW_MS);
  });

  test("is empty when nothing happened in the window", async () => {
    const { getDashboard } = setup();
    expect((await getDashboard()).recentActivity).toEqual([]);
  });
});

describe("getDashboardStats", () => {
  test("counts recent events from the log and invents no figure", async () => {
    const { getDashboardStats, recentRequests } = setup({ events: [event({})], total: 147_000n });
    const stats = await getDashboardStats();
    expect(stats).toEqual({
      activeWorkflows: 1,
      totalWorkflows: 2,
      installedModules: 0,
      totalModules: 0,
      recentEvents: 147_000,
    });
    expect(recentRequests[0]?.limit).toBe(1);
  });

  test("reports zero recent events as zero", async () => {
    const { getDashboardStats } = setup();
    expect((await getDashboardStats()).recentEvents).toBe(0);
  });
});
