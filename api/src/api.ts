import type { PingResponse, Woofx3EngineApi } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type * as command from "@woofx3/db/command.pb";
import type { Trigger } from "@woofx3/db/module_trigger.pb";
import type * as treat from "@woofx3/db/treat.pb";
import type * as user from "@woofx3/db/user.pb";
import type * as workflow from "@woofx3/db/workflow.pb";
import type NATSClient from "@woofx3/nats/src/client";
import { RpcTarget } from "capnweb";
import * as protoscript from "protoscript";
import type { DbClient } from "./db-client";
import {
  parseModuleTriggerRegistered,
  parseModuleActionRegistered,
} from "./module-event-handlers";
import type { WebhookClient } from "./webhook-client";

/**
 * Helper to create a protoscript.Timestamp from a Date
 */
function timestampFromDate(date: Date): protoscript.Timestamp {
  const seconds = Math.floor(date.getTime() / 1000);
  const nanos = (date.getTime() % 1000) * 1000000;
  return {
    seconds: BigInt(seconds),
    nanos,
  };
}

/**
 * Response payload returned by uninstallModule / uninstallEngineModule.
 * The actual removal runs asynchronously in the engine; the caller receives
 * `requested: true` immediately, then learns the outcome via the webhook
 * events `module.deleted` or `module.delete_failed`, both of which carry
 * `moduleKey` for correlation with the originating install.
 */
export interface UninstallModuleResponse {
  requested: boolean;
}

interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  accountId: string;
  isEnabled: boolean;
  steps: Array<{ id: string; name: string; type: string; action?: string; parameters?: Record<string, unknown> }>;
  trigger?: { type: string; event: string; condition?: Record<string, unknown> };
  stats: { runsToday: number; successRate: number };
  createdAt: string;
  updatedAt: string;
}

/**
 * UI-focused API interface exposed via capnweb.
 * Methods represent user actions and use cases rather than database operations.
 */
interface ApiOptions {
  db: DbClient;
  nats: NATSClient | null;
  barkloaderUrl: string;
  logger: SharedLogger;
}

export class Api extends RpcTarget implements Woofx3EngineApi {
  private triggerSubscribers = new Set<{
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }>();
  private webhookClient: WebhookClient | null = null;
  private authInvalidate: (() => void) | null = null;

  private db: DbClient;
  private nats: NATSClient | null;
  private applicationId: string | null = null;
  private barkloaderUrl: string;
  private logger: SharedLogger;

  constructor(opts: ApiOptions) {
    super();
    if (!opts.db) {
      throw new Error("ApiOptions.db is required");
    }
    if (!opts.barkloaderUrl) {
      throw new Error("ApiOptions.barkloaderUrl is required");
    }
    this.db = opts.db;
    this.nats = opts.nats;
    this.barkloaderUrl = opts.barkloaderUrl;
    this.logger = opts.logger;
  }

  async ping(): Promise<PingResponse> {
    return { status: "ok", instanceId: this.applicationId ?? "pending" };
  }

  async deleteClient(clientId: string): Promise<{ success: boolean; message: string }> {
    this.logger.info("Deleting client", { clientId });
    const resp = await this.db.getClientByClientID(clientId);
    if (!resp.client) {
      return { success: false, message: "Client not found" };
    }
    await this.db.deleteClient(resp.client.id);
    if (this.authInvalidate) {
      this.authInvalidate();
    }
    if (this.webhookClient) {
      await this.webhookClient.refreshCallbackUrls();
    }
    this.logger.info("Client deleted", { clientId });
    return { success: true, message: "Client deleted" };
  }

  setWebhookClient(client: WebhookClient): void {
    this.webhookClient = client;
  }

  setAuthInvalidate(fn: () => void): void {
    this.authInvalidate = fn;
  }

  setApplicationId(applicationId: string): void {
    this.applicationId = applicationId;
    if (this.webhookClient) {
      this.webhookClient.setApplicationId(applicationId);
    }
  }

  private async ensureApplicationId(): Promise<string> {
    if (this.applicationId) {
      return this.applicationId;
    }
    const app = await this.db.getDefaultApplication();
    if (!app) {
      throw new Error("No default application; complete UI onboarding first");
    }
    this.applicationId = app.id;
    if (this.webhookClient) {
      this.webhookClient.setApplicationId(app.id);
    }
    return app.id;
  }

