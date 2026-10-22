import type { SharedLogger } from "@woofx3/common/logging";
import { CLIENT_REVOKED_CLOSE_CODE } from "@woofx3/api/rpc";
import type { Api } from "./api";
import type { ClientAuth } from "./auth";
import type { EngineEventStream } from "./engine-event-stream";
import { AuthenticationRefused } from "./gateway";
import type { ConnectionInfo } from "./gateway-connection";
import type { WebhookClient } from "./webhook-client";

/** The reason a revoked session gives, on its calls and on its closed socket. */
const CLIENT_REVOKED = "client revoked";

/**
 * One authenticated session's standing. It is live until its client is
 * revoked, and then refuses every call that starts: an HTTP batch has no
 * socket to close, and a WebSocket frame may already be in flight when its
 * socket closes. A call already running when the revocation lands finishes.
 *
 * Revocation is checked two ways: the registry revokes the lease, and the
 * lease compares the client's generation with the one it was issued under.
 * The second holds even for a lease the registry no longer tracks, such as
 * one capnweb disposed early.
 */
export class SessionLease {
  private revoked = false;
  private released = false;

  /**
   * @param onRelease forgets the session in its registry; run at most once.
   * @param current whether the client is still on the generation the lease
   *   was issued under.
   */
  constructor(
    private readonly onRelease: () => void,
    private readonly current: () => boolean = () => true
  ) {}

  revoke(): void {
    this.revoked = true;
  }

  get live(): boolean {
    return !this.revoked && !this.released && this.current();
  }

  /** The session is gone (disposed, or its connection ended). Releasing twice is a no-op. */
  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.onRelease();
  }

  /** Throws the refusal a client recognises once the lease is revoked. */
  assertLive(): void {
    if (this.revoked || !this.current()) {
      throw new AuthenticationRefused(CLIENT_REVOKED);
    }
  }
}

/**
 * What deleting a client does to the sessions it holds, beyond the db
 * delete: ends them, and forgets the credentials the engine trusted for it.
 */
export interface ClientRevocation {
  revoke(clientId: string): void;
}

/** Runs a task after the current one, once its replies have been sent. */
export type Defer = (task: () => void) => void;

const nextMacrotask: Defer = (task) => {
  setTimeout(task, 0);
};

/**
 * Every live session, by client and by connection, so deleting a client ends
 * the sessions it already holds.
 *
 * Authentication and revocation race: `authenticate` validates against
 * db-proxy asynchronously, and the client may be deleted meanwhile. Each
 * client therefore has a generation that every revocation bumps.
 * `authenticate` reads it before validating and registers only if it is
 * unchanged afterwards, so a session whose validation overlapped a
 * revocation is refused instead of outliving it.
 */
export class ClientSessions {
  private generations = new Map<string, number>();
  private byClient = new Map<string, Map<SessionLease, ConnectionInfo>>();
  private byConnection = new Map<ConnectionInfo, Set<SessionLease>>();

  /**
   * @param defer when a revoked connection is closed. The close waits for the
   *   next macrotask so that a reply already resolving on that socket, such as
   *   the answer to a client deleting itself, is sent first. The lease refuses
   *   every call in between.
   */
  constructor(
    private readonly logger: SharedLogger,
    private readonly defer: Defer = nextMacrotask
  ) {}

  /** Read before validating a client's credentials; pass to `register`. */
  generation(clientId: string): number {
    return this.generations.get(clientId) ?? 0;
  }

  /** How many sessions are registered, across every client. */
  get size(): number {
    let size = 0;
    for (const leases of this.byClient.values()) {
      size += leases.size;
    }
    return size;
  }

