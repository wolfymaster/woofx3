import type { RecentActivity } from "@woofx3/api";
import type * as user_event from "@woofx3/db/user_event.pb";
import type * as workflow from "@woofx3/db/workflow.pb";
import * as protoscript from "protoscript";
import type { DbClient } from "../db-client";
import { timestampToEpochMs } from "../stream-session-resolver";
import { routeModule } from "./context";
import { timestampFromDate } from "./helpers";

/** How far back the dashboard's "recent" reaches, for both the feed and the count. */
export const RECENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_LIMIT = 20;

/**
 * The platform events of the recent window, newest first and at most `limit`,
 * and how many there were in all.
 */
export async function readRecentActivity(
  db: Pick<DbClient, "listRecentUserEvents">,
  now: Date,
  limit: number
): Promise<{ activity: RecentActivity[]; total: number }> {
  const since = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS);
  const { events, total } = await db.listRecentUserEvents({ since: timestampFromDate(since), limit });
  const count = Number(total);
  if (!Number.isSafeInteger(count)) {
    throw new Error(`recent event total ${total} is outside the safe integer range`);
  }
  return { activity: events.map(toActivity), total: count };
}

function toActivity(event: user_event.UserEvent): RecentActivity {
  const occurredAt = timestampToEpochMs(event.occurredAt);
  if (occurredAt === undefined) {
    throw new Error(`user event ${event.id} has no occurredAt`);
  }
  const amount = event.amount === null || event.amount === undefined ? null : Number(event.amount);
  if (amount !== null && !Number.isSafeInteger(amount)) {
    throw new Error(`user event ${event.id} amount ${event.amount} is outside the safe integer range`);
  }
  return {
    type: event.eventType,
    platform: event.platform,
    userName: event.userName ?? null,
    amount,
    timestamp: new Date(occurredAt).toISOString(),
  };
}

export const dashboardRoutes = routeModule({
  async getDashboard(): Promise<{
    workflows: {
      total: number;
      enabled: number;
      running: number;
    };
    recentActivity: RecentActivity[];
  }> {
    const workflowsReq: workflow.ListWorkflowsRequest = {
      includeDisabled: true,
      page: 1,
      pageSize: 1000,
      sortBy: "name",
      sortDesc: false,
    };
    const runningExecReq: workflow.ListWorkflowExecutionsRequest = {
      workflowId: "",
      status: "running",
      startedBy: "",
      from: protoscript.Timestamp.initialize(),
      to: protoscript.Timestamp.initialize(),
      page: 1,
      pageSize: 100,
      sortBy: "startedAt",
      sortDesc: true,
    };
    const [workflowsResponse, runningExecResponse, recent] = await Promise.all([
      this.db.listWorkflows(workflowsReq),
      this.db.listWorkflowExecutions(runningExecReq),
      readRecentActivity(this.db, new Date(), RECENT_ACTIVITY_LIMIT),
    ]);
    const workflows = workflowsResponse.workflows || [];

    return {
      workflows: {
        total: workflows.length,
        enabled: workflows.filter((w) => w.enabled).length,
        running: runningExecResponse.executions?.length || 0,
      },
      recentActivity: recent.activity,
    };
  },
});
