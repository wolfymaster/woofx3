import type { Service } from "@woofx3/common/runtime";
import type { DbProxyClientConfig } from "@woofx3/db/service-auth";
import { DbClient } from "../db";

export default class DatabaseService implements Service<DbClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: DbClient;
  connected: boolean;

  constructor(config: DbProxyClientConfig) {
    this.healthcheck = false;
    this.name = "db";
    this.type = "database";
    this.client = new DbClient(config);
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
