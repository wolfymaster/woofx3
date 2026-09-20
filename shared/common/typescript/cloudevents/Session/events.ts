/**
 * Stream session lifecycle.
 *
 * A session is the logical span a broadcast belongs to, and it is always
 * present: `stream.online` / `stream.offline` are inputs to a decision rather
 * than boundaries, so a session may be entirely offline. One component -- the
 * resolver in `api/` -- owns that decision and emits these two events;
 * everything else consumes them and knows nothing about grace windows.
 *
 * The value is also the NATS subject, matching the other event families.
 * See docs/services/stream-sessions.md.
 */
export enum EventType {
  /**
   * Names the session events should now be stamped with.
   *
   * Emitted when a new session opens, and again when the resolver starts, so a
   * process that came up late or restarted learns the current session rather
   * than publishing unstamped until the next broadcast. Re-announcing the same
   * id is expected; treat this as "the current session is X", not as "a
   * boundary just occurred".
   */
  SessionStarted = "session.started",
  /**
   * The previous session is over and anything scoped to it should be dropped.
   *
   * Fires on a split, *not* on `stream.offline`. It may arrive long after a
   * stream ended, and for a brief dropout it never arrives at all. Anything
   * that clears state must listen for this rather than for the stream going
   * down, or a reconnect wipes exactly the state sessions exist to preserve.
   */
  SessionEnded = "session.ended",
}

export interface SessionStarted {
  sessionId: string;
  applicationId: string;
  /** ISO 8601. */
  startedAt: string;
}

export interface SessionEnded {
  sessionId: string;
  applicationId: string;
  /** ISO 8601. */
  endedAt: string;
  /**
   * The session that replaced this one. A session only ends by being replaced,
   * so this is always set -- it lets a consumer follow the chain without a
   * second lookup.
   */
  replacedBySessionId: string;
}
