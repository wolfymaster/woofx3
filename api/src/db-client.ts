import * as alert from "@woofx3/db/alert.pb";
import * as application from "@woofx3/db/application.pb";
import * as clientPb from "@woofx3/db/client.pb";
import * as command from "@woofx3/db/command.pb";
import type * as common from "@woofx3/db/common.pb";
import * as module from "@woofx3/db/module.pb";
import type * as module_action from "@woofx3/db/module_action.pb";
import type * as module_trigger from "@woofx3/db/module_trigger.pb";
import * as scene from "@woofx3/db/scene.pb";
import * as setting from "@woofx3/db/setting.pb";
import * as treat from "@woofx3/db/treat.pb";
import * as user from "@woofx3/db/user.pb";
import * as widget_status from "@woofx3/db/widget_status.pb";
import * as workflow from "@woofx3/db/workflow.pb";
import type { ClientConfiguration } from "twirpscript";

// twirpscript's TwirpError is a plain class that does NOT extend Error, so
// anything thrown from a Twirp call fails capnweb serialization (typeForRpc
// rejects objects whose prototype is not Object.prototype and that are not
// `instanceof Error`). Normalize at the db-proxy boundary so every caller
// upstream sees a real Error carrying the Twirp code and message.
function toError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    return err;
  }
  if (err !== null && typeof err === "object") {
    const e = err as { code?: unknown; msg?: unknown };
    const code = typeof e.code === "string" ? e.code : undefined;
    const msg = typeof e.msg === "string" ? e.msg : undefined;
    const detail = [code, msg].filter((part) => part && part.length > 0).join(": ");
    return new Error(`${op}: ${detail.length > 0 ? detail : String(err)}`);
  }
  return new Error(`${op}: ${String(err)}`);
}

export class DbClient {
  private config: ClientConfiguration;

