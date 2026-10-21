import type { Service } from "@woofx3/common/runtime";
import { Ping } from "@woofx3/db/common.pb";

type DbProxyClient = { baseURL: string };

/** db-proxy over HTTP. Connecting pings it, so the runtime waits for it before the host starts. */
export default class DbProxyService implements Service<DbProxyClient> {
  readonly healthcheck = true;
  readonly name = "dbProxy";
  readonly type = "db";
  readonly client: DbProxyClient;
  connected = false;

  constructor(baseURL: string) {
    this.client = { baseURL };
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await Ping({}, { baseURL: this.client.baseURL });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