  /**
   * A lease for a new session of `clientId` on `connection`, or null when the
   * client was revoked since `seenGeneration` was read. The session is
   * forgotten when its lease is released or its connection ends.
   */
  register(clientId: string, seenGeneration: number, connection: ConnectionInfo): SessionLease | null {
    if (this.generation(clientId) !== seenGeneration) {
      return null;
    }
    const lease = new SessionLease(
      () => this.forget(clientId, lease, connection),
      () => this.generation(clientId) === seenGeneration
    );
    let leases = this.byClient.get(clientId);
    if (!leases) {
      leases = new Map();
      this.byClient.set(clientId, leases);
    }
    leases.set(lease, connection);
    let onConnection = this.byConnection.get(connection);
    if (!onConnection) {
      onConnection = new Set();
      this.byConnection.set(connection, onConnection);
      connection.onEnd(() => this.endConnection(connection));
    }
    onConnection.add(lease);
    return lease;
  }

  /**
   * End every session `clientId` holds and refuse any it is still
   * authenticating. Each session's calls are refused from now on. A WebSocket
   * is closed with `CLIENT_REVOKED_CLOSE_CODE` once none of its sessions is
   * live, so a socket that also carries another client's session stays open
   * for it.
   */
  revoke(clientId: string): void {
    this.generations.set(clientId, this.generation(clientId) + 1);
    const leases = this.byClient.get(clientId);
    if (!leases) {
      return;
    }
    const ended = leases.size;
    const connections = new Set(leases.values());
    for (const lease of [...leases.keys()]) {
      lease.revoke();
      lease.release();
    }
    // Decided when the task runs, not now: another client may authenticate
    // on one of these sockets before then, and its session must keep it open.
    this.defer(() => {
      for (const connection of connections) {
        if (connection.close !== null && this.byConnection.has(connection) && !this.hasLive(connection)) {
          this.close(clientId, connection);
        }
      }
    });
    this.logger.info("Ended a revoked client's sessions", { clientId, sessions: ended });
  }

  private hasLive(connection: ConnectionInfo): boolean {
    for (const lease of this.byConnection.get(connection) ?? []) {
      if (lease.live) {
        return true;
      }
    }
    return false;
  }

  private close(clientId: string, connection: ConnectionInfo): void {
    try {
      connection.close?.(CLIENT_REVOKED_CLOSE_CODE, CLIENT_REVOKED);
    } catch (err) {
      // The lease already refuses every call, and the client's
      // subscriptions ended with the revocation; the socket itself is left
      // to time out.
      this.logger.warn("Could not close a revoked client's connection", {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private endConnection(connection: ConnectionInfo): void {
    for (const lease of [...(this.byConnection.get(connection) ?? [])]) {
      lease.release();
    }
    this.byConnection.delete(connection);
  }

  private forget(clientId: string, lease: SessionLease, connection: ConnectionInfo): void {
    const leases = this.byClient.get(clientId);
    leases?.delete(lease);
    if (leases?.size === 0) {
      this.byClient.delete(clientId);
    }
    // The connection's entry stays, empty, until the connection ends, so its
    // end listener is registered once however many sessions come and go.
    this.byConnection.get(connection)?.delete(lease);
  }
}

/**
 * Everything deleting a client does besides the db delete: forgets the
 * credentials the engine trusted for it, ends its sessions, and stops every
 * delivery to it: engine events over the event stream and to its callback
 * URL, stream events and trigger changes. It is then not offered as a client
 * that can answer a request. Revoking a client whose delete did not happen
 * is safe: it authenticates again, and the next callback refresh lists it.
 */
export class ClientRevoker implements ClientRevocation {
  constructor(
    private readonly auth: Pick<ClientAuth, "invalidateCache">,
    private readonly sessions: ClientSessions,
    private readonly eventStream: Pick<EngineEventStream, "dropClient">,
    private readonly webhooks: Pick<WebhookClient, "dropClient">,
    private readonly subscriptions: Pick<Api, "dropClientSubscriptions">
  ) {}

  revoke(clientId: string): void {
    this.auth.invalidateCache();
    this.sessions.revoke(clientId);
    this.eventStream.dropClient(clientId);
    this.webhooks.dropClient(clientId);
    // By client id, not through the sessions: a session the client already
    // disposed is no longer tracked, but its callbacks may still be held.
    this.subscriptions.dropClientSubscriptions(clientId);
  }
}
