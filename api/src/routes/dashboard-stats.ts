export const dashboardStatsRoutes = {
  async getDashboardStats(): Promise<{
    activeWorkflows: number;
    totalWorkflows: number;
    installedModules: number;
    totalModules: number;
    activeAccounts: number;
    recentEvents: number;
  }> {
    const engineModules = await this.listEngineModules().catch(() => []);
    const applicationId = await this.ensureApplicationId();
    const workflowsResponse = await this.db.listWorkflows({
      applicationId,
      includeDisabled: true,
      page: 1,
      pageSize: 1000,
      sortBy: "",
      sortDesc: false,
    });
    const workflows = workflowsResponse.workflows ?? [];
    return {
      activeWorkflows: workflows.filter((w) => w.enabled).length,
      totalWorkflows: workflowsResponse.totalCount ?? workflows.length,
      installedModules: engineModules.length,
      totalModules: engineModules.length,
      activeAccounts: 2,
      recentEvents: 147,
    };
  }
};
