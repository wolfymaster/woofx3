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

export const workflowsRoutes = {
  async getWorkflows(query?: { accountId?: string; enabled?: boolean; page?: number; pageSize?: number }): Promise<{
    workflows: WorkflowItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const applicationId =
      query?.accountId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.accountId)
        ? query.accountId
        : await this.ensureApplicationId();
    const response = await this.db.listWorkflows({
      applicationId,
      includeDisabled: query?.enabled === undefined ? true : !query.enabled,
      page,
      pageSize,
      sortBy: "",
      sortDesc: false,
    });
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to list workflows");
    }
    return {
      workflows: (response.workflows ?? []).map((wf) => this.workflowToItem(wf)),
      total: response.totalCount ?? 0,
      page: response.page ?? page,
      pageSize: response.pageSize ?? pageSize,
    };
  },

  async getWorkflow(id: string): Promise<WorkflowItem | null> {
    this.logger.info("Getting workflow", { id });
    const response = await this.db.getWorkflow({ id });
    if (response.status?.code !== "OK" || !response.workflow) {
      this.logger.warn("Workflow not found", { id });
      return null;
    }
    this.logger.info("Retrieved workflow", { id, name: response.workflow.name });
    return this.workflowToItem(response.workflow);
  },

  async createWorkflow(data: CreateWorkflowInput): Promise<WorkflowMutationResult> {
    // DB mints the id, so we can't validate with a stable id here. Run the
    // validation with a placeholder and then swap in the real id before
    // storing + emitting. All id references inside the definition (e.g.
    // dependsOn) refer to TASK ids, so the workflow id itself is inert.
    const placeholderId = "pending";
    const preValidation = validateWorkflowDefinition({ id: placeholderId, ...data.definition });
    if (!preValidation.ok) {
      throw new Error(
        `Invalid workflow definition: ${preValidation.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
      );
    }

    this.logger.info("Creating workflow", { name: data.definition.name });
    const applicationId = data.accountId || (await this.ensureApplicationId());

    // Steps and trigger are persisted as raw JSON; the engine reads
    // them directly off the workflow row. The definition's `id` is
    // assigned by the DB on insert, so the initial write uses a
    // placeholder id in the in-memory `storedDefinition`.
    const response = await this.db.createWorkflow({
      name: data.definition.name,
      description: data.definition.description ?? "",
      applicationId,
      createdBy: "",
      enabled: false,
      stepsJson: JSON.stringify(data.definition.tasks ?? []),
      triggerJson: JSON.stringify(data.definition.trigger),
      variables: {},
      onSuccess: "",
      onFailure: "",
      maxRetries: 0,
      timeoutSeconds: 0,
      createdByType: "USER",
      createdByRef: "",
    });
    if (response.status?.code !== "OK" || !response.workflow) {
      throw new Error(response.status?.message || "Failed to create workflow");
    }

    const createdId = response.workflow.id ?? "";
    const storedDefinition: WorkflowDefinition = { id: createdId, ...data.definition };

    this.logger.info("Created workflow", { id: createdId, name: storedDefinition.name });

    const createdAt = timestampToIso(response.workflow.createdAt);
    const updatedAt = timestampToIso(response.workflow.updatedAt);

    void this.emitWorkflowWebhook({
      type: EngineEventType.WORKFLOW_CREATED,
      applicationId,
      correlationKey: data.correlationKey,
      workflow: {
        id: createdId,
        definition: storedDefinition,
        isEnabled: false,
        createdAt,
        updatedAt,
      },
    });

    return { id: createdId, definition: storedDefinition, isEnabled: false };
  },

  async updateWorkflow(id: string, data: UpdateWorkflowInput): Promise<WorkflowMutationResult | null> {
    if (data.definition.id !== id) {
      throw new Error(`definition.id (${data.definition.id}) must match path id (${id})`);
    }
    const validation = validateWorkflowDefinition(data.definition);
    if (!validation.ok) {
      throw new Error(
        `Invalid workflow definition: ${validation.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
      );
    }

    this.logger.info("Updating workflow", { id });
    const existing = await this.db.getWorkflow({ id });
    if (existing.status?.code !== "OK" || !existing.workflow) {
      this.logger.warn("Workflow not found for update", { id });
      return null;
    }

    const response = await this.db.updateWorkflow({
      id,
      name: data.definition.name,
      description: data.definition.description ?? "",
      enabled: existing.workflow.enabled ?? false,
      stepsJson: JSON.stringify(data.definition.tasks ?? []),
      triggerJson: JSON.stringify(data.definition.trigger),
      variables: existing.workflow.variables ?? {},
      onSuccess: existing.workflow.onSuccess ?? "",
      onFailure: existing.workflow.onFailure ?? "",
      maxRetries: existing.workflow.maxRetries ?? 0,
      timeoutSeconds: existing.workflow.timeoutSeconds ?? 0,
    });
    if (response.status?.code !== "OK" || !response.workflow) {
      return null;
    }

    this.logger.info("Updated workflow", { id, name: response.workflow.name });

    const applicationId = await this.ensureApplicationId();
    const isEnabled = response.workflow.enabled ?? false;
    const createdAt = timestampToIso(existing.workflow.createdAt);
    const updatedAt = timestampToIso(response.workflow.updatedAt);

    void this.emitWorkflowWebhook({
      type: EngineEventType.WORKFLOW_UPDATED,
      applicationId,
      correlationKey: data.correlationKey,
      workflow: {
        id,
        definition: data.definition,
        isEnabled,
        createdAt,
        updatedAt,
      },
    });

    return { id, definition: data.definition, isEnabled };
  },

  async deleteWorkflow(id: string, correlationKey?: string): Promise<boolean> {
    const applicationId = await this.ensureApplicationId();
    this.logger.info("Deleting workflow", { id });
    const response = await this.db.deleteWorkflow({ id });
    const deleted = response.code === "OK";
    this.logger.info("Workflow deleted", { id, success: deleted });
    if (deleted) {
      void this.emitWorkflowWebhook({
        type: EngineEventType.WORKFLOW_DELETED,
        applicationId,
        correlationKey,
        workflowId: id,
      });
    }
    return deleted;
  },

  async setWorkflowEnabled(
    id: string,
    isEnabled: boolean,
    correlationKey?: string
  ): Promise<{ id: string; isEnabled: boolean }> {
    const existing = await this.db.getWorkflow({ id });
    if (existing.status?.code !== "OK" || !existing.workflow) {
      throw new Error("Workflow not found");
    }
    // Toggle enabled without rewriting the workflow definition —
    // pass the existing JSON columns through unchanged.
    const response = await this.db.updateWorkflow({
      id,
      name: existing.workflow.name ?? "",
      description: existing.workflow.description ?? "",
      enabled: isEnabled,
      stepsJson: existing.workflow.stepsJson ?? "",
      triggerJson: existing.workflow.triggerJson ?? "",
      variables: existing.workflow.variables ?? {},
      onSuccess: existing.workflow.onSuccess ?? "",
      onFailure: existing.workflow.onFailure ?? "",
      maxRetries: existing.workflow.maxRetries ?? 0,
      timeoutSeconds: existing.workflow.timeoutSeconds ?? 0,
    });
    if (response.status?.code !== "OK" || !response.workflow) {
      throw new Error("Failed to toggle workflow enabled state");
    }

    const applicationId = await this.ensureApplicationId();
    const definition = rebuildWorkflowDefinition(existing.workflow);
    if (definition) {
      const createdAt = timestampToIso(existing.workflow.createdAt);
      const updatedAt = timestampToIso(response.workflow.updatedAt);
      void this.emitWorkflowWebhook({
        type: EngineEventType.WORKFLOW_UPDATED,
        applicationId,
        correlationKey,
        workflow: {
          id,
          definition,
          isEnabled,
          createdAt,
          updatedAt,
        },
      });
    }

    return { id, isEnabled };
  },

  async getWorkflowRuns(query?: { workflowId?: string; accountId?: string; limit?: number }): Promise<
    Array<{
      id: string;
      workflowId: string;
      workflowName: string;
      status: string;
      startedAt: string;
      duration: number;
      trigger: string;
    }>
  > {
    const applicationId = await this.ensureApplicationId();
    const req: workflow.ListWorkflowExecutionsRequest = {
      workflowId: query?.workflowId || "",
      applicationId,
      status: "",
      startedBy: "",
      from: protoscript.Timestamp.initialize(),
      to: protoscript.Timestamp.initialize(),
      page: 1,
      pageSize: query?.limit || 10,
      sortBy: "startedAt",
      sortDesc: true,
    };

    const response = await this.db.listWorkflowExecutions(req);
    if (response.status?.code !== "OK") {
      // Fall back to empty array on error
      return [];
    }

    // Get workflow names and calculate durations
    const runs = await Promise.all(
      (response.executions || []).map(async (exec) => {
        // Get workflow name
        const workflowReq: workflow.GetWorkflowRequest = {
          id: exec.workflowId,
        };
        const workflowResponse = await this.db.getWorkflow(workflowReq);
        const workflowName = workflowResponse.workflow?.name || "Unknown Workflow";

        // Calculate startedAt timestamp
        const startedAt = exec.startedAt
          ? new Date(Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000).toISOString()
          : "";

        // Calculate duration in ms
        let duration = 0;
        if (exec.startedAt && exec.completedAt) {
          const startMs = Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000;
          const endMs = Number(exec.completedAt.seconds) * 1000 + exec.completedAt.nanos / 1000000;
          duration = endMs - startMs;
        } else if (exec.startedAt) {
          // Still running - calculate from now
          const startMs = Number(exec.startedAt.seconds) * 1000 + exec.startedAt.nanos / 1000000;
          duration = Date.now() - startMs;
        }

        // Extract trigger from inputs metadata if available
        const trigger = (exec.inputs?.trigger as string) || "manual";

        return {
          id: exec.id,
          workflowId: exec.workflowId,
          workflowName,
          status: exec.status,
          startedAt,
          duration: Math.round(duration),
          trigger,
        };
      })
    );

    return runs;
  }
};
