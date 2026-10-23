import type {
  CancelPairingRequest,
  CancelPairingResponse,
  ClaimPairingRequest,
  ClaimPairingResponse,
  StartPairingRequest,
  StartPairingResponse,
} from "@woofx3/api/pairing";
import type { ApiGatewayContract, GatewayPingResponse, RegisterClientOptions } from "@woofx3/api/rpc";
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
  /** Runs `listener` once the connection has ended; at once if it already has. */
  onEnd(listener: () => void): void;
}

/**
 * The end of one connection, for the transport to announce and for whatever
 * lives as long as the connection to wait on.
 */
export class ConnectionLifetime {
  private listeners: (() => void)[] = [];
  private ended = false;

  constructor(private readonly onListenerError: (err: unknown) => void) {}

  onEnd(listener: () => void): void {
    if (this.ended) {
      listener();
      return;
    }
    this.listeners.push(listener);
  }

  /** Runs every listener once. Ending twice is a no-op. */
  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    const listeners = this.listeners;
    this.listeners = [];
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        this.onListenerError(err);
      }
    }
  }
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

  ping(): Promise<GatewayPingResponse> {
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

  startPairing(request: StartPairingRequest): Promise<StartPairingResponse> {
    return this.gateway.startPairing(request, this.connection);
  }

  claimPairing(request: ClaimPairingRequest): Promise<ClaimPairingResponse> {
    return this.gateway.claimPairing(request, this.connection);
  }

  cancelPairing(request: CancelPairingRequest): Promise<CancelPairingResponse> {
    return this.gateway.cancelPairing(request, this.connection);
  }
}
