import * as application from "@woofx3/db/application.pb";
import * as clientPb from "@woofx3/db/client.pb";
import * as command from "@woofx3/db/command.pb";
import type * as common from "@woofx3/db/common.pb";
import * as module from "@woofx3/db/module.pb";
import type * as module_trigger from "@woofx3/db/module_trigger.pb";
import * as setting from "@woofx3/db/setting.pb";
import * as treat from "@woofx3/db/treat.pb";
import * as user from "@woofx3/db/user.pb";
import * as workflow from "@woofx3/db/workflow.pb";
import type { ClientConfiguration } from "twirpscript";
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

  async createWorkflow(req: workflow.CreateWorkflowRequest): Promise<workflow.WorkflowResponse> {
    return workflow.CreateWorkflow(req, this.config);
  }

  async updateWorkflow(req: workflow.UpdateWorkflowRequest): Promise<workflow.WorkflowResponse> {
    return workflow.UpdateWorkflow(req, this.config);
  }

  async deleteWorkflow(req: workflow.DeleteWorkflowRequest): Promise<common.ResponseStatus> {
    return workflow.DeleteWorkflow(req, this.config);
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

  async listTriggers(moduleNameFilter?: string): Promise<module_trigger.ModuleTrigger[]> {
    const resp = await module.ListTriggers(
      { moduleName: moduleNameFilter ?? "" },
      this.config,
    );
    return resp.triggers;
  }

  async createApplication(req: application.CreateApplicationRequest): Promise<application.ApplicationResponse> {
    return application.CreateApplication(req, this.config);
  }

  async getApplication(req: application.GetApplicationRequest): Promise<application.ApplicationResponse> {
    return application.GetApplication(req, this.config);
  }

  async setSetting(key: string, value: string, applicationId: string): Promise<setting.SettingResponse> {
    return setting.SetSetting(
      {
        key,
        value: { stringValue: value },
        applicationId,
      },
      this.config
    );
  }

  async getSetting(key: string, applicationId: string): Promise<string | null> {
    const resp = await setting.GetSetting({ key, applicationId }, this.config);
    return resp.setting?.value?.stringValue ?? null;
  }

  async listSettings(keyPrefix: string, applicationId: string): Promise<Record<string, string>> {
    const resp = await setting.ListSettingsByPrefix({ keyPrefix, applicationId }, this.config);
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(resp.settings ?? {})) {
      if (value != null) {
        result[key] = value;
      }
    }
    return result;
  }

  async createClient(req: clientPb.CreateClientRequest): Promise<clientPb.ClientResponse> {
    return clientPb.CreateClient(req, this.config);
  }

  async validateClient(clientId: string, clientSecret: string): Promise<clientPb.ClientResponse> {
    return clientPb.ValidateClient({ clientId, clientSecret }, this.config);
  }

  async listClients(applicationId: string): Promise<clientPb.ListClientsResponse> {
    return clientPb.ListClients({ applicationId }, this.config);
  }

  async getClientByClientID(clientId: string): Promise<clientPb.ClientResponse> {
    return clientPb.GetClient({ clientId }, this.config);
  }

  async deleteClient(id: string): Promise<common.ResponseStatus> {
    return clientPb.DeleteClient({ id }, this.config);
  }
}
