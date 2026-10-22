import type { SharedLogger } from "@woofx3/common/logging";
import { CLIENT_REVOKED_CLOSE_CODE } from "@woofx3/api/rpc";
import { AuthenticationRefused } from "./gateway";
import type { ConnectionInfo } from "./gateway-connection";

/** The reason a revoked session gives, on its calls and on its closed socket. */
const CLIENT_REVOKED = "client revoked";

/**
 * One authenticated session's standing. It is live until its client is
 * revoked, and then refuses every call: an HTTP batch has no socket to close,
 * and a WebSocket frame may already be in flight when its socket closes.
 */
export class SessionLease {
  private revoked = false;

  revoke(): void {
    this.revoked = true;
  }

  /** Throws the refusal a client recognises once the lease is revoked. */
  assertLive(): void {
    if (this.revoked) {
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

interface Registration {
  lease: SessionLease;
  close: ConnectionInfo["close"];
}

/**
 * Every live session, by client id, so deleting a client ends the sessions
 * it already holds.
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
  private live = new Map<string, Set<Registration>>();

  constructor(private readonly logger: SharedLogger) {}

  /** Read before validating a client's credentials; pass to `register`. */
  generation(clientId: string): number {
    return this.generations.get(clientId) ?? 0;
  }

  /**
   * A lease for a new session of `clientId`, or null when the client was
   * revoked since `seenGeneration` was read. `close` ends the session's
   * connection when the client is revoked; null for a transport with nothing
   * to close.
   */
  register(clientId: string, seenGeneration: number, close: ConnectionInfo["close"]): SessionLease | null {
    if (this.generation(clientId) !== seenGeneration) {
      return null;
    }
    const lease = new SessionLease();
    let registrations = this.live.get(clientId);
    if (!registrations) {
      registrations = new Set();
      this.live.set(clientId, registrations);
    }
    registrations.add({ lease, close });
    return lease;
  }

  /** Forget a session whose connection ended. Releasing one already gone is a no-op. */
  release(clientId: string, lease: SessionLease): void {
    const registrations = this.live.get(clientId);
    if (!registrations) {
      return;
    }
    for (const registration of registrations) {
      if (registration.lease === lease) {
        registrations.delete(registration);
      }
    }
    if (registrations.size === 0) {
      this.live.delete(clientId);
    }
  }

  /**
   * End every session `clientId` holds and refuse any it is still
   * authenticating. Each session's calls are refused from now on, and its
   * WebSocket is closed with `CLIENT_REVOKED_CLOSE_CODE`. A connection that
   * also carries a session of another client closes with it: the socket is
   * the unit a client reconnects, so the other session re-authenticates.
   */
  revoke(clientId: string): void {
    this.generations.set(clientId, this.generation(clientId) + 1);
    const registrations = this.live.get(clientId);
    this.live.delete(clientId);
    if (!registrations) {
      return;
    }
    // Every lease first, so a close that throws cannot leave a session live.
    for (const { lease } of registrations) {
      lease.revoke();
    }
    for (const { close } of registrations) {
      try {
        close?.(CLIENT_REVOKED_CLOSE_CODE, CLIENT_REVOKED);
      } catch (err) {
        // The lease already refuses every call, so the session is ended
        // either way; the socket is left to its own timeout.
        this.logger.warn("Could not close a revoked client's connection", {
          clientId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.logger.info("Ended a revoked client's sessions", { clientId, sessions: registrations.size });
  }
}