  async initSubscriptions(): Promise<void> {
    if (!this.nats) {
      this.logger.warn("NATS client not available, skipping subscriptions");
      return;
    }

    this.logger.info("Initializing NATS subscriptions for module events");

    await this.nats.subscribe("db.module.trigger.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.trigger.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleTriggerRegistered(ce);
        this.logger.info("Parsed module.trigger.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          triggerCount: event.triggers.length,
          clientId,
        });

        await this.notifyTriggerChange(event.moduleKey);

        if (this.webhookClient) {
          this.logger.info("Sending module.trigger.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.trigger.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.trigger.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.action.registered.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.action.registered.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const { clientId, event } = parseModuleActionRegistered(ce);
        this.logger.info("Parsed module.action.registered", {
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          actionCount: event.actions.length,
          clientId,
        });

        if (this.webhookClient) {
          this.logger.info("Sending module.action.registered to webhook client", {
            moduleKey: event.moduleKey,
            clientId,
          });
          await this.webhookClient.send(event, clientId || undefined);
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.action.registered");
        }
      } catch (err) {
        this.logger.error("Failed to handle module.action.registered NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.installed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.installed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          version?: string;
        };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.installed event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleVersion = payload.version ?? "";
        const moduleKey = payload.module_key ?? "";

        if (this.webhookClient) {
          this.logger.info("Sending module.installed to webhook client", {
            moduleName,
            moduleVersion,
            moduleKey,
            clientId,
          });
          await this.webhookClient.send(
            {
              type: "module.installed",
              moduleName,
              version: moduleVersion,
              moduleKey,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.installed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module installed NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.deleted.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.deleted.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as { module_id?: string; module_name?: string; module_key?: string };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.deleted event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleKey = payload.module_key ?? "";
        if (this.webhookClient) {
          await this.webhookClient.send(
            {
              type: "module.deleted",
              moduleName,
              moduleKey,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.deleted");
        }
      } catch (err) {
        this.logger.error("Failed to handle module deleted NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.delete_failed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.delete_failed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          error?: string;
          in_use_resources?: Array<{
            resource_id?: string;
            resource_type?: string;
            resource_name?: string;
            used_by?: Array<{ source_type?: string; source_id?: string; source_name?: string; context?: string }>;
          }>;
        };
        const clientId = (ce.client_id as string) ?? "";
        const moduleName = payload.module_name ?? "";
        const moduleKey = payload.module_key ?? "";
        const error = payload.error ?? "Unknown error";
        const inUseResources = (payload.in_use_resources ?? []).map((r) => ({
          resourceId: r.resource_id ?? "",
          resourceType: r.resource_type ?? "",
          resourceName: r.resource_name ?? "",
          usedBy: (r.used_by ?? []).map((u) => ({
            sourceType: u.source_type ?? "",
            sourceId: u.source_id ?? "",
            sourceName: u.source_name ?? "",
            context: u.context ?? "",
          })),
        }));
        this.logger.info("Parsed module.delete_failed event", {
          moduleName,
          moduleKey,
          error,
          inUseCount: inUseResources.length,
          clientId,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(
            {
              type: "module.delete_failed",
              moduleName,
              moduleKey,
              error,
              inUseResources,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.delete_failed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module delete_failed NATS event", { err });
      }
    });

    await this.nats.subscribe("db.module.install_failed.*", async (msg) => {
      this.logger.info("Received NATS message on db.module.install_failed.*", { subject: msg.subject });
      try {
        const ce = msg.json() as Record<string, unknown>;
        const payload = (ce.data ?? ce) as {
          module_id?: string;
          module_name?: string;
          module_key?: string;
          version?: string;
          error?: string;
        };
        const clientId = (ce.client_id as string) ?? "";
        this.logger.info("Parsed module.install_failed event", { payload, clientId });
        const moduleName = payload.module_name ?? "";
        const moduleVersion = payload.version ?? "";
        const moduleKey = payload.module_key ?? "";
        const errorMsg = payload.error ?? "Unknown error";
        this.logger.error("Module install failed", { moduleName, moduleVersion, moduleKey, error: errorMsg, clientId });

        if (this.webhookClient) {
          this.logger.info("Sending module.install_failed to webhook client", {
            moduleName,
            moduleVersion,
            moduleKey,
            error: errorMsg,
            clientId,
          });
          await this.webhookClient.send(
            {
              type: "module.install_failed",
              moduleName,
              version: moduleVersion,
              moduleKey,
              error: errorMsg,
            },
            clientId || undefined
          );
        } else {
          this.logger.warn("No webhook client set, skipping callback for module.install_failed");
        }
      } catch (err) {
        this.logger.error("Failed to handle module install_failed NATS event", { err });
      }
    });

    this.logger.info("NATS subscriptions initialized for module events");
  }

  async subscribeTriggerChanges(callback: {
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }): Promise<void> {
    this.triggerSubscribers.add(callback);
  }

  private async notifyTriggerChange(moduleName: string): Promise<void> {
    type Subscriber = { onTriggerChange(event: { type: string; moduleName: string }): Promise<void> };
    const dead: Subscriber[] = [];
    for (const cb of this.triggerSubscribers) {
      try {
        await cb.onTriggerChange({ type: "registered", moduleName });
      } catch {
        dead.push(cb);
      }
    }
    for (const cb of dead) {
      this.triggerSubscribers.delete(cb);
    }
  }

  // ==================== Workflows ====================

  /**
   * Get available workflows for the UI to display.
   * Returns workflows with their current status and recent execution info.
   */
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
  }

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
  }

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
  }

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
  }

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

  // ==================== Commands ====================

  /**
   * Get available commands for a user.
   * Returns commands that the user can execute, with their current state.
   * @param _username - Optional username (reserved for future permission checks)
   */
  async getAvailableCommands(_username?: string): Promise<{
    commands: Array<{
      id: string;
      name: string;
      type: string;
      cooldown: number;
      enabled: boolean;
    }>;
  }> {
    this.logger.info("Getting available commands", { username: _username });
    const applicationId = await this.ensureApplicationId();
    const req: command.ListCommandsRequest = {
      applicationId,
      includeDisabled: false,
    };
    const response = await this.db.listCommands(req);
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to get commands");
    }

    return {
      commands: (response.commands || []).map((cmd) => ({
        id: cmd.id,
        name: cmd.command,
        type: cmd.type,
        cooldown: cmd.cooldown,
        enabled: cmd.enabled,
      })),
    };
  }

  /**
   * Execute a command by name.
   * This would typically trigger the command execution via events.
   */
  async executeCommand(
    commandName: string,
    username: string,
    args: Record<string, string> = {}
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.info("Executing command", { commandName, username, args: Object.keys(args) });
    const applicationId = await this.ensureApplicationId();
    // Get the command
    const cmdReq: command.GetCommandRequest = {
      command: commandName,
      applicationId,
      username,
    };
    const cmdResponse = await this.db.getCommand(cmdReq);
    if (cmdResponse.status?.code !== "OK" || !cmdResponse.command) {
      throw new Error("Command not found");
    }

    if (!cmdResponse.command.enabled) {
      throw new Error("Command is disabled");
    }

    // Publish an event to trigger the command execution
    await this.publishEvent("command.execute", {
      command: commandName,
      username,
      args,
      applicationId,
    });

    this.logger.info("Command executed", { commandName, username });
    return {
      success: true,
      message: `Command "${commandName}" executed`,
    };
  }

  // ==================== User Actions ====================

  /**
   * Get user profile and stats for display in the UI.
   */
  async getUserProfile(userId: string): Promise<{
    id: string;
    username: string;
    treats: {
      total: number;
      points: number;
    };
    stats?: Record<string, unknown>;
  }> {
    // Get user
    const userReq: user.GetUserRequest = {
      id: userId,
    };
    const userResponse = await this.db.getUser(userReq);
    if (userResponse.status?.code !== "OK" || !userResponse.user) {
      throw new Error("User not found");
    }

    // Get treats summary (last 30 days)
    const applicationId = await this.ensureApplicationId();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const treatsReq: treat.GetUserTreatsSummaryRequest = {
      userId,
      applicationId,
      fromDate: timestampFromDate(thirtyDaysAgo),
      toDate: timestampFromDate(now),
    };
    const treatsResponse = await this.db.getUserTreatsSummary(treatsReq);
    const treatsSummary = treatsResponse.summary;

    return {
      id: userResponse.user.id,
      username: userResponse.user.username,
      treats: {
        total: treatsSummary?.totalTreats || 0,
        points: treatsSummary?.totalPoints || 0,
      },
    };
  }

  /**
   * Award treats to a user (UI action).
   */
  async awardTreatsToUser(
    userId: string,
    treatType: string,
    title: string,
    description: string,
    points: number,
    awardedBy: string,
    imageUrl: string = "",
    expiresInDays?: number
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const expiresAt = expiresInDays
      ? timestampFromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000))
      : protoscript.Timestamp.initialize();

    const applicationId = await this.ensureApplicationId();
    const req: treat.AwardTreatRequest = {
      userId,
      treatType,
      title,
      description,
      points,
      imageUrl,
      awardedBy,
      applicationId,
      metadata: {},
      expiresAt,
    };
    const response = await this.db.awardTreat(req);
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to award treat");
    }

    return {
      success: true,
      message: `Awarded treat "${title}" to user`,
    };
  }

