import type { DashboardStats } from "@woofx3/api";
import { listEngineModules } from "../engine-modules";
import { routeModule } from "./context";
import { readRecentActivity } from "./dashboard";

export const dashboardStatsRoutes = routeModule({
  async getDashboardStats(): Promise<DashboardStats> {
    const engineModules = await listEngineModules(this.db, this.logger).catch(() => []);
    const [workflowsResponse, recent] = await Promise.all([
      this.db.listWorkflows({
        includeDisabled: true,
        page: 1,
        pageSize: 1000,
        sortBy: "",
        sortDesc: false,
      }),
      // Only the count is wanted; one event is the smallest page the read allows.
      readRecentActivity(this.db, new Date(), 1),
    ]);
    const workflows = workflowsResponse.workflows ?? [];
    return {
      activeWorkflows: workflows.filter((w) => w.enabled).length,
      totalWorkflows: workflowsResponse.totalCount ?? workflows.length,
      installedModules: engineModules.length,
      totalModules: engineModules.length,
      recentEvents: recent.total,
    };
  },
});
