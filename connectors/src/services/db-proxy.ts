import type { Service } from "@woofx3/common/runtime";
import { Ping } from "@woofx3/db/common.pb";
import { dbProxyClientConfig as serviceAuthConfig } from "@woofx3/db/service-auth";

export type DbProxyClientConfig = NonNullable<Parameters<typeof Ping>[1]>;

/**
 * Client config for every db-proxy call connectors makes, the adapters' included.
 * Each call carries the service token and is aborted after `timeoutMs`:
 * twirpscript's default transport is a bare fetch, which waits for as long as
 * the server holds the connection.
 */
export function dbProxyClientConfig(baseURL: string, token: string, timeoutMs: number): DbProxyClientConfig {
  if (!(Number.isInteger(timeoutMs) && timeoutMs > 0)) {
    throw new Error(`the db-proxy timeout must be a whole number of milliseconds above 0, got ${timeoutMs}`);
  }
  return {
    ...serviceAuthConfig(baseURL, token),
    rpcTransport: (url, { method, headers, body }) =>
      fetch(url, {
        method,
        headers,
        // fetch's types take only ArrayBuffer-backed views; twirpscript's body may sit on any buffer.
        body: body instanceof Uint8Array ? new Uint8Array(body) : body,
        signal: AbortSignal.timeout(timeoutMs),
      }),
  };
}

/** db-proxy over HTTP. Connecting pings it, so the runtime waits for it before the host starts. */
export default class DbProxyService implements Service<DbProxyClientConfig> {
  readonly healthcheck = true;
  readonly name = "dbProxy";
  readonly type = "db";
  readonly client: DbProxyClientConfig;
  connected = false;

  constructor(baseURL: string, token: string, timeoutMs: number) {
    this.client = dbProxyClientConfig(baseURL, token, timeoutMs);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await Ping({}, this.client);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