  // ==================== Events ====================

  /**
   * Simulate a Twitch event for testing workflows.
   * This is useful for the UI to manually trigger workflows that respond to Twitch events.
   */
  async simulateTwitchEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.info("Simulating Twitch event", { eventType, eventData });
    const subject = `twitch.${eventType}`;
    await this.publishEvent(`twitch.${eventType}`, eventData, subject);

    this.logger.info("Twitch event simulated successfully", { eventType, subject });
    return {
      success: true,
      message: `Simulated Twitch event: ${eventType}`,
    };
  }

  /**
   * Trigger a workflow by publishing an event.
   * Useful for triggering workflows that listen to specific event types.
   */
  async triggerEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.publishEvent(eventType, eventData);

    return {
      success: true,
      message: `Published event: ${eventType}`,
    };
  }

  // ==================== Dashboard/Overview ====================

  /**
   * Get system overview for the dashboard.
   */
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

  // ==================== Users & Teams ====================

  private currentUser = {
    id: "user-1",
    email: "streamer@example.com",
    displayName: "ProStreamer",
    role: "owner",
    teamIds: ["team-1", "team-2"],
    accountIds: ["account-1", "account-2", "account-3"],
    createdAt: "2024-01-01T00:00:00Z",
  };

  async getUser(): Promise<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    teamIds: string[];
    accountIds: string[];
    createdAt: string;
  }> {
    return { ...this.currentUser };
  }

  async updateUser(input: { displayName?: string; email?: string }): Promise<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    teamIds: string[];
    accountIds: string[];
    createdAt: string;
  }> {
    if (input.displayName !== undefined) this.currentUser.displayName = input.displayName;
    if (input.email !== undefined) this.currentUser.email = input.email;
    return { ...this.currentUser };
  }

  private teams = [
    {
      id: "team-1",
      name: "Main Stream Team",
      slug: "main-stream",
      ownerId: "user-1",
      createdAt: "2024-01-15T00:00:00Z",
    },
    { id: "team-2", name: "Collab Squad", slug: "collab-squad", ownerId: "user-1", createdAt: "2024-06-01T00:00:00Z" },
  ];

  async getTeams(): Promise<
    Array<{
      id: string;
      name: string;
      slug: string;
      ownerId: string;
      createdAt: string;
    }>
  > {
    return [...this.teams];
  }

  async getTeam(id: string): Promise<{
    id: string;
    name: string;
    slug: string;
    ownerId: string;
    createdAt: string;
  } | null> {
    return this.teams.find((t) => t.id === id) || null;
  }

  async getTeamMembers(teamId: string): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      status: string;
      joinedAt: string;
      avatarUrl: string;
    }>
  > {
    return [
      {
        id: "member-1",
        name: "ProStreamer",
        email: "streamer@example.com",
        role: "owner",
        status: "active",
        joinedAt: "2024-01-15T00:00:00Z",
        avatarUrl: "",
      },
      {
        id: "member-2",
        name: "ModMaster",
        email: "mod@example.com",
        role: "admin",
        status: "active",
        joinedAt: "2024-02-01T00:00:00Z",
        avatarUrl: "",
      },
      {
        id: "member-3",
        name: "NewHelper",
        email: "helper@example.com",
        role: "member",
        status: "invited",
        joinedAt: "2024-12-01T00:00:00Z",
        avatarUrl: "",
      },
    ];
  }

  // ==================== Accounts ====================

  private accounts = [
    {
      id: "account-1",
      name: "MainTwitch",
      displayName: "WoofyStream",
      slug: "woofy-stream",
      platform: "twitch",
      teamId: "team-1",
      status: "connected",
      createdAt: "2024-01-15T00:00:00Z",
    },
    {
      id: "account-2",
      name: "YouTubeGaming",
      displayName: "Woofy Gaming",
      slug: "woofy-gaming",
      platform: "youtube",
      teamId: "team-1",
      status: "connected",
      createdAt: "2024-03-01T00:00:00Z",
    },
    {
      id: "account-3",
      name: "CollabTwitch",
      displayName: "Collab Stream",
      slug: "collab-stream",
      platform: "twitch",
      teamId: "team-2",
      status: "connected",
      createdAt: "2024-06-15T00:00:00Z",
    },
  ];

  async getAccounts(teamId?: string): Promise<
    Array<{
      id: string;
      name: string;
      displayName: string;
      slug: string;
      platform: string;
      teamId: string;
      status: string;
      createdAt: string;
    }>
  > {
    const filtered = teamId ? this.accounts.filter((a) => a.teamId === teamId) : this.accounts;
    return filtered.map((a) => ({ ...a }));
  }

  async getAccount(id: string): Promise<{
    id: string;
    name: string;
    displayName: string;
    slug: string;
    platform: string;
    teamId: string;
    status: string;
    createdAt: string;
  } | null> {
    const account = this.accounts.find((a) => a.id === id);
    return account ? { ...account } : null;
  }

  async updateAccount(
    id: string,
    input: { name?: string; displayName?: string }
  ): Promise<{
    id: string;
    name: string;
    displayName: string;
    slug: string;
    platform: string;
    teamId: string;
    status: string;
    createdAt: string;
  } | null> {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) return null;
    if (input.name !== undefined) account.name = input.name;
    if (input.displayName !== undefined) account.displayName = input.displayName;
    return { ...account };
  }

  async getStreamStatus(accountId: string): Promise<{
    isLive: boolean;
    uptime: string;
    viewerCount: number;
    startedAt?: string;
  }> {
    // Simulate live status for account-1, offline for others
    if (accountId === "account-1") {
      return {
        isLive: true,
        uptime: "02:34:56",
        viewerCount: 1247,
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 - 34 * 60 * 1000 - 56 * 1000).toISOString(),
      };
    }
    return {
      isLive: false,
      uptime: "00:00:00",
      viewerCount: 0,
    };
  }

  // ==================== Modules ====================

  private getBarkloaderBaseUrl(): string {
    return this.barkloaderUrl.endsWith("/") ? this.barkloaderUrl.slice(0, -1) : this.barkloaderUrl;
  }

  private async barkloaderRequest(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.getBarkloaderBaseUrl()}${path}`, init);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Barkloader request failed (${response.status} ${response.statusText}): ${body || "empty body"}`);
    }
    return response;
  }

  async installModuleZip(
    fileName: string,
    zipBase64: string,
    context: { clientId: string; moduleKey?: string }
  ): Promise<{ success: boolean; message?: string; alreadyInstalled?: boolean }> {
    const clientId = context?.clientId;
    const moduleKey = context?.moduleKey;

    if (!clientId) {
      throw new Error("clientId is required to install a module");
    }

    this.logger.info("Installing module zip", { fileName, size: zipBase64.length, clientId, moduleKey });

    // Duplicate check: if the caller supplied a module_key, look it up first
    if (moduleKey) {
      const existing = await this.db.getModuleByModuleKey(moduleKey);
      if (existing) {
        this.logger.info("Module already installed, skipping upload", {
          clientId,
          moduleKey,
          moduleName: existing.name,
        });
        if (this.webhookClient) {
          await this.webhookClient.send(
            {
              type: "module.installed",
              moduleName: existing.name,
              version: existing.version,
              moduleKey,
              alreadyInstalled: true,
            },
            clientId || undefined
          );
        }
        return { success: true, message: "Module already installed", alreadyInstalled: true };
      }
    }

    const zipBytes = Buffer.from(zipBase64, "base64");
    const formData = new FormData();
    formData.append("file", new File([zipBytes], fileName, { type: "application/zip" }));
    formData.append("client_id", clientId);
    if (moduleKey) {
      formData.append("module_key", moduleKey);
    }

    const response = await this.barkloaderRequest("/functions", {
      method: "POST",
      body: formData,
    });
    const json = (await response.json()) as { message?: string };
    this.logger.info("Module zip installed", { clientId, moduleKey, fileName, message: json.message });
    return { success: true, message: json.message ?? "Module uploaded" };
  }

  async listEngineModules(): Promise<Array<{ name: string; version: string; state: string }>> {
    this.logger.info("Listing engine modules");
    const modules = await this.db.listModules();
    const result = modules
      .filter((m) => !!m.name)
      .map((m) => ({
        name: m.name,
        version: m.version ?? "",
        state: m.state ?? "active",
      }));
    this.logger.info("Listed engine modules", { count: result.length });
    return result;
  }

  async uninstallEngineModule(
    name: string,
    context?: { clientId?: string; moduleKey?: string },
  ): Promise<UninstallModuleResponse> {
    const clientId = context?.clientId;
    const moduleKey = context?.moduleKey;
    this.logger.info("Requesting engine module uninstall", { name, clientId, moduleKey });
    const params = new URLSearchParams();
    if (clientId) params.set("client_id", clientId);
    if (moduleKey) params.set("module_key", moduleKey);
    const qs = params.toString() ? `?${params.toString()}` : "";
    await this.barkloaderRequest(`/functions/${encodeURIComponent(name)}${qs}`, { method: "DELETE" });
    this.logger.info("Engine module uninstall request acknowledged", { name, clientId, moduleKey });
    // Success/failure is delivered asynchronously via webhook
    // (module.deleted or module.delete_failed), both carrying moduleKey.
    return { requested: true };
  }

  async getModules(query?: {
    category?: string;
    search?: string;
    installed?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{
    modules: Array<{
      id: string;
      name: string;
      description: string;
      version: string;
      author: string;
      isInstalled: boolean;
      iconUrl: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    this.logger.info("Getting modules", { query });
    const dbModules = await this.db.listModules();
    this.logger.info("Got modules", { count: dbModules.length });
    const normalized = dbModules
      .filter((m) => !!m.name)
      .map((m) => ({
        id: m.name,
        name: m.name,
        description: "",
        category: "integration",
        version: m.version ?? "",
        author: "Engine",
        isInstalled: true,
        iconUrl: "",
      }));
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 8;
    return {
      modules: normalized.slice((page - 1) * pageSize, page * pageSize),
      total: normalized.length,
      page,
      pageSize,
    };
  }

  async getModule(id: string): Promise<{
    id: string;
    name: string;
    description: string;
    category: string;
    version: string;
    author: string;
    isInstalled: boolean;
    iconUrl: string;
  } | null> {
    const found = await this.db.getModuleByName(id);
    if (!found) return null;
    return {
      id: found.name,
      name: found.name,
      description: "",
      category: "integration",
      version: found.version,
      author: "Engine",
      isInstalled: true,
      iconUrl: "",
    };
  }

  async uninstallModule(
    id: string,
    context?: { clientId?: string; moduleKey?: string },
  ): Promise<UninstallModuleResponse> {
    return this.uninstallEngineModule(id, context);
  }

  // ==================== Workflows (Extended) ====================

  private workflowToItem(wf: {
    id?: string;
    name?: string;
    description?: string;
    applicationId?: string;
    enabled?: boolean;
    variables?: Record<string, string | undefined>;
    createdAt?: { seconds?: bigint };
    updatedAt?: { seconds?: bigint };
  }): WorkflowItem {
    const steps = wf.variables?._steps ? JSON.parse(wf.variables._steps) : [];
    const trigger = wf.variables?._trigger ? JSON.parse(wf.variables._trigger) : undefined;
    const createdAt = wf.createdAt?.seconds
      ? new Date(Number(wf.createdAt.seconds) * 1000).toISOString()
      : new Date().toISOString();
    const updatedAt = wf.updatedAt?.seconds
      ? new Date(Number(wf.updatedAt.seconds) * 1000).toISOString()
      : new Date().toISOString();
    return {
      id: wf.id ?? "",
      name: wf.name ?? "",
      description: wf.description ?? "",
      accountId: wf.applicationId ?? "",
      isEnabled: wf.enabled ?? false,
      steps,
      trigger,
      stats: { runsToday: 0, successRate: 100 },
      createdAt,
      updatedAt,
    };
  }

  async getWorkflows(query?: { accountId?: string; enabled?: boolean; page?: number; pageSize?: number }): Promise<{
    workflows: WorkflowItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const applicationId = query?.accountId ?? (await this.ensureApplicationId());
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
  }

  async getWorkflow(id: string): Promise<WorkflowItem | null> {
    this.logger.info("Getting workflow", { id });
    const response = await this.db.getWorkflow({ id });
    if (response.status?.code !== "OK" || !response.workflow) {
      this.logger.warn("Workflow not found", { id });
      return null;
    }
    this.logger.info("Retrieved workflow", { id, name: response.workflow.name });
    return this.workflowToItem(response.workflow);
  }

  async createWorkflow(data: {
    name: string;
    description?: string;
    accountId: string;
    isEnabled?: boolean;
    steps?: Array<{ id: string; name: string; type: string; action?: string; parameters?: Record<string, unknown> }>;
    trigger?: { type: string; event: string; condition?: Record<string, unknown> };
  }): Promise<WorkflowItem> {
    this.logger.info("Creating workflow", { name: data.name, steps: data.steps?.length });
    const variables: Record<string, string> = {};
    if (data.steps) variables._steps = JSON.stringify(data.steps);
    if (data.trigger) variables._trigger = JSON.stringify(data.trigger);
    const applicationId = await this.ensureApplicationId();
    const response = await this.db.createWorkflow({
      name: data.name,
      description: data.description ?? "",
      applicationId,
      createdBy: "",
      enabled: data.isEnabled ?? false,
      steps: [],
      variables,
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
    this.logger.info("Created workflow", { id: response.workflow.id, name: response.workflow.name });
    return this.workflowToItem(response.workflow);
  }

  async updateWorkflow(
    id: string,
    data: { name?: string; description?: string; isEnabled?: boolean; steps?: unknown[]; trigger?: unknown }
  ): Promise<WorkflowItem | null> {
    this.logger.info("Updating workflow", { id, data: Object.keys(data) });
    const existing = await this.db.getWorkflow({ id });
    if (existing.status?.code !== "OK" || !existing.workflow) {
      this.logger.warn("Workflow not found for update", { id });
      return null;
    }
    const existingVars = existing.workflow.variables ?? {};
    const variables: Record<string, string> = {
      ...existingVars,
      ...(data.steps !== undefined ? { _steps: JSON.stringify(data.steps) } : {}),
      ...(data.trigger !== undefined ? { _trigger: JSON.stringify(data.trigger) } : {}),
    };
    // Remove old _nodes/_edges if present (migration cleanup)
    delete variables._nodes;
    delete variables._edges;
    const response = await this.db.updateWorkflow({
      id,
      name: data.name ?? existing.workflow.name ?? "",
      description: data.description ?? existing.workflow.description ?? "",
      enabled: data.isEnabled ?? existing.workflow.enabled ?? false,
      steps: existing.workflow.steps ?? [],
      variables,
      onSuccess: existing.workflow.onSuccess ?? "",
      onFailure: existing.workflow.onFailure ?? "",
      maxRetries: existing.workflow.maxRetries ?? 0,
      timeoutSeconds: existing.workflow.timeoutSeconds ?? 0,
    });
    if (response.status?.code !== "OK" || !response.workflow) return null;
    this.logger.info("Updated workflow", { id, name: response.workflow.name });
    return this.workflowToItem(response.workflow);
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    this.logger.info("Deleting workflow", { id });
    const response = await this.db.deleteWorkflow({ id });
    const deleted = response.code === "OK";
    this.logger.info("Workflow deleted", { id, success: deleted });
    return deleted;
  }

  private workflowRuns: Array<{
    id: string;
    workflowId: string;
    accountId: string;
    status: string;
    startedAt: string;
    duration: number;
    trigger: string;
  }> = [
    {
      id: "run-1",
      workflowId: "wf-1",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T04:30:00Z",
      duration: 1200,
      trigger: "follow",
    },
    {
      id: "run-2",
      workflowId: "wf-2",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T03:15:00Z",
      duration: 3500,
      trigger: "subscription",
    },
    {
      id: "run-3",
      workflowId: "wf-4",
      accountId: "account-1",
      status: "failed",
      startedAt: "2026-01-14T02:45:00Z",
      duration: 800,
      trigger: "cheer",
    },
    {
      id: "run-4",
      workflowId: "wf-1",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T01:00:00Z",
      duration: 950,
      trigger: "follow",
    },
    {
      id: "run-5",
      workflowId: "wf-6",
      accountId: "account-1",
      status: "running",
      startedAt: "2026-01-14T00:00:00Z",
      duration: 0,
      trigger: "stream.online",
    },
    {
      id: "run-6",
      workflowId: "wf-5",
      accountId: "account-2",
      status: "success",
      startedAt: "2026-01-13T22:30:00Z",
      duration: 450,
      trigger: "redemption",
    },
    {
      id: "run-7",
      workflowId: "wf-5",
      accountId: "account-2",
      status: "success",
      startedAt: "2026-01-13T21:00:00Z",
      duration: 380,
      trigger: "redemption",
    },
  ];

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

  // ==================== Assets ====================

  private mockAssets = [
    {
      id: "asset-1",
      name: "Follow Alert",
      type: "image",
      url: "/assets/follow.gif",
      accountId: "account-1",
      size: 256000,
      createdAt: "2024-06-01T00:00:00Z",
    },
    {
      id: "asset-2",
      name: "Sub Sound",
      type: "audio",
      url: "/assets/sub.mp3",
      accountId: "account-1",
      size: 512000,
      createdAt: "2024-06-15T00:00:00Z",
    },
    {
      id: "asset-3",
      name: "Raid Video",
      type: "video",
      url: "/assets/raid.mp4",
      accountId: "account-1",
      size: 2048000,
      createdAt: "2024-07-01T00:00:00Z",
    },
    {
      id: "asset-4",
      name: "Logo",
      type: "image",
      url: "/assets/logo.png",
      accountId: "account-1",
      size: 128000,
      createdAt: "2024-01-15T00:00:00Z",
    },
    {
      id: "asset-5",
      name: "Intro Music",
      type: "audio",
      url: "/assets/intro.mp3",
      accountId: "account-1",
      size: 1024000,
      createdAt: "2024-02-01T00:00:00Z",
    },
    {
      id: "asset-6",
      name: "Outro Video",
      type: "video",
      url: "/assets/outro.mp4",
      accountId: "account-1",
      size: 4096000,
      createdAt: "2024-03-01T00:00:00Z",
    },
    {
      id: "asset-7",
      name: "Emote Pack",
      type: "image",
      url: "/assets/emotes.zip",
      accountId: "account-1",
      size: 768000,
      createdAt: "2024-04-01T00:00:00Z",
    },
    {
      id: "asset-8",
      name: "Alert Sound",
      type: "audio",
      url: "/assets/alert.wav",
      accountId: "account-1",
      size: 384000,
      createdAt: "2024-05-01T00:00:00Z",
    },
    {
      id: "asset-9",
      name: "BRB Screen",
      type: "image",
      url: "/assets/brb.png",
      accountId: "account-2",
      size: 192000,
      createdAt: "2024-08-01T00:00:00Z",
    },
    {
      id: "asset-10",
      name: "Donation Sound",
      type: "audio",
      url: "/assets/donation.mp3",
      accountId: "account-2",
      size: 256000,
      createdAt: "2024-09-01T00:00:00Z",
    },
    {
      id: "asset-11",
      name: "Starting Soon",
      type: "video",
      url: "/assets/starting.mp4",
      accountId: "account-1",
      size: 3072000,
      createdAt: "2024-10-01T00:00:00Z",
    },
    {
      id: "asset-12",
      name: "Ending Screen",
      type: "image",
      url: "/assets/ending.png",
      accountId: "account-1",
      size: 256000,
      createdAt: "2024-11-01T00:00:00Z",
    },
  ];

  async getAssets(query?: {
    accountId?: string;
    type?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    assets: typeof this.mockAssets;
    total: number;
    page: number;
    pageSize: number;
  }> {
    let filtered = [...this.mockAssets];
    if (query?.accountId) filtered = filtered.filter((a) => a.accountId === query.accountId);
    if (query?.type) filtered = filtered.filter((a) => a.type === query.type);
    if (query?.search) filtered = filtered.filter((a) => a.name.toLowerCase().includes(query.search!.toLowerCase()));
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 12;
    return { assets: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  }

  async getAsset(id: string): Promise<(typeof this.mockAssets)[0] | null> {
    return this.mockAssets.find((a) => a.id === id) || null;
  }

  async createAsset(data: {
    name: string;
    type: string;
    url: string;
    accountId: string;
    size: number;
  }): Promise<{ id: string }> {
    const id = `asset-${Date.now()}`;
    this.mockAssets.push({ ...data, id, createdAt: new Date().toISOString() });
    return { id };
  }

  async deleteAsset(id: string): Promise<{ success: boolean }> {
    const idx = this.mockAssets.findIndex((a) => a.id === id);
    if (idx >= 0) this.mockAssets.splice(idx, 1);
    return { success: idx >= 0 };
  }

  // ==================== Scenes ====================

  private mockScenes = [
    {
      id: "scene-1",
      name: "Main Gaming",
      accountId: "account-1",
      widgets: [{ id: "w1", type: "camera", position: { x: 0, y: 0 }, size: { w: 400, h: 300 } }],
      createdAt: "2024-01-15T00:00:00Z",
    },
    {
      id: "scene-2",
      name: "Just Chatting",
      accountId: "account-1",
      widgets: [{ id: "w2", type: "chat", position: { x: 0, y: 0 }, size: { w: 300, h: 600 } }],
      createdAt: "2024-02-01T00:00:00Z",
    },
    {
      id: "scene-3",
      name: "BRB Screen",
      accountId: "account-1",
      widgets: [{ id: "w3", type: "image", position: { x: 0, y: 0 }, size: { w: 1920, h: 1080 } }],
      createdAt: "2024-03-01T00:00:00Z",
    },
  ];

  async getScenes(query?: { accountId?: string; page?: number; pageSize?: number }): Promise<{
    scenes: typeof this.mockScenes;
    total: number;
    page: number;
    pageSize: number;
  }> {
    let filtered = [...this.mockScenes];
    if (query?.accountId) filtered = filtered.filter((s) => s.accountId === query.accountId);
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 10;
    return { scenes: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  }

  async getScene(id: string): Promise<(typeof this.mockScenes)[0] | null> {
    return this.mockScenes.find((s) => s.id === id) || null;
  }

  async createScene(data: { name: string; accountId: string }): Promise<{ id: string }> {
    const id = `scene-${Date.now()}`;
    this.mockScenes.push({ ...data, id, widgets: [], createdAt: new Date().toISOString() });
    return { id };
  }

  async updateScene(id: string, data: Partial<(typeof this.mockScenes)[0]>): Promise<{ success: boolean }> {
    const idx = this.mockScenes.findIndex((s) => s.id === id);
    if (idx >= 0) Object.assign(this.mockScenes[idx], data);
    return { success: idx >= 0 };
  }

  async deleteScene(id: string): Promise<{ success: boolean }> {
    const idx = this.mockScenes.findIndex((s) => s.id === id);
    if (idx >= 0) this.mockScenes.splice(idx, 1);
    return { success: idx >= 0 };
  }

  // ==================== Dashboard Stats ====================

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

  // ==================== Chat & Stream Events ====================

  async getChatMessages(
    accountId: string,
    limit?: number
  ): Promise<
    Array<{
      id: string;
      user: string;
      message: string;
      timestamp: string;
      badges: string[];
      color: string;
    }>
  > {
    const messages = [
      {
        id: "msg-1",
        user: "CoolViewer42",
        message: "Hey everyone!",
        timestamp: "2026-01-13T23:30:00Z",
        badges: ["subscriber"],
        color: "#FF5733",
      },
      {
        id: "msg-2",
        user: "ModMaster",
        message: "Welcome to the stream!",
        timestamp: "2026-01-13T23:30:05Z",
        badges: ["moderator", "subscriber"],
        color: "#33FF57",
      },
      {
        id: "msg-3",
        user: "NewFollower",
        message: "Just followed! Love your content",
        timestamp: "2026-01-13T23:30:10Z",
        badges: [],
        color: "#3357FF",
      },
      {
        id: "msg-4",
        user: "BigDonor",
        message: "PogChamp",
        timestamp: "2026-01-13T23:30:15Z",
        badges: ["subscriber", "vip"],
        color: "#FF33F5",
      },
      {
        id: "msg-5",
        user: "ChattyPerson",
        message: "What game is this?",
        timestamp: "2026-01-13T23:30:20Z",
        badges: ["subscriber"],
        color: "#F5FF33",
      },
    ];
    return messages.slice(0, limit || 50);
  }

  async sendChatMessage(accountId: string, message: string): Promise<{ success: boolean; messageId: string }> {
    return { success: true, messageId: `msg-${Date.now()}` };
  }

  private streamEvents: Array<{
    id: string;
    accountId: string;
    type: string;
    user: string;
    amount?: number;
    message?: string;
    timestamp: string;
  }> = [
    { id: "evt-1", accountId: "account-1", type: "follow", user: "NewFollower123", timestamp: "2026-01-14T05:25:00Z" },
    {
      id: "evt-2",
      accountId: "account-1",
      type: "subscription",
      user: "LoyalSub",
      amount: 1,
      message: "Love the stream!",
      timestamp: "2026-01-14T05:20:00Z",
    },
    {
      id: "evt-3",
      accountId: "account-1",
      type: "cheer",
      user: "BitGiver",
      amount: 500,
      message: "Take my bits!",
      timestamp: "2026-01-14T05:15:00Z",
    },
    {
      id: "evt-4",
      accountId: "account-1",
      type: "raid",
      user: "FriendlyStreamer",
      amount: 42,
      timestamp: "2026-01-14T05:10:00Z",
    },
    {
      id: "evt-5",
      accountId: "account-1",
      type: "gift",
      user: "GiftMaster",
      amount: 5,
      message: "Gifting to the community!",
      timestamp: "2026-01-14T05:05:00Z",
    },
    {
      id: "evt-6",
      accountId: "account-1",
      type: "donation",
      user: "GenerousDonor",
      amount: 25,
      message: "Keep up the great work!",
      timestamp: "2026-01-14T05:00:00Z",
    },
    { id: "evt-7", accountId: "account-1", type: "follow", user: "AnotherFan", timestamp: "2026-01-14T04:55:00Z" },
    {
      id: "evt-8",
      accountId: "account-1",
      type: "subscription",
      user: "TierThreeSub",
      amount: 3,
      message: "Tier 3 hype!",
      timestamp: "2026-01-14T04:50:00Z",
    },
    { id: "evt-9", accountId: "account-2", type: "follow", user: "YTFollower", timestamp: "2026-01-14T04:45:00Z" },
    {
      id: "evt-10",
      accountId: "account-2",
      type: "donation",
      user: "SuperChat",
      amount: 10,
      message: "Great content!",
      timestamp: "2026-01-14T04:40:00Z",
    },
  ];

  async getStreamEvents(query?: { accountId: string; limit?: number; types?: string[] }): Promise<
    Array<{
      id: string;
      type: string;
      user: string;
      amount?: number;
      message?: string;
      timestamp: string;
    }>
  > {
    let filtered = [...this.streamEvents];

    // Filter by accountId (required)
    if (query?.accountId) {
      filtered = filtered.filter((e) => e.accountId === query.accountId);
    }

    // Filter by event types
    if (query?.types?.length) {
      filtered = filtered.filter((e) => query.types!.includes(e.type));
    }

    // Apply limit
    const limit = query?.limit || 20;
    filtered = filtered.slice(0, limit);

    // Return without accountId in response
    return filtered.map(({ accountId, ...event }) => event);
  }

  // ==================== Triggers & Actions ====================

  private triggers: Array<{
    id: string;
    moduleId: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    color?: string;
    config: {
      fields: Array<{
        id: string;
        name: string;
        type: string;
        label: string;
        description?: string;
        required?: boolean;
        placeholder?: string;
        defaultValue?: unknown;
        options?: Array<{ label: string; value: string }>;
        min?: number;
        max?: number;
        step?: number;
        unit?: string;
        mediaType?: string;
        validation?: { pattern?: string; message?: string };
      }>;
      supportsTiers?: boolean;
      tierLabel?: string;
    };
  }> = [
    {
      id: "trigger-chat-command",
      moduleId: "mod-1",
      name: "Chat Command",
      description: "When someone uses a chat command",
      icon: "MessageCircle",
      category: "chat",
      color: "text-blue-500",
      config: {
        fields: [
          { id: "command", name: "command", type: "string", label: "Command", required: true, placeholder: "!hello" },
          {
            id: "cooldown",
            name: "cooldown",
            type: "number",
            label: "Cooldown",
            unit: "seconds",
            min: 0,
            max: 3600,
            defaultValue: 5,
          },
          { id: "modOnly", name: "modOnly", type: "boolean", label: "Mods Only", defaultValue: false },
        ],
      },
    },
    {
      id: "trigger-follow",
      moduleId: "mod-2",
      name: "New Follower",
      description: "When someone follows the channel",
      icon: "UserPlus",
      category: "events",
      color: "text-green-500",
      config: { fields: [] },
    },
    {
      id: "trigger-subscription",
      moduleId: "mod-2",
      name: "Subscription",
      description: "When someone subscribes or resubscribes",
      icon: "Star",
      category: "events",
      color: "text-purple-500",
      config: {
        fields: [
          {
            id: "minMonths",
            name: "minMonths",
            type: "number",
            label: "Minimum Months",
            min: 0,
            max: 100,
            defaultValue: 0,
          },
        ],
        supportsTiers: true,
        tierLabel: "Subscription Tier",
      },
    },
    {
      id: "trigger-cheer",
      moduleId: "mod-2",
      name: "Cheer/Bits",
      description: "When someone cheers with bits",
      icon: "Gem",
      category: "events",
      color: "text-pink-500",
      config: {
        fields: [
          {
            id: "minBits",
            name: "minBits",
            type: "number",
            label: "Minimum Bits",
            min: 1,
            max: 100000,
            defaultValue: 1,
          },
        ],
      },
    },
    {
      id: "trigger-raid",
      moduleId: "mod-2",
      name: "Raid",
      description: "When another streamer raids the channel",
      icon: "Users",
      category: "events",
      color: "text-orange-500",
      config: {
        fields: [
          {
            id: "minViewers",
            name: "minViewers",
            type: "number",
            label: "Minimum Viewers",
            min: 0,
            max: 10000,
            defaultValue: 0,
          },
        ],
      },
    },
    {
      id: "trigger-redemption",
      moduleId: "mod-3",
      name: "Channel Point Redemption",
      description: "When someone redeems channel points",
      icon: "Gift",
      category: "engagement",
      color: "text-cyan-500",
      config: {
        fields: [
          {
            id: "rewardId",
            name: "rewardId",
            type: "string",
            label: "Reward ID",
            placeholder: "Leave empty for any reward",
          },
        ],
      },
    },
    {
      id: "trigger-stream-online",
      moduleId: "mod-8",
      name: "Stream Goes Live",
      description: "When the stream starts",
      icon: "Radio",
      category: "stream",
      color: "text-red-500",
      config: { fields: [] },
    },
    {
      id: "trigger-stream-offline",
      moduleId: "mod-8",
      name: "Stream Goes Offline",
      description: "When the stream ends",
      icon: "RadioOff",
      category: "stream",
      color: "text-gray-500",
      config: { fields: [] },
    },
  ];

  private actions: Array<{
    id: string;
    moduleId: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    color?: string;
    config: {
      fields: Array<{
        id: string;
        name: string;
        type: string;
        label: string;
        description?: string;
        required?: boolean;
        placeholder?: string;
        defaultValue?: unknown;
        options?: Array<{ label: string; value: string }>;
        min?: number;
        max?: number;
        step?: number;
        unit?: string;
        mediaType?: string;
        validation?: { pattern?: string; message?: string };
      }>;
    };
  }> = [
    {
      id: "action-show-alert",
      moduleId: "mod-2",
      name: "Show Alert",
      description: "Display an on-screen alert overlay",
      icon: "Bell",
      category: "alerts",
      color: "text-yellow-500",
      config: {
        fields: [
          { id: "message", name: "message", type: "string", label: "Alert Message", placeholder: "Thanks!" },
          {
            id: "duration",
            name: "duration",
            type: "number",
            label: "Duration",
            unit: "seconds",
            min: 1,
            max: 30,
            defaultValue: 5,
          },
          { id: "image", name: "image", type: "media", label: "Alert Image", mediaType: "image" },
        ],
      },
    },
    {
      id: "action-send-chat",
      moduleId: "mod-1",
      name: "Send Chat Message",
      description: "Send a message to chat",
      icon: "MessageSquare",
      category: "chat",
      color: "text-blue-500",
      config: {
        fields: [
          {
            id: "message",
            name: "message",
            type: "string",
            label: "Message",
            required: true,
            placeholder: "Hello {user}!",
          },
          {
            id: "delay",
            name: "delay",
            type: "number",
            label: "Delay",
            unit: "seconds",
            min: 0,
            max: 60,
            defaultValue: 0,
          },
        ],
      },
    },
    {
      id: "action-play-sound",
      moduleId: "mod-4",
      name: "Play Sound",
      description: "Play a sound effect",
      icon: "Volume2",
      category: "audio",
      color: "text-green-500",
      config: {
        fields: [
          { id: "sound", name: "sound", type: "media", label: "Sound File", mediaType: "audio", required: true },
          {
            id: "volume",
            name: "volume",
            type: "range",
            label: "Volume",
            min: 0,
            max: 100,
            defaultValue: 80,
            unit: "%",
          },
        ],
      },
    },
    {
      id: "action-add-points",
      moduleId: "mod-3",
      name: "Add Loyalty Points",
      description: "Give loyalty points to a user",
      icon: "Coins",
      category: "engagement",
      color: "text-amber-500",
      config: {
        fields: [
          { id: "points", name: "points", type: "number", label: "Points", required: true, min: 1, max: 100000 },
          {
            id: "target",
            name: "target",
            type: "select",
            label: "Target",
            options: [
              { label: "Triggering User", value: "trigger_user" },
              { label: "Random Viewer", value: "random" },
              { label: "All Viewers", value: "all" },
            ],
            defaultValue: "trigger_user",
          },
        ],
      },
    },
    {
      id: "action-obs-scene",
      moduleId: "mod-8",
      name: "Switch OBS Scene",
      description: "Change the active OBS scene",
      icon: "Monitor",
      category: "obs",
      color: "text-purple-500",
      config: {
        fields: [
          { id: "scene", name: "scene", type: "string", label: "Scene Name", required: true, placeholder: "Gaming" },
        ],
      },
    },
    {
      id: "action-timeout",
      moduleId: "mod-1",
      name: "Timeout User",
      description: "Timeout a user in chat",
      icon: "Clock",
      category: "moderation",
      color: "text-red-500",
      config: {
        fields: [
          {
            id: "duration",
            name: "duration",
            type: "number",
            label: "Duration",
            unit: "seconds",
            min: 1,
            max: 1209600,
            defaultValue: 600,
          },
          { id: "reason", name: "reason", type: "string", label: "Reason", placeholder: "Rule violation" },
        ],
      },
    },
    {
      id: "action-http-request",
      moduleId: "mod-6",
      name: "HTTP Request",
      description: "Make an HTTP request to an external service",
      icon: "Globe",
      category: "integration",
      color: "text-indigo-500",
      config: {
        fields: [
          {
            id: "url",
            name: "url",
            type: "string",
            label: "URL",
            required: true,
            placeholder: "https://api.example.com/webhook",
          },
          {
            id: "method",
            name: "method",
            type: "select",
            label: "Method",
            options: [
              { label: "GET", value: "GET" },
              { label: "POST", value: "POST" },
              { label: "PUT", value: "PUT" },
            ],
            defaultValue: "POST",
          },
          { id: "body", name: "body", type: "json", label: "Request Body" },
        ],
      },
    },
  ];

  async getTriggers(createdByType?: string, createdByRef?: string): Promise<Trigger[]> {
    return this.db.listTriggers(createdByType, createdByRef);
  }

  async getTrigger(id: string): Promise<(typeof this.triggers)[0] | null> {
    return this.triggers.find((t) => t.id === id) || null;
  }

  async getActions(moduleId?: string): Promise<typeof this.actions> {
    if (moduleId) {
      return this.actions.filter((a) => a.moduleId === moduleId);
    }
    return [...this.actions];
  }

  async getAction(id: string): Promise<(typeof this.actions)[0] | null> {
    return this.actions.find((a) => a.id === id) || null;
  }

  // ==================== User Preferences ====================

  private userPreferences = { email: true, push: false, workflow: true, marketing: false };

  async getUserPreferences(): Promise<{ email: boolean; push: boolean; workflow: boolean; marketing: boolean }> {
    return { ...this.userPreferences };
  }

  async updateUserPreferences(prefs: Partial<typeof this.userPreferences>): Promise<{ success: boolean }> {
    Object.assign(this.userPreferences, prefs);
    return { success: true };
  }

  // ==================== Dashboard Layout ====================

  private dashboardLayouts: Record<
    string,
    Array<{
      id: string;
      type: string;
      title: string;
      config?: Record<string, unknown>;
    }>
  > = {
    "account-1": [
      { id: "dash-1", type: "chat", title: "Live Chat", config: { accountId: "account-1" } },
      { id: "dash-2", type: "workflow-runs", title: "Recent Workflows", config: { accountId: "account-1", limit: 5 } },
      { id: "dash-3", type: "event-feed", title: "Stream Events", config: { accountId: "account-1", limit: 10 } },
    ],
  };

  async getDashboardLayout(accountId: string): Promise<
    Array<{
      id: string;
      type: string;
      title: string;
      config?: Record<string, unknown>;
    }>
  > {
    return this.dashboardLayouts[accountId] || [];
  }

  async saveDashboardLayout(
    accountId: string,
    modules: Array<{
      id: string;
      type: string;
      title: string;
      config?: Record<string, unknown>;
    }>
  ): Promise<boolean> {
    this.dashboardLayouts[accountId] = modules;
    return true;
  }

  // ==================== Internal Helpers ====================

  private async publishEvent(eventType: string, data: Record<string, unknown>, subject?: string): Promise<void> {
    if (!this.nats) {
      this.logger.error("Cannot publish event - NATS client not available", { eventType });
      throw new Error("NATS client not available");
    }

    const eventId = crypto.randomUUID();
    const event = {
      id: eventId,
      type: eventType,
      source: "api",
      time: new Date().toISOString(),
      data,
    };

    const eventData = new TextEncoder().encode(JSON.stringify(event));
    const eventSubject = subject || eventType;

    this.logger.debug("Publishing event to NATS", {
      eventType,
      eventId,
      subject: eventSubject,
    });

    await this.nats.publish(eventSubject, eventData);

    this.logger.info("Event published successfully", {
      eventType,
      eventId,
      subject: eventSubject,
    });
  }
}
