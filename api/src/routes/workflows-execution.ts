import {
  type CancelWorkflowResult,
  MAX_TRIGGER_DATA_BYTES,
  type TriggerWorkflowOptions,
  type TriggerWorkflowResponse,
  type UnmetTriggerCondition,
} from "@woofx3/api";
import type * as workflow from "@woofx3/db/workflow.pb";
import * as protoscript from "protoscript";
import type { DbClient } from "../db-client";
import { routeModule } from "./context";
import { timestampFromDate } from "./helpers";

/**
 * The engine's answer to a `workflow.execute` request. Must match
 * `executeReply` in workflow/app.go.
 */
interface ExecuteReply {
  outcome: "started" | "conditions_not_met" | "refused";
  executionId?: string;
  eventType?: string;
  unmet?: UnmetTriggerCondition[];
  error?: string;
}

/**
 * The engine's answer to a `workflow.cancel` request. Must match `cancelReply`
 * in workflow/app.go.
 */
interface CancelReply {
  outcome: "cancelled" | "already_finished" | "not_found" | "refused";
  status?: string;
  error?: string;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * The origin a run records as `triggeredBy`. The positional argument and
 * `options.origin` name the same thing; two different values is a caller bug
 * rather than something to pick between silently.
 */
function resolveOrigin(triggeredBy: string | undefined, origin: string | undefined): string | undefined {
  if (triggeredBy && origin && triggeredBy !== origin) {
    throw new Error(`triggeredBy "${triggeredBy}" and options.origin "${origin}" disagree; give one`);
  }
  return origin || triggeredBy || undefined;
}

/**
 * Check a sample payload before it goes on the bus. The engine enforces the
 * same size bound (MaxTriggerDataBytes in workflow/internal/engine/manual.go);
 * checking here too turns an oversized sample into an error the caller sees
 * at once rather than a refusal from the engine.
 */
function validateTriggerData(triggerData: unknown): Record<string, unknown> {
  if (typeof triggerData !== "object" || triggerData === null || Array.isArray(triggerData)) {
    throw new Error("options.triggerData must be a JSON object");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify(triggerData);
  } catch (err) {
    throw new Error(`options.triggerData is not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const bytes = new TextEncoder().encode(encoded).length;
  if (bytes > MAX_TRIGGER_DATA_BYTES) {
    throw new Error(`options.triggerData is ${bytes} bytes, over the ${MAX_TRIGGER_DATA_BYTES} byte limit`);
  }
  return triggerData as Record<string, unknown>;
}

function describeUnmet(unmet: UnmetTriggerCondition[]): string {
  return unmet
    .map((c) => `${c.field} ${c.operator} ${JSON.stringify(c.value)}${c.error ? ` (${c.error})` : ""}`)
    .join("; ");
}

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
    const req: workflow.ListWorkflowsRequest = {
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
   * Trigger a workflow by id or name.
   *
   * Without sample trigger data the request is published and this returns at
   * once with status `requested`. With `options.triggerData` it is sent as a
   * request instead, and the engine answers with the run's execution id, or
   * with the trigger conditions the sample failed.
   */
  async triggerWorkflowByName(
    workflowNameOrId: string,
    parameters: Record<string, string> = {},
    userId?: string,
    triggerId?: string,
    triggeredBy?: string,
    options: TriggerWorkflowOptions = {}
  ): Promise<TriggerWorkflowResponse> {
    this.logger.info("Triggering workflow", {
      workflowNameOrId,
      userId,
      triggerId,
      parametersCount: Object.keys(parameters).length,
      sampleData: options.triggerData !== undefined,
    });
    const origin = resolveOrigin(triggeredBy, options.origin);
    const hasSample = options.triggerData !== undefined;
    if (!hasSample && (options.platform !== undefined || options.skipConditions !== undefined)) {
      throw new Error("options.platform and options.skipConditions only apply with options.triggerData");
    }
    const triggerData = hasSample ? validateTriggerData(options.triggerData) : undefined;

    // First, find the workflow by name
    const workflowsReq: workflow.ListWorkflowsRequest = {
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

    const correlationId = triggerId || crypto.randomUUID();
    const request = { workflowId: foundWorkflow.id, inputs: parameters, startedBy: userId ?? "" };

    if (!triggerData) {
      // Published for the engine to run, rather than written as a db-proxy
      // execution row. The row had no consumer -- nothing turned a pending row
      // into a run -- so it recorded an execution that never happened and left
      // the caller holding an id matching nothing. The engine owns execution
      // and reports the run's lifecycle itself.
      await this.publishEvent("workflow.execute", request, undefined, undefined, "api", {
        triggerId: correlationId,
        triggeredBy: origin,
      });

      this.logger.info("Workflow run requested", {
        workflowId: foundWorkflow.id,
        workflowName: foundWorkflow.name,
        triggerId: correlationId,
      });

      return {
        // Deliberately empty. The engine mints an execution id when the run
        // actually begins, asynchronously and out of this call's reach; a
        // fabricated one here would match no run. `triggerId` is the handle
        // that does resolve -- the run's lifecycle is reported against it.
        executionId: "",
        status: "requested",
        message: `Requested a run of "${foundWorkflow.name}"`,
        triggerId: correlationId,
      };
    }

    const reply = await this.requestEvent<ExecuteReply>(
      "workflow.execute",
      {
        ...request,
        triggerData,
        ...(options.platform ? { platform: options.platform } : {}),
        ...(options.skipConditions ? { skipConditions: true } : {}),
      },
      { triggerId: correlationId, triggeredBy: origin }
    );

    switch (reply.outcome) {
      case "started":
        this.logger.info("Workflow run started with sample data", {
          workflowId: foundWorkflow.id,
          executionId: reply.executionId,
          triggerId: correlationId,
        });
        return {
          executionId: reply.executionId ?? "",
          status: "started",
          message: `Started "${foundWorkflow.name}" with sample ${reply.eventType ?? "trigger"} data`,
          triggerId: correlationId,
          ...(reply.eventType ? { eventType: reply.eventType } : {}),
        };
      case "conditions_not_met": {
        const unmet = reply.unmet ?? [];
        return {
          executionId: "",
          status: "conditions_not_met",
          message: `The sample does not match the trigger conditions of "${foundWorkflow.name}": ${describeUnmet(unmet)}`,
          triggerId: correlationId,
          ...(reply.eventType ? { eventType: reply.eventType } : {}),
          unmetConditions: unmet,
        };
      }
      default:
        throw new Error(`The engine refused to run "${foundWorkflow.name}": ${reply.error ?? "no reason given"}`);
    }
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
    let workflowId: string | undefined;
    if (options.workflowName) {
      const workflowsReq: workflow.ListWorkflowsRequest = {
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
   * Cancel a run.
   *
   * The engine is asked first, because only it can stop a run that is still
   * going. A run it does not know -- one that was in flight when the engine
   * restarted, which no process will ever finish -- is settled in the history
   * instead, so it stops reading as running. Either way the run's row reaches
   * `cancelled` through db-proxy's run status update, which is what relays the
   * change to the dashboard.
   */
  async cancelWorkflow(executionId: string, reason?: string): Promise<CancelWorkflowResult> {
    if (!executionId) {
      throw new Error("executionId is required");
    }
    const why = reason || "Cancelled by user";
    this.logger.info("Cancelling workflow run", { executionId, reason: why });

    const reply = await this.requestJson<CancelReply>("workflow.cancel", { executionId, reason: why });
    switch (reply.outcome) {
      case "cancelled":
        return { executionId, outcome: "cancelled", status: "cancelled", message: "The run was cancelled" };
      case "already_finished":
        return {
          executionId,
          outcome: "already_finished",
          status: reply.status ?? "",
          message: `The run had already ${reply.status ?? "finished"}; nothing was changed`,
        };
      case "not_found":
        return cancelRecordedRun(this.db, executionId, why);
      default:
        throw new Error(`The engine refused to cancel run ${executionId}: ${reply.error ?? "no reason given"}`);
    }
  },
});

/**
 * Settle a run the engine is not running, in the history alone.
 *
 * Nothing is executing it, so there is nothing to stop: only the row is
 * wrong. A row already settled is left as it is and reported as such.
 */
async function cancelRecordedRun(
  db: Pick<DbClient, "getWorkflowExecution" | "updateWorkflowRunStatus">,
  executionId: string,
  reason: string
): Promise<CancelWorkflowResult> {
  let run: workflow.WorkflowExecution;
  try {
    run = await db.getWorkflowExecution({ id: executionId });
  } catch {
    throw new Error(`Workflow run ${executionId} not found`);
  }
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    return settledResult(executionId, run.status);
  }

  try {
    await db.updateWorkflowRunStatus({
      id: executionId,
      status: "cancelled",
      error: `cancelled: ${reason}`,
      outputJson: "",
      completedAt: timestampFromDate(new Date()),
    });
  } catch (err) {
    // Refused because the row settled between the read and the write; the
    // row now says how.
    const current = await db.getWorkflowExecution({ id: executionId });
    if (TERMINAL_RUN_STATUSES.has(current.status)) {
      return settledResult(executionId, current.status);
    }
    throw err;
  }
  return {
    executionId,
    outcome: "cancelled",
    status: "cancelled",
    message: "The engine was not running this run, so only its history was marked cancelled",
  };
}

function settledResult(executionId: string, status: string): CancelWorkflowResult {
  if (status === "cancelled") {
    return { executionId, outcome: "cancelled", status, message: "The run was already cancelled" };
  }
  return {
    executionId,
    outcome: "already_finished",
    status,
    message: `The run had already ${status}; nothing was changed`,
  };
}
