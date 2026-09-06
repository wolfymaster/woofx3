import type * as workflow from "@woofx3/db/workflow.pb";
import * as protoscript from "protoscript";

export const dashboardRoutes = {
  async getDashboard(): Promise<{
    workflows: {
      total: number;
      enabled: number;
      running: number;
    };
    recentActivity: Array<{
      type: string;
      message: string;
      timestamp: string;
    }>;
  }> {
    // Get workflow stats
    const applicationId = await this.ensureApplicationId();
    const workflowsReq: workflow.ListWorkflowsRequest = {
      applicationId,
      includeDisabled: true,
      page: 1,
      pageSize: 1000,
      sortBy: "name",
      sortDesc: false,
    };
    const workflowsResponse = await this.db.listWorkflows(workflowsReq);
    const workflows = workflowsResponse.workflows || [];

    // Get running executions
    const runningExecReq: workflow.ListWorkflowExecutionsRequest = {
      workflowId: "",
      applicationId,
      status: "running",
      startedBy: "",
      from: protoscript.Timestamp.initialize(),
      to: protoscript.Timestamp.initialize(),
      page: 1,
      pageSize: 100,
      sortBy: "startedAt",
      sortDesc: true,
    };
    const runningExecResponse = await this.db.listWorkflowExecutions(runningExecReq);
    const runningCount = runningExecResponse.executions?.length || 0;

    return {
      workflows: {
        total: workflows.length,
        enabled: workflows.filter((w) => w.enabled).length,
        running: runningCount,
      },
      recentActivity: [], // Could be populated from event history
    };
  }
};
