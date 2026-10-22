import type { ApiGatewayContract, RegisterClientOptions } from "@woofx3/api/rpc";
import { RpcTarget } from "capnweb";
import type { ApiSession } from "./api-session";
import type { ApiGateway } from "./gateway";

/** What the transport knows about the connection a gateway call arrived on. */
export interface ConnectionInfo {
  /** The request's `Origin` header; null when it carried none, as a non-browser caller does. */
  origin: string | null;
  /** The peer the socket came from. Behind a reverse proxy this is the proxy. */
  remoteAddress: string | null;
  /**
   * Ends the connection with a WebSocket close code and reason. Null for an
   * HTTP batch: its response is the whole connection, so nothing stays open.
   */
  close: ((code: number, reason: string) => void) | null;
}

/**
 * The unauthenticated gateway as one connection sees it. `http.ts` builds one
 * per WebSocket and per HTTP batch, so each call reaches the shared
 * `ApiGateway` together with the connection it came from. Only the
 * contract's methods live on the prototype, so capnweb serves nothing else.
 */
export class GatewayConnection extends RpcTarget implements ApiGatewayContract {
  constructor(
    private readonly gateway: ApiGateway,
    private readonly connection: ConnectionInfo
  ) {
    super();
  }

  ping(): Promise<{ status: string }> {
    return this.gateway.ping();
  }

  registerClient(
    description: string,
    options: RegisterClientOptions
  ): Promise<{ clientId: string; clientSecret: string }> {
    return this.gateway.registerClient(description, options);
  }

  authenticate(clientId: string, clientSecret: string): Promise<ApiSession> {
    return this.gateway.authenticate(clientId, clientSecret, this.connection);
  }
}
