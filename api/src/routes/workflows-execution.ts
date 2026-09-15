import { routeModule } from "./context";
import type * as workflow from "@woofx3/db/workflow.pb";
import * as protoscript from "protoscript";

export const workflowsExecutionRoutes = routeModule({
  async getAvailableWorkflows(): Promise<{
    workflows: Array<{
      id: string;
      name: string;
      description: string;
      enabled: boolean;
      lastExecution?: {
        id: string;
        status: string;
        startedAt: string;
      };
    }>;
  }> {
    this.logger.debug("Getting available workflows");
    const applicationId = await this.ensureApplicationId();
    const req: workflow.ListWorkflowsRequest = {
      applicationId,
      includeDisabled: false,
      page: 1,
      pageSize: 1000,
      sortBy: "name",
      sortDesc: false,
    };
    const response = await this.db.listWorkflows(req);
    this.logger.info("Retrieved available workflows", {
      count: response.workflows.length,
    });

    // Get recent executions for each workflow
    const workflowsWithStatus = await Promise.all(
      response.workflows.map(async (wf) => {
        const execReq: workflow.ListWorkflowExecutionsRequest = {
          workflowId: wf.id,
          applicationId,
          status: "",
          startedBy: "",
          from: protoscript.Timestamp.initialize(),
          to: protoscript.Timestamp.initialize(),
          page: 1,
          pageSize: 1,
          sortBy: "startedAt",
          sortDesc: true,
        };
        const execResponse = await this.db.listWorkflowExecutions(execReq);
        const lastExecution = execResponse.executions?.[0];

        return {
          id: wf.id,
          name: wf.name,
          description: wf.description,
          enabled: wf.enabled,
          lastExecution: lastExecution
            ? {
                id: lastExecution.id,
                status: lastExecution.status,
                startedAt: lastExecution.startedAt
                  ? new Date(
                      Number(lastExecution.startedAt.seconds) * 1000 + lastExecution.startedAt.nanos / 1000000
                    ).toISOString()
                  : "",
              }
            : undefined,
        };
      })
    );

    return { workflows: workflowsWithStatus };
  },

  /**
   * Trigger a workflow by name (user-friendly).
   * The UI can call this with a workflow name and parameters.
   */
  async triggerWorkflowByName(
    workflowName: string,
    parameters: Record<string, string> = {},
    userId?: string
  ): Promise<{
    executionId: string;
    status: string;
    message: string;
  }> {
    this.logger.info("Triggering workflow by name", {
      workflowName,
      userId,
      parametersCount: Object.keys(parameters).length,
    });
    const applicationId = await this.ensureApplicationId();
    // First, find the workflow by name
    const workflowsReq: workflow.ListWorkflowsRequest = {
      applicationId,
      includeDisabled: false,
      page: 1,
      pageSize: 1000,
      sortBy: "name",
      sortDesc: false,
    };
    const workflowsResponse = await this.db.listWorkflows(workflowsReq);
    const foundWorkflow = workflowsResponse.workflows.find(
      (wf) => wf.name.toLowerCase() === workflowName.toLowerCase()
    );
    if (!foundWorkflow) {
      throw new Error(`Workflow "${workflowName}" not found`);
    }
    if (!foundWorkflow.enabled) {
      throw new Error(`Workflow "${workflowName}" is disabled`);
    }

    // Execute the workflow
    const correlationId = crypto.randomUUID();
    const execReq: workflow.ExecuteWorkflowRequest = {
      workflowId: foundWorkflow.id,
      applicationId,
      startedBy: userId || "ui",
      inputs: parameters,
      async: true,
      correlationId,
    };
    let execResponse: { executionId: string; async: boolean };
    try {
      execResponse = await this.db.executeWorkflow(execReq);
    } catch (err) {
      // Caught only to attach the workflow this was for; db-proxy's reason
      // travels on unchanged.
      this.logger.error("Failed to execute workflow", {
        workflowId: foundWorkflow.id,
        workflowName,
        error: err instanceof Error ? err.message : String(err),
        correlationId,
      });
      throw err;
    }

    this.logger.info("Workflow triggered successfully", {
      workflowId: foundWorkflow.id,
      workflowName,
      executionId: execResponse.executionId,
      correlationId,
      async: execResponse.async,
    });

    return {
      executionId: execResponse.executionId,
      status: execResponse.async ? "running" : "completed",
      message: execResponse.async ? "Workflow started successfully" : "Workflow completed",
    };
  },

  /**
   * Get workflow execution status for displaying in the UI.
   */
  async getWorkflowStatus(executionId: string): Promise<{
    id: string;
    workflowId: string;
    workflowName: string;
    status: string;
    progress: number; // 0-100
    startedAt: string;
    completedAt?: string;
    error?: string;
    steps: Array<{
      name: string;
      status: string;
      startedAt?: string;
      completedAt?: string;
    }>;
  }> {
    this.logger.debug("Getting workflow status", { executionId });
    const req: workflow.GetWorkflowExecutionRequest = {
      id: executionId,
    };
    const exec = await this.db.getWorkflowExecution(req);

    // Get workflow name
    const workflowReq: workflow.GetWorkflowRequest = {
      id: exec.workflowId,
    };
    const workflowRow = await this.db.findWorkflow(workflowReq);
    const workflowName = workflowRow?.name || "Unknown";

    // Calculate progress based on steps
    const steps: workflow.ExecutionStep[] = exec.steps ?? [];
    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const progress = steps.length > 0 ? (completedSteps / steps.length) * 100 : 0;

    return {
      id: exec.id,
      workflowId: exec.workflowId,
      workflowName,
      status: exec.status,
      progress: Math.round(progress),
      startedAt: exec.startedAt
        ? new Date(Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000).toISOString()
        : "",
      completedAt: exec.completedAt
        ? new Date(Number(exec.completedAt.seconds) * 1000 + exec.completedAt.nanos / 1000000).toISOString()
        : undefined,
      error: exec.error || undefined,
      steps: steps.map((step) => ({
        name: step.name,
        status: step.status,
        startedAt: step.startedAt
          ? new Date(Number(step.startedAt.seconds) * 1000 + step.startedAt.nanos / 1000000).toISOString()
          : undefined,
        completedAt: step.completedAt
          ? new Date(Number(step.completedAt.seconds) * 1000 + step.completedAt.nanos / 1000000).toISOString()
          : undefined,
      })),
    };
  },

  /**
   * Get workflow execution history for a user or workflow.
   */
  async getWorkflowHistory(options: {
    workflowName?: string;
    userId?: string;
    status?: string;
    limit?: number;
  }): Promise<{
    executions: Array<{
      id: string;
      workflowName: string;
      status: string;
      startedAt: string;
      completedAt?: string;
      startedBy: string;
    }>;
  }> {
    const applicationId = await this.ensureApplicationId();
    let workflowId: string | undefined;
    if (options.workflowName) {
      const workflowsReq: workflow.ListWorkflowsRequest = {
        applicationId,
        includeDisabled: false,
        page: 1,
        pageSize: 1000,
        sortBy: "name",
        sortDesc: false,
      };
      const workflowsResponse = await this.db.listWorkflows(workflowsReq);
      const foundWorkflow = workflowsResponse.workflows.find(
        (wf) => wf.name.toLowerCase() === options.workflowName?.toLowerCase()
      );
      workflowId = foundWorkflow?.id;
    }

    const req: workflow.ListWorkflowExecutionsRequest = {
      workflowId: workflowId || "",
      applicationId,
      status: options.status || "",
      startedBy: options.userId || "",
      from: protoscript.Timestamp.initialize(),
      to: protoscript.Timestamp.initialize(),
      page: 1,
      pageSize: options.limit || 50,
      sortBy: "startedAt",
      sortDesc: true,
    };
    const response = await this.db.listWorkflowExecutions(req);

    // Get workflow names for each execution
    const executionsWithNames = await Promise.all(
      response.executions.map(async (exec) => {
        const workflowReq: workflow.GetWorkflowRequest = {
          id: exec.workflowId,
        };
        const workflowRow = await this.db.findWorkflow(workflowReq);
        const workflowName = workflowRow?.name || "Unknown";

        return {
          id: exec.id,
          workflowName,
          status: exec.status,
          startedAt: exec.startedAt
            ? new Date(Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000).toISOString()
            : "",
          completedAt: exec.completedAt
            ? new Date(Number(exec.completedAt.seconds) * 1000 + exec.completedAt.nanos / 1000000).toISOString()
            : undefined,
          startedBy: exec.startedBy,
        };
      })
    );

    return { executions: executionsWithNames };
  },

  /**
   * Cancel a running workflow execution.
   */
  async cancelWorkflow(executionId: string, reason?: string): Promise<void> {
    this.logger.info("Cancelling workflow", { executionId, reason });
    const req: workflow.CancelWorkflowExecutionRequest = {
      id: executionId,
      reason: reason || "Cancelled by user",
    };
    await this.db.cancelWorkflowExecution(req);
    this.logger.info("Workflow cancelled successfully", { executionId });
  },
});
