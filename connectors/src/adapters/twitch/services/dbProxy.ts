import type { Service } from "@woofx3/common/runtime";
import { Ping } from "@woofx3/db/common.pb";
import type { DbProxyClientConfig } from "@woofx3/db/service-auth";

/**
 * The db-proxy connection. `client` is the configuration every generated RPC
 * call is made with, so each call carries the service token.
 */
export default class DbProxyService implements Service<DbProxyClientConfig> {
  healthcheck: boolean;
  name: string;
  type: string;
  client: DbProxyClientConfig;
  connected: boolean;

  constructor(config: DbProxyClientConfig) {
    this.healthcheck = true;
    this.name = "dbProxy";
    this.type = "db";
    this.client = config;
    this.connected = false;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (!this.client.baseURL) {
      throw new Error("db proxy client not properly initialized");
    }

    await Ping({}, this.client);
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
