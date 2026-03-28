import type { Service } from "@woofx3/common/runtime";
import { Ping } from "@woofx3/db/common.pb";

type DbProxyClient = {
  baseURL: string;
};

export default class DbProxyService implements Service<DbProxyClient> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: DbProxyClient;
  connected: boolean;

  constructor(baseURL: string) {
    this.healthcheck = true;
    this.name = "dbProxy";
    this.type = "db";
    this.client = { baseURL };
    this.connected = false;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.client.baseURL) {
      throw new Error("db proxy client not properly initialized");
    }

    await Ping({}, { baseURL: this.client.baseURL });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    // No-op for HTTP client.
    this.connected = false;
  }
}
