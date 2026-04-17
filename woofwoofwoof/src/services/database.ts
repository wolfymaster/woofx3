import type { Service } from "@woofx3/common/runtime";
import { ListCommands, type ListCommandsRequest, type ListCommandsResponse } from "@woofx3/db/command.pb";
import type { ResponseStatus } from "@woofx3/db/common.pb";
import { Ping } from "@woofx3/db/common.pb";
import {
  AddUserToResource,
  HasPermission,
  type HasPermissionRequest,
  RemoveUserFromResource,
  type UserResourceRoleRequest,
} from "@woofx3/db/permission.pb";
import { GetSetting, type GetSettingRequest, type SettingResponse } from "@woofx3/db/setting.pb";
import type { ClientConfiguration } from "twirpscript";

export class DatabaseClient {
  private config: ClientConfiguration;

  constructor(baseURL: string) {
    this.config = { baseURL };
  }

  async ping() {
    return Ping({}, this.config);
  }

  async getSetting(req: GetSettingRequest): Promise<SettingResponse> {
    return GetSetting(req, this.config);
  }

  async listCommands(req: ListCommandsRequest): Promise<ListCommandsResponse> {
    return ListCommands(req, this.config);
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
}

export default class DatabaseService implements Service<DatabaseClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: DatabaseClient;
  connected: boolean;

  constructor(baseURL: string) {
    this.healthcheck = false;
    this.name = "db";
    this.type = "database";
    this.client = new DatabaseClient(baseURL);
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
