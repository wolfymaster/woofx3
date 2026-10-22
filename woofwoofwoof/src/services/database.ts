import type { Service } from "@woofx3/common/runtime";
import { type Command, ListCommands, type ListCommandsRequest, type ListCommandsResponse } from "@woofx3/db/command.pb";
import type { ResponseStatus } from "@woofx3/db/common.pb";
import { Ping } from "@woofx3/db/common.pb";
import {
  AddUserToGroup,
  type GroupMembershipRequest,
  ListGroups,
  type ListGroupsRequest,
  type ListGroupsResponse,
  RemoveUserFromGroup,
} from "@woofx3/db/group.pb";
import { RegisterTriggers } from "@woofx3/db/module.pb";
import type { ListTriggersResponse, RegisterTriggersRequest } from "@woofx3/db/module_trigger.pb";
import {
  AddUserToResource,
  HasPermission,
  type HasPermissionRequest,
  RemoveUserFromResource,
  type UserResourceRoleRequest,
} from "@woofx3/db/permission.pb";
import type { DbProxyClientConfig } from "@woofx3/db/service-auth";
import {
  GetSetting,
  type GetSettingRequest,
  SetSetting,
  type SetSettingRequest,
  type SettingResponse,
} from "@woofx3/db/setting.pb";

export class DatabaseClient {
  private config: DbProxyClientConfig;

  constructor(config: DbProxyClientConfig) {
    this.config = config;
  }

  async ping() {
    return Ping({}, this.config);
  }

  async getSetting(req: GetSettingRequest): Promise<SettingResponse> {
    return GetSetting(req, this.config);
  }

  async setSetting(req: SetSettingRequest): Promise<SettingResponse> {
    return SetSetting(req, this.config);
  }

  async listCommands(req: ListCommandsRequest): Promise<ListCommandsResponse> {
    return ListCommands(req, this.config);
  }

  /**
   * The stored command with engine id `id`, disabled ones included, or null
   * when there is none. Throws when db-proxy does not answer OK.
   *
   * Lists every command and picks one, because db-proxy's GetCommand looks a
   * command up by name, not id. That costs a full listing per call, which is
   * acceptable while it only runs on command create, update and delete.
   */
  async findCommandById(id: string): Promise<Command | null> {
    const response = await this.listCommands({ includeDisabled: true });
    if (response.status?.code !== "OK") {
      throw new Error(`Failed to list commands: ${response.status?.message ?? "no status"}`);
    }
    return response.commands.find((command) => command.id === id) ?? null;
  }

  async hasPermission(req: HasPermissionRequest): Promise<ResponseStatus> {
    return HasPermission(req, this.config);
  }

  async addUserToResource(req: UserResourceRoleRequest): Promise<ResponseStatus> {
    return AddUserToResource(req, this.config);
  }

  async removeUserFromResource(req: UserResourceRoleRequest): Promise<ResponseStatus> {
    return RemoveUserFromResource(req, this.config);
  }

  async listGroups(req: ListGroupsRequest): Promise<ListGroupsResponse> {
    return ListGroups(req, this.config);
  }

  async addUserToGroup(req: GroupMembershipRequest): Promise<ResponseStatus> {
    return AddUserToGroup(req, this.config);
  }

  async removeUserFromGroup(req: GroupMembershipRequest): Promise<ResponseStatus> {
    return RemoveUserFromGroup(req, this.config);
  }

  async registerTriggers(req: RegisterTriggersRequest): Promise<ListTriggersResponse> {
    return RegisterTriggers(req, this.config);
  }
}

export default class DatabaseService implements Service<DatabaseClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: DatabaseClient;
  connected: boolean;

  constructor(config: DbProxyClientConfig) {
    this.healthcheck = false;
    this.name = "db";
    this.type = "database";
    this.client = new DatabaseClient(config);
    this.connected = false;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.client.ping();
    this.connected = true;
    this.healthcheck = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.healthcheck = false;
  }
}