  constructor(baseUrl: string) {
    this.config = {
      baseURL: baseUrl,
    };
    return new Proxy(this, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === "constructor" || typeof value !== "function") {
          return value;
        }
        const method = value as (...args: unknown[]) => unknown;
        return async function wrapped(this: unknown, ...args: unknown[]) {
          try {
            return await method.apply(this, args);
          } catch (err) {
            throw toError(err, `db.${String(prop)}`);
          }
        };
      },
    });
  }

  async getCommand(req: command.GetCommandRequest): Promise<command.CommandResponse> {
    return command.GetCommand(req, this.config);
  }

  async listCommands(req: command.ListCommandsRequest): Promise<command.ListCommandsResponse> {
    return command.ListCommands(req, this.config);
  }

  async createCommand(req: command.CreateCommandRequest): Promise<command.CommandResponse> {
    return command.CreateCommand(req, this.config);
  }

  async updateCommand(req: command.UpdateCommandRequest): Promise<command.CommandResponse> {
    return command.UpdateCommand(req, this.config);
  }

  async deleteCommand(req: command.DeleteCommandRequest): Promise<common.ResponseStatus> {
    return command.DeleteCommand(req, this.config);
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

  // SceneService — per-application widget arrangement persistence.
  // The engine treats widgets_json / layout_json as opaque strings,
  // mirroring the workflow steps_json / trigger_json pattern.
  async getScene(req: scene.GetSceneRequest): Promise<scene.SceneResponse> {
    return scene.GetScene(req, this.config);
  }

  async listScenes(req: scene.ListScenesRequest): Promise<scene.ListScenesResponse> {
    return scene.ListScenes(req, this.config);
  }

  async createScene(req: scene.CreateSceneRequest): Promise<scene.SceneResponse> {
    return scene.CreateScene(req, this.config);
  }

  async updateScene(req: scene.UpdateSceneRequest): Promise<scene.SceneResponse> {
    return scene.UpdateScene(req, this.config);
  }

  async deleteScene(req: scene.DeleteSceneRequest): Promise<common.ResponseStatus> {
    return scene.DeleteScene(req, this.config);
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

  async createAlert(req: alert.CreateAlertRequest): Promise<alert.AlertResponse> {
    return alert.CreateAlert(req, this.config);
  }

  async getAlert(req: alert.GetAlertRequest): Promise<alert.AlertResponse> {
    return alert.GetAlert(req, this.config);
  }

  async getAlertByEnvelopeId(req: alert.GetAlertByEnvelopeIdRequest): Promise<alert.AlertResponse> {
    return alert.GetAlertByEnvelopeId(req, this.config);
  }

  async listAlerts(req: alert.ListAlertsRequest): Promise<alert.ListAlertsResponse> {
    return alert.ListAlerts(req, this.config);
  }

  async updateAlertStatus(req: alert.UpdateAlertStatusRequest): Promise<alert.AlertResponse> {
    return alert.UpdateAlertStatus(req, this.config);
  }

  async updateAlertLifecycle(req: alert.UpdateAlertLifecycleRequest): Promise<alert.AlertResponse> {
    return alert.UpdateAlertLifecycle(req, this.config);
  }

  async deleteAlert(req: alert.DeleteAlertRequest): Promise<common.ResponseStatus> {
    return alert.DeleteAlert(req, this.config);
  }

  async upsertWidgetStatus(
    req: widget_status.UpsertWidgetStatusRequest
  ): Promise<widget_status.WidgetStatusResponse> {
    return widget_status.UpsertWidgetStatus(req, this.config);
  }

  async getWidgetStatus(
    req: widget_status.GetWidgetStatusRequest
  ): Promise<widget_status.WidgetStatusResponse> {
    return widget_status.GetWidgetStatus(req, this.config);
  }

  async listWidgetStatus(
    req: widget_status.ListWidgetStatusRequest
  ): Promise<widget_status.ListWidgetStatusResponse> {
    return widget_status.ListWidgetStatus(req, this.config);
  }

  async deleteWidgetStatus(
    req: widget_status.DeleteWidgetStatusRequest
  ): Promise<common.ResponseStatus> {
    return widget_status.DeleteWidgetStatus(req, this.config);
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

  async listModules(stateFilter?: string): Promise<module.Module[]> {
    const resp = await module.ListModules({ state: stateFilter ?? "" }, this.config);
    return resp.modules;
  }

  async getModule(id: string): Promise<module.Module | null> {
    const resp = await module.GetModule({ id }, this.config);
    return resp.module ?? null;
  }

  async getModuleByName(name: string): Promise<module.Module | null> {
    const resp = await module.GetModuleByName({ name }, this.config);
    return resp.module ?? null;
  }

  async getModuleByModuleKey(moduleKey: string): Promise<module.Module | null> {
    try {
      const resp = await module.GetModuleByModuleKey({ moduleKey }, this.config);
      return resp.module ?? null;
    } catch {
      return null;
    }
  }

  async listTriggers(createdByType?: string, createdByRef?: string): Promise<module_trigger.Trigger[]> {
    const resp = await module.ListTriggers(
      { createdByType: createdByType ?? "", createdByRef: createdByRef ?? "" },
      this.config
    );
    return resp.triggers;
  }

  async listActions(createdByType?: string, createdByRef?: string): Promise<module_action.Action[]> {
    const resp = await module.ListActions(
      { createdByType: createdByType ?? "", createdByRef: createdByRef ?? "" },
      this.config
    );
    return resp.actions;
  }

  async createApplication(opts: {
    name: string;
    ownerId: string;
    isDefault: boolean;
  }): Promise<{ id: string; name: string }> {
    const resp = await application.CreateApplication(
      { name: opts.name, ownerId: opts.ownerId, isDefault: opts.isDefault },
      this.config
    );
    if (!resp.application || resp.status?.code !== "OK") {
      throw new Error(`createApplication failed: ${resp.status?.message ?? "unknown error"}`);
    }
    return { id: resp.application.id, name: resp.application.name };
  }

  async getApplication(req: application.GetApplicationRequest): Promise<application.ApplicationResponse> {
    return application.GetApplication(req, this.config);
  }

  async getDefaultApplication(): Promise<{ id: string; name: string } | null> {
    const resp = await application.GetDefaultApplication({}, this.config);
    if (resp.status?.code !== "OK" || !resp.application) {
      return null;
    }
    return { id: resp.application.id, name: resp.application.name };
  }

  async findOrCreateByWoofx3UIUserId(woofx3UIUserId: string): Promise<{ id: string }> {
    const resp = await user.FindOrCreateByWoofx3UIUserId({ woofx3UiUserId: woofx3UIUserId }, this.config);
    if (!resp.user || resp.status?.code !== "OK") {
      throw new Error(`findOrCreateByWoofx3UIUserId failed: ${resp.status?.message ?? "unknown error"}`);
    }
    return { id: resp.user.id };
  }

  async setSetting(
    key: string,
    value: string,
    applicationId: string,
    userId?: string
  ): Promise<setting.SettingResponse> {
    return setting.SetSetting(
      {
        userId: userId ?? "",
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
