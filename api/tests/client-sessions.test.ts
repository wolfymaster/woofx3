import { describe, expect, test } from "bun:test";
import { CLIENT_REVOKED_CLOSE_CODE, isAuthenticationRefused } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { ClientRevoker, ClientSessions, type SessionLease } from "../src/client-sessions";
import { type ConnectionInfo, ConnectionLifetime } from "../src/gateway-connection";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;

/** What `lease.assertLive()` threw, or null when it did not. */
function refusalOf(lease: SessionLease): unknown {
  try {
    lease.assertLive();
    return null;
  } catch (err) {
    return err;
  }
}

/** A WebSocket-like connection that records each close, and can be ended. */
function socket(close: ((code: number, reason: string) => void) | null = null) {
  const closes: [number, string][] = [];
  const lifetime = new ConnectionLifetime(() => {});
  const connection: ConnectionInfo = {
    origin: null,
    remoteAddress: null,
    close:
      close ??
      ((code, reason) => {
        closes.push([code, reason]);
      }),
    onEnd: (listener) => lifetime.onEnd(listener),
  };
  return { connection, closes, end: () => lifetime.end() };
}

/** Deferred tasks, run when the test says so. */
function manualDefer() {
  const tasks: (() => void)[] = [];
  return {
    defer: (task: () => void) => {
      tasks.push(task);
    },
    run: () => {
      for (const task of tasks.splice(0)) {
        task();
      }
    },
  };
}

describe("ClientSessions", () => {
  test("a registered session is live until its client is revoked", () => {
    const sessions = new ClientSessions(logger);
    const lease = sessions.register("c1", sessions.generation("c1"), socket().connection);

    expect(lease).not.toBeNull();
    expect(refusalOf(lease!)).toBeNull();

    sessions.revoke("c1");

    expect(isAuthenticationRefused(refusalOf(lease!))).toBe(true);
    expect(sessions.size).toBe(0);
  });

  test("revoking closes each socket of that client after the current task, and no other", () => {
    const { defer, run } = manualDefer();
    const sessions = new ClientSessions(logger, defer);
    const first = socket();
    const second = socket();
    const other = socket();
    sessions.register("c1", 0, first.connection);
    sessions.register("c1", 0, second.connection);
    const otherLease = sessions.register("c2", 0, other.connection)!;

    sessions.revoke("c1");
    expect(first.closes).toEqual([]);
    run();

    expect(first.closes).toEqual([[CLIENT_REVOKED_CLOSE_CODE, "client revoked"]]);
    expect(second.closes).toEqual([[CLIENT_REVOKED_CLOSE_CODE, "client revoked"]]);
    expect(other.closes).toEqual([]);
    expect(refusalOf(otherLease)).toBeNull();
  });

  test("a socket that still carries another client's live session stays open", () => {
    const { defer, run } = manualDefer();
    const sessions = new ClientSessions(logger, defer);
    const shared = socket();
    const doomed = sessions.register("doomed", 0, shared.connection)!;
    const admin = sessions.register("admin", 0, shared.connection)!;

    sessions.revoke("doomed");
    run();

    expect(shared.closes).toEqual([]);
    expect(isAuthenticationRefused(refusalOf(doomed))).toBe(true);
    expect(refusalOf(admin)).toBeNull();

    sessions.revoke("admin");
    run();
    expect(shared.closes).toEqual([[CLIENT_REVOKED_CLOSE_CODE, "client revoked"]]);
  });

  test("a registration whose generation predates a revocation is refused", () => {
    const sessions = new ClientSessions(logger);
    const seen = sessions.generation("c1");

    sessions.revoke("c1");

    expect(sessions.register("c1", seen, socket().connection)).toBeNull();
    expect(sessions.register("c1", sessions.generation("c1"), socket().connection)).not.toBeNull();
  });

  test("a released session is forgotten and not closed by a later revocation", () => {
    const { defer, run } = manualDefer();
    const sessions = new ClientSessions(logger, defer);
    const conn = socket();
    const lease = sessions.register("c1", 0, conn.connection)!;

    lease.release();
    lease.release();
    expect(sessions.size).toBe(0);
    sessions.revoke("c1");
    run();

    expect(conn.closes).toEqual([]);
  });

  test("a connection that ends releases its sessions", () => {
    const sessions = new ClientSessions(logger);
    const conn = socket();
    sessions.register("c1", 0, conn.connection);
    sessions.register("c2", 0, conn.connection);

    conn.end();

    expect(sessions.size).toBe(0);
  });

  test("a close that throws still leaves every session revoked", () => {
    const { defer, run } = manualDefer();
    const sessions = new ClientSessions(logger, defer);
    const failing = sessions.register(
      "c1",
      0,
      socket(() => {
        throw new Error("socket gone");
      }).connection
    )!;
    const working = socket();
    const later = sessions.register("c1", 0, working.connection)!;

    sessions.revoke("c1");
    run();

    expect(isAuthenticationRefused(refusalOf(failing))).toBe(true);
    expect(isAuthenticationRefused(refusalOf(later))).toBe(true);
    expect(working.closes).toHaveLength(1);
  });
});

describe("ClientSessions hardening", () => {
  test("a lease the registry no longer tracks is still refused once its client is revoked", () => {
    const sessions = new ClientSessions(logger);
    const lease = sessions.register("c1", 0, socket().connection)!;
    lease.release();

    sessions.revoke("c1");

    expect(isAuthenticationRefused(refusalOf(lease))).toBe(true);
  });

  test("a socket another session joined before the deferred close stays open", () => {
    const { defer, run } = manualDefer();
    const sessions = new ClientSessions(logger, defer);
    const conn = socket();
    sessions.register("doomed", 0, conn.connection);

    sessions.revoke("doomed");
    sessions.register("admin", 0, conn.connection);
    run();

    expect(conn.closes).toEqual([]);
  });

  test("revoking runs each session's revoke listeners and logs how many sessions it ended", () => {
    const infos: unknown[][] = [];
    const recording = { ...logger, info: (...args: unknown[]) => infos.push(args) } as unknown as SharedLogger;
    const sessions = new ClientSessions(recording);
    const dropped: string[] = [];
    sessions.register("c1", 0, socket().connection)!.onRevoke(() => dropped.push("first"));
    sessions.register("c1", 0, socket().connection)!.onRevoke(() => dropped.push("second"));

    sessions.revoke("c1");

    expect(dropped).toEqual(["first", "second"]);
    expect(infos).toContainEqual(["Ended a revoked client's sessions", { clientId: "c1", sessions: 2 }]);
  });
});

describe("ClientRevoker", () => {
  test("forgets the trusted credentials, ends the sessions and drops the event subscriptions", () => {
    const calls: string[] = [];
    const sessions = new ClientSessions(logger);
    const lease = sessions.register("c1", 0, socket().connection)!;
    const revoker = new ClientRevoker(
      { invalidateCache: () => calls.push("cache") },
      sessions,
      { dropClient: (clientId: string) => calls.push(`events:${clientId}`) },
      { dropClient: (clientId: string) => calls.push(`callbacks:${clientId}`) }
    );

    revoker.revoke("c1");

    expect(calls).toEqual(["cache", "events:c1", "callbacks:c1"]);
    expect(isAuthenticationRefused(refusalOf(lease))).toBe(true);
  });
});
