import { describe, expect, test } from "bun:test";
import { CLIENT_REVOKED_CLOSE_CODE, isAuthenticationRefused } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { ClientSessions, type SessionLease } from "../src/client-sessions";

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

/** A close function that records each call. */
function recordingClose() {
  const calls: [number, string][] = [];
  return { calls, close: (code: number, reason: string) => calls.push([code, reason]) };
}

describe("ClientSessions", () => {
  test("a registered session is live until its client is revoked", () => {
    const sessions = new ClientSessions(logger);
    const lease = sessions.register("c1", sessions.generation("c1"), null);

    expect(lease).not.toBeNull();
    expect(refusalOf(lease!)).toBeNull();

    sessions.revoke("c1");

    expect(isAuthenticationRefused(refusalOf(lease!))).toBe(true);
  });

  test("revoking closes every connection of that client, and only that client", () => {
    const sessions = new ClientSessions(logger);
    const first = recordingClose();
    const second = recordingClose();
    const other = recordingClose();
    sessions.register("c1", 0, first.close);
    sessions.register("c1", 0, second.close);
    const otherLease = sessions.register("c2", 0, other.close);

    sessions.revoke("c1");

    expect(first.calls).toEqual([[CLIENT_REVOKED_CLOSE_CODE, "client revoked"]]);
    expect(second.calls).toEqual([[CLIENT_REVOKED_CLOSE_CODE, "client revoked"]]);
    expect(other.calls).toEqual([]);
    expect(refusalOf(otherLease!)).toBeNull();
  });

  test("a registration whose generation predates a revocation is refused", () => {
    const sessions = new ClientSessions(logger);
    const seen = sessions.generation("c1");

    sessions.revoke("c1");

    expect(sessions.register("c1", seen, null)).toBeNull();
    expect(sessions.register("c1", sessions.generation("c1"), null)).not.toBeNull();
  });

  test("a released session is not closed by a later revocation", () => {
    const sessions = new ClientSessions(logger);
    const { calls, close } = recordingClose();
    const lease = sessions.register("c1", 0, close)!;

    sessions.release("c1", lease);
    sessions.release("c1", lease);
    sessions.revoke("c1");

    expect(calls).toEqual([]);
  });

  test("a close that throws still leaves every session revoked", () => {
    const sessions = new ClientSessions(logger);
    const failing = sessions.register("c1", 0, () => {
      throw new Error("socket gone");
    })!;
    const { calls, close } = recordingClose();
    const later = sessions.register("c1", 0, close)!;

    sessions.revoke("c1");

    expect(isAuthenticationRefused(refusalOf(failing))).toBe(true);
    expect(isAuthenticationRefused(refusalOf(later))).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
