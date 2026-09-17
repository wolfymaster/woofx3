import type * as workflow from "@woofx3/db/workflow.pb";
import * as protoscript from "protoscript";
import { routeModule } from "./context";

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
    workflowNameOrId: string,
    parameters: Record<string, string> = {},
    userId?: string,
    triggerId?: string,
    triggeredBy?: string
  ): Promise<{
    executionId: string;
    status: string;
    message: string;
    triggerId: string;
  }> {
    this.logger.info("Triggering workflow", {
      workflowNameOrId,
      userId,
      triggerId,
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
    // Matched on either id or name: the dashboard holds ids, a chat command or
    // a hand-written call holds names, and both reach this one method. Id is
    // tried first because it is exact -- a name comparison is case-insensitive
    // and two workflows may share one.
    const needle = workflowNameOrId.toLowerCase();
    const foundWorkflow =
      workflowsResponse.workflows.find((wf) => wf.id === workflowNameOrId) ??
      workflowsResponse.workflows.find((wf) => wf.name.toLowerCase() === needle);
    if (!foundWorkflow) {
      throw new Error(`Workflow "${workflowNameOrId}" not found`);
    }
    if (!foundWorkflow.enabled) {
      throw new Error(`Workflow "${workflowNameOrId}" is disabled`);
    }

    // Published for the engine to run, rather than written as a db-proxy
    // execution row. The row had no consumer -- nothing turned a pending row
    // into a run -- so it recorded an execution that never happened and left
    // the caller holding an id matching nothing. The engine owns execution and
    // reports the run's lifecycle itself.
    const correlationId = triggerId || crypto.randomUUID();
    await this.publishEvent(
      "workflow.execute",
      { workflowId: foundWorkflow.id, inputs: parameters, startedBy: userId ?? "" },
      undefined,
      undefined,
      "api",
      { triggerId: correlationId, triggeredBy }
    );

    this.logger.info("Workflow run requested", {
      workflowId: foundWorkflow.id,
      workflowName: foundWorkflow.name,
      triggerId: correlationId,
    });

    return {
      // Deliberately empty. The engine mints an execution id when the run
      // actually begins, asynchronously and out of this call's reach; a
      // fabricated one here would match no run, which is what it used to do.
      // `triggerId` is the handle that does resolve -- the run's lifecycle is
      // reported against it.
      executionId: "",
      status: "requested",
      message: `Requested a run of "${foundWorkflow.name}"`,
      triggerId: correlationId,
    };
  },

  /**
   * Run a recorded workflow run again: the whole run, or from one of its steps.
   *
   * Reads the run from the db proxy, which is the record of what happened, and
   * hands the engine what it needs to reproduce it -- the original trigger event
   * and each step's recorded outcome. Whether the replay can run is the
   * engine's decision: it checks the resume step still exists in the current
   * definition and that every step before it succeeded, and announces a refusal
   * as a failed run against `triggerId`. So this returns once the request is on
   * the bus rather than waiting to learn the outcome.
   */
  async replayWorkflowRun(
    engineRunId: string,
    fromTaskId?: string,
    triggerId?: string,
    triggeredBy?: string
  ): Promise<{ triggerId: string }> {
    const run = await this.db.getWorkflowExecution({ id: engineRunId });
    const correlationId = triggerId || crypto.randomUUID();

    await this.publishEvent(
      "workflow.replay",
      {
        workflowId: run.workflowId,
        triggerEvent: run.triggerEventJson,
        fromTaskId: fromTaskId ?? "",
        steps: (run.steps ?? []).map((step) => ({
          taskId: step.stepId,
          status: step.status,
          attempt: step.attempt,
          outputs: step.outputsJson,
        })),
      },
      undefined,
      undefined,
      "api",
      { triggerId: correlationId, triggeredBy }
    );

    this.logger.info("Workflow run replay requested", { engineRunId, fromTaskId, triggerId: correlationId });
    return { triggerId: correlationId };
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
