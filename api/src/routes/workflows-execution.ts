import type {
  AvailableFunction,
  CommandSnapshot,
  CommandType,
  CreateCommandInput,
  CreateWorkflowInput,
  FieldOptionsDescriptor,
  PingResponse,
  Scene,
  StorageConfig,
  UpdateCommandInput,
  UpdateWorkflowInput,
  WorkflowDefinition,
  WorkflowMutationResult,
} from "@woofx3/api";
import type {
  ActionDefinition,
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneUpdatedEvent,
  TriggerDefinition,
  WorkflowCreatedEvent,
  WorkflowDeletedEvent,
  WorkflowUpdatedEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { Action } from "@woofx3/db/module_action.pb";
import type { Trigger } from "@woofx3/db/module_trigger.pb";
import type * as command from "@woofx3/db/command.pb";
import type * as scene from "@woofx3/db/scene.pb";
import type * as treat from "@woofx3/db/treat.pb";
import type * as user from "@woofx3/db/user.pb";
import type * as workflow from "@woofx3/db/workflow.pb";
import * as protoscript from "protoscript";
import { ApiRouteHost } from "./context";
import {
  commandToSnapshot,
  dbSceneToSnapshot,
  dbSceneToWire,
  readModuleCatalogFields,
  rebuildWorkflowDefinition,
  timestampFromDate,
  timestampToIso,
} from "./helpers";
import type { UninstallModuleResponse, WorkflowItem } from "./types";
import {
  parseModuleActionDeregistered,
  parseModuleActionRegistered,
  parseModuleAssetDeregistered,
  parseModuleAssetRegistered,
  parseModuleFunctionDeregistered,
  parseModuleFunctionRegistered,
  parseModuleResourceInstanceCreated,
  parseModuleResourceInstanceDeleted,
  parseModuleTriggerDeregistered,
  parseModuleTriggerRegistered,
  parseModuleWidgetDeregistered,
  parseModuleWidgetRegistered,
} from "../module-event-handlers";
import { parseWorkflowCreated, parseWorkflowDeleted, parseWorkflowUpdated } from "../workflow-event-handlers";
import { parseSceneCreated, parseSceneDeleted, parseSceneUpdated } from "../scene-event-handlers";
import { parseAlertCreated, parseAlertUpdated } from "../alert-log-handlers";
import { validateWorkflowDefinition } from "../workflow/validate-definition";

export const workflowsExecutionRoutes = {
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
    if (response.status?.code !== "OK") {
      this.logger.error("Failed to get workflows", {
        error: response.status?.message,
        code: response.status?.code,
      });
      throw new Error(response.status?.message || "Failed to get workflows");
    }
    this.logger.info("Retrieved available workflows", {
      count: response.workflows?.length || 0,
    });

    // Get recent executions for each workflow
    const workflowsWithStatus = await Promise.all(
      (response.workflows || []).map(async (wf) => {
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
    if (workflowsResponse.status?.code !== "OK") {
      throw new Error("Failed to find workflows");
    }

    const foundWorkflow = workflowsResponse.workflows?.find(
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
    const execResponse = await this.db.executeWorkflow(execReq);
    if (execResponse.status?.code !== "OK") {
      this.logger.error("Failed to execute workflow", {
        workflowId: foundWorkflow.id,
        workflowName,
        error: execResponse.status?.message,
        correlationId,
      });
      throw new Error(execResponse.status?.message || "Failed to trigger workflow");
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
    const response = await this.db.getWorkflowExecution(req);
    if (response.status?.code !== "OK") {
      this.logger.error("Failed to get workflow execution", {
        executionId,
        error: response.status?.message,
      });
      throw new Error(response.status?.message || "Failed to get workflow status");
    }
    if (!response.execution) {
      this.logger.warn("Workflow execution not found", { executionId });
      throw new Error("Workflow execution not found");
    }

    const exec = response.execution;

    // Get workflow name
    const workflowReq: workflow.GetWorkflowRequest = {
      id: exec.workflowId,
    };
    const workflowResponse = await this.db.getWorkflow(workflowReq);
    const workflowName = workflowResponse.workflow?.name || "Unknown";

    // Calculate progress based on steps
    const steps = exec.steps || [];
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
      const foundWorkflow = workflowsResponse.workflows?.find(
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
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to get workflow history");
    }

    // Get workflow names for each execution
    const executionsWithNames = await Promise.all(
      (response.executions || []).map(async (exec) => {
        const workflowReq: workflow.GetWorkflowRequest = {
          id: exec.workflowId,
        };
        const workflowResponse = await this.db.getWorkflow(workflowReq);
        const workflowName = workflowResponse.workflow?.name || "Unknown";

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
    const response = await this.db.cancelWorkflowExecution(req);
    if (response.code !== "OK") {
      this.logger.error("Failed to cancel workflow", {
        executionId,
        error: response.message,
      });
      throw new Error(response.message || "Failed to cancel workflow");
    }
    this.logger.info("Workflow cancelled successfully", { executionId });
  }
};
