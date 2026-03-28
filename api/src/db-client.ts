import * as command from "@woofx3/db/command.pb";
import type * as common from "@woofx3/db/common.pb";
import * as treat from "@woofx3/db/treat.pb";
import * as user from "@woofx3/db/user.pb";
import * as workflow from "@woofx3/db/workflow.pb";
import type { ClientConfiguration } from "twirpscript";

export interface ModuleTrigger {
  id: string;
  module_id: string;
  module_name: string;
  category: string;
  name: string;
  description: string;
  event: string;
  config_schema: string;
  allow_variants: boolean;
  created_at?: string;
}

/**
 * DB proxy client using Twirp RPCs from generated @woofx3/db/*.pb stubs.
 * Keep methods aligned with shared/clients/typescript/db/*.pb.ts exports.
 */
export class DbClient {
  private config: ClientConfiguration;

  constructor(baseUrl: string) {
    this.config = {
      baseURL: baseUrl,
    };
  }

  async getCommand(req: command.GetCommandRequest): Promise<command.CommandResponse> {
    return command.GetCommand(req, this.config);
  }

  async listCommands(req: command.ListCommandsRequest): Promise<command.ListCommandsResponse> {
    return command.ListCommands(req, this.config);
  }

  async getWorkflow(req: workflow.GetWorkflowRequest): Promise<workflow.WorkflowResponse> {
    return workflow.GetWorkflow(req, this.config);
  }

  async listWorkflows(req: workflow.ListWorkflowsRequest): Promise<workflow.ListWorkflowsResponse> {
    return workflow.ListWorkflows(req, this.config);
  }

  async executeWorkflow(req: workflow.ExecuteWorkflowRequest): Promise<workflow.ExecuteWorkflowResponse> {
    return workflow.ExecuteWorkflow(req, this.config);
  }

  async getWorkflowExecution(req: workflow.GetWorkflowExecutionRequest): Promise<workflow.WorkflowExecutionResponse> {
    return workflow.GetWorkflowExecution(req, this.config);
  }

  async listWorkflowExecutions(
    req: workflow.ListWorkflowExecutionsRequest
  ): Promise<workflow.ListWorkflowExecutionsResponse> {
    return workflow.ListWorkflowExecutions(req, this.config);
  }

  async cancelWorkflowExecution(req: workflow.CancelWorkflowExecutionRequest): Promise<common.ResponseStatus> {
    return workflow.CancelWorkflowExecution(req, this.config);
  }

  async getUser(req: user.GetUserRequest): Promise<user.UserResponse> {
    return user.GetUser(req, this.config);
  }

  async getUserTreatsSummary(req: treat.GetUserTreatsSummaryRequest): Promise<treat.TreatsSummaryResponse> {
    return treat.GetUserTreatsSummary(req, this.config);
  }

  async awardTreat(req: treat.AwardTreatRequest): Promise<treat.TreatResponse> {
    return treat.AwardTreat(req, this.config);
  }

  async listTriggers(moduleNameFilter?: string): Promise<ModuleTrigger[]> {
    const url = `${this.config.baseURL}/twirp/module.ModuleService/ListTriggers`;
    const body = moduleNameFilter ? { module_name: moduleNameFilter } : {};
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`ListTriggers failed: ${response.status}`);
    }
    const data = (await response.json()) as { triggers?: ModuleTrigger[] };
    return data.triggers ?? [];
  }
}
