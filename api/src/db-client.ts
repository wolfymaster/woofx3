import * as alert from "@woofx3/db/alert.pb";
import * as application from "@woofx3/db/application.pb";
import * as clientPb from "@woofx3/db/client.pb";
import * as command from "@woofx3/db/command.pb";
import { Ping } from "@woofx3/db/common.pb";
import type * as common from "@woofx3/db/common.pb";
import * as group from "@woofx3/db/group.pb";
import * as module from "@woofx3/db/module.pb";
import type * as module_action from "@woofx3/db/module_action.pb";
import * as module_resource_instance from "@woofx3/db/module_resource_instance.pb";
import * as module_setting from "@woofx3/db/module_setting.pb";
import type * as module_trigger from "@woofx3/db/module_trigger.pb";
import type * as module_widget from "@woofx3/db/module_widget.pb";
import * as overlay_token from "@woofx3/db/overlay_token.pb";
import * as permission from "@woofx3/db/permission.pb";
import * as resource from "@woofx3/db/resource.pb";
import * as scene from "@woofx3/db/scene.pb";
import * as setting from "@woofx3/db/setting.pb";
import * as treat from "@woofx3/db/treat.pb";
import * as user from "@woofx3/db/user.pb";
import * as widget_status from "@woofx3/db/widget_status.pb";
import * as workflow from "@woofx3/db/workflow.pb";
import type { ClientConfiguration } from "twirpscript";

/**
 * A failure from db-proxy, carrying the reason as data.
 *
 * Two problems meet here. twirpscript's TwirpError does not extend Error, so
 * anything thrown from a Twirp call fails capnweb serialization; and the
 * response envelope reports failure in a `status.code` rather than by
 * throwing. Both become a DbError, so a caller has one thing to catch and one
 * place to read the reason from.
 *
 * `code` is the part that matters. It used to be flattened into the message,
 * which left callers matching on substrings -- `err.message.includes(
 * "unauthenticated")` -- and a test asserting an exact message template. The
 * message stays human-facing; decisions read `code`.
 */
export class DbError extends Error {
  /** Twirp code ("unauthenticated", "not_found", ...) or an envelope status code. */
  readonly code: string;
  /** The DbClient method that failed, e.g. "getCommand". */
  readonly op: string;

  constructor(op: string, code: string, message: string) {
    super(message.length > 0 ? message : `db.${op} failed (${code})`);
    this.name = "DbError";
    this.code = code;
    this.op = op;
  }
}

/** True when the failure is db-proxy refusing the caller, not a transport fault. */
export function isPermissionDenied(err: unknown): boolean {
  return err instanceof DbError && (err.code === "unauthenticated" || err.code === "permission_denied");
}

function toError(err: unknown, op: string): Error {
  if (err instanceof DbError) {
    return err;
  }
  if (err !== null && typeof err === "object") {
    const e = err as { code?: unknown; msg?: unknown };
    const code = typeof e.code === "string" ? e.code : "";
    const msg = typeof e.msg === "string" ? e.msg : "";
    if (code.length > 0 || msg.length > 0) {
      return new DbError(op, code || "unknown", msg);
    }
  }
  if (err instanceof Error) {
    return err;
  }
  return new DbError(op, "unknown", String(err));
}

/**
 * Read the payload out of a db-proxy response envelope, or throw.
 *
 * Every enveloped call used to hand the whole response back and let the
 * caller decide what a non-OK status meant. They decided it 48 times, in four
 * different ways. Deciding it here means a route method receives what it
 * asked for or does not run.
 */
function unwrap<T>(op: string, response: { status?: { code?: string; message?: string } }, payload: T | undefined): T {
  const code = response.status?.code;
  if (code !== "OK") {
    throw new DbError(op, code ?? "unknown", response.status?.message ?? "");
  }
  if (payload === undefined || payload === null) {
    throw new DbError(op, "not_found", `db.${op} returned no payload`);
  }
  return payload;
}

/**
 * Same check for the calls that return a bare ResponseStatus rather than
 * wrapping one. db-proxy uses both shapes; callers should not have to know
 * which they are dealing with.
 */
function unwrapStatus(op: string, status: { code?: string; message?: string }): void {
  if (status.code !== "OK") {
    throw new DbError(op, status.code ?? "unknown", status.message ?? "");
  }
}

/** Envelope check for calls whose success carries no payload. */
function unwrapVoid(op: string, response: { status?: { code?: string; message?: string } }): void {
  const code = response.status?.code;
  if (code !== "OK") {
    throw new DbError(op, code ?? "unknown", response.status?.message ?? "");
  }
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
            throw toError(err, String(prop));
          }
        };
      },
    });
  }

  async ping(): Promise<void> {
    await Ping({}, this.config);
  }

  async getCommand(req: command.GetCommandRequest): Promise<command.Command> {
    const response = await command.GetCommand(req, this.config);
    return unwrap("getCommand", response, response.command);
  }

  async listCommands(req: command.ListCommandsRequest): Promise<command.Command[]> {
    const response = await command.ListCommands(req, this.config);
    return unwrap("listCommands", response, response.commands ?? []);
  }

  async createCommand(req: command.CreateCommandRequest): Promise<command.Command> {
    const response = await command.CreateCommand(req, this.config);
    return unwrap("createCommand", response, response.command);
  }

  async updateCommand(req: command.UpdateCommandRequest): Promise<command.Command> {
    const response = await command.UpdateCommand(req, this.config);
    return unwrap("updateCommand", response, response.command);
  }

  async deleteCommand(req: command.DeleteCommandRequest): Promise<void> {
    unwrapStatus("deleteCommand", await command.DeleteCommand(req, this.config));
  }

  async createResource(req: resource.CreateResourceRequest): Promise<resource.ResourceResponse> {
    return resource.CreateResource(req, this.config);
  }

  async createResourceFolder(req: resource.CreateFolderRequest): Promise<resource.ResourceResponse> {
    return resource.CreateFolder(req, this.config);
  }

  async getResource(req: resource.GetResourceRequest): Promise<resource.ResourceResponse> {
    return resource.GetResource(req, this.config);
  }

  async listResources(req: resource.ListResourcesRequest): Promise<resource.ListResourcesResponse> {
    return resource.ListResources(req, this.config);
  }

  async updateResource(req: resource.UpdateResourceRequest): Promise<resource.ResourceResponse> {
    return resource.UpdateResource(req, this.config);
  }

  async deleteResource(req: resource.DeleteResourceRequest): Promise<resource.DeleteResourceResponse> {
    return resource.DeleteResource(req, this.config);
  }

  async createGroup(req: group.CreateGroupRequest): Promise<group.GroupResponse> {
    return group.CreateGroup(req, this.config);
  }

  async getGroup(req: group.GetGroupRequest): Promise<group.GroupResponse> {
    return group.GetGroup(req, this.config);
  }

  async listGroups(req: group.ListGroupsRequest): Promise<group.ListGroupsResponse> {
    return group.ListGroups(req, this.config);
  }

  async updateGroup(req: group.UpdateGroupRequest): Promise<group.GroupResponse> {
    return group.UpdateGroup(req, this.config);
  }

  async deleteGroup(req: group.DeleteGroupRequest): Promise<common.ResponseStatus> {
    return group.DeleteGroup(req, this.config);
  }

  async addUserToGroup(req: group.GroupMembershipRequest): Promise<common.ResponseStatus> {
    return group.AddUserToGroup(req, this.config);
  }

  async removeUserFromGroup(req: group.GroupMembershipRequest): Promise<common.ResponseStatus> {
    return group.RemoveUserFromGroup(req, this.config);
  }

  async listGroupMembers(req: group.ListGroupMembersRequest): Promise<group.ListGroupMembersResponse> {
    return group.ListGroupMembers(req, this.config);
  }

  async listUserGroupsForUser(req: group.ListUserGroupsForUserRequest): Promise<group.ListGroupsResponse> {
    return group.ListUserGroupsForUser(req, this.config);
  }

  async listPermissions(req: permission.ListPermissionsRequest): Promise<permission.ListPermissionsResponse> {
    return permission.ListPermissions(req, this.config);
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

  async listWidgets(req: module_widget.ListWidgetsRequest): Promise<module_widget.ListWidgetsResponse> {
    return module.ListWidgets(req, this.config);
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

  /**
   * Resources owned by this module that are still referenced externally
   * (workflows, commands, etc.). `moduleId` is the engine modules.id UUID.
   */
  async checkModuleResourceUsage(
    moduleId: string,
    applicationId = ""
  ): Promise<
    Array<{
      resourceId: string;
      resourceType: string;
      resourceName: string;
      resourceDisplayName?: string;
      usedBy: Array<{
        sourceType: string;
        sourceId: string;
        sourceName: string;
        context: string;
      }>;
    }>
  > {
    const resp = await module.CheckModuleResourceUsage({ moduleId, applicationId }, this.config);
    return (resp.inUse ?? []).map((row) => ({
      resourceId: row.resourceId,
      resourceType: row.resourceType,
      resourceName: row.resourceName,
      resourceDisplayName: row.resourceDisplayName || undefined,
      usedBy: (row.usedBy ?? []).map((u) => ({
        sourceType: u.sourceType,
        sourceId: u.sourceId,
        sourceName: u.sourceName,
        context: u.context,
      })),
    }));
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

  async mintOverlayToken(
    req: overlay_token.MintOverlayTokenRequest
  ): Promise<overlay_token.OverlayTokenResponse> {
    return overlay_token.MintOverlayToken(req, this.config);
  }

  async revokeOverlayToken(
    req: overlay_token.RevokeOverlayTokenRequest
  ): Promise<overlay_token.OverlayTokenResponse> {
    return overlay_token.RevokeOverlayToken(req, this.config);
  }

  async rotateOverlayToken(
    req: overlay_token.RotateOverlayTokenRequest
  ): Promise<overlay_token.OverlayTokenResponse> {
    return overlay_token.RotateOverlayToken(req, this.config);
  }

  async listOverlayTokens(
    req: overlay_token.ListOverlayTokensRequest
  ): Promise<overlay_token.ListOverlayTokensResponse> {
    return overlay_token.ListOverlayTokens(req, this.config);
  }

  async resolveOverlayToken(
    req: overlay_token.ResolveOverlayTokenRequest
  ): Promise<overlay_token.ResolveOverlayTokenResponse> {
    return overlay_token.ResolveOverlayToken(req, this.config);
  }

  async listModuleSettings(
    req: module_setting.ListModuleSettingsRequest
  ): Promise<module_setting.ListModuleSettingsResponse> {
    return module_setting.ListModuleSettings(req, this.config);
  }

  async setModuleSetting(
    req: module_setting.SetModuleSettingRequest
  ): Promise<module_setting.ModuleSettingRecord> {
    return module_setting.SetModuleSetting(req, this.config);
  }

  async createResourceInstance(
    req: module_resource_instance.CreateResourceInstanceRequest
  ): Promise<module_resource_instance.ResourceInstanceResponse> {
    return module.CreateResourceInstance(req, this.config);
  }

  async deleteResourceInstance(
    req: module_resource_instance.DeleteResourceInstanceRequest
  ): Promise<common.ResponseStatus> {
    return module.DeleteResourceInstance(req, this.config);
  }

  async listAllResourceInstances(
    req: module_resource_instance.ListAllResourceInstancesRequest
  ): Promise<module_resource_instance.ListResourceInstancesResponse> {
    return module.ListAllResourceInstances(req, this.config);
  }

  async listResourceInstancesByModule(
    moduleId: string
  ): Promise<module_resource_instance.ListResourceInstancesResponse> {
    return module.ListResourceInstancesByModule({ moduleId }, this.config);
  }
}
