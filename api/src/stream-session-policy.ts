/**
 * When a stream session ends: whether a stream going live continues the open
 * session or starts a new one, and when a stream that went down is over for good.
 *
 * This is the whole of the session policy, kept separate from the resolver that
 * applies it so the rule can change without touching persistence, and so it can
 * be tested without a broadcast. Everything else in the system consumes the
 * resolver's output and knows nothing about grace windows.
 *
 * A session is always present and only ends when another replaces it. A
 * broadcast's session ends at its last segment's end once the grace window has
 * passed, and an idle session (one with no segments) holds the offline time up
 * to the next broadcast. Both inputs persist, so a process restart mid-gap loses
 * nothing, and however late the check runs the boundary is the same.
 */

/**
 * How long a stream may be offline and still be treated as the same session.
 *
 * Ten minutes covers the failure this concept exists for -- a dropped
 * connection, a crashed encoder, a router reboot -- without swallowing a
 * deliberate break between two broadcasts on the same day. It is a default, not
 * a constant of nature; the whole point of this module is that it is one number
 * in one place.
 */
export const DEFAULT_SESSION_GRACE_MS = 10 * 60 * 1000;

export type SessionAction = "extend" | "split";

/** What the resolver knows about the open session when a stream goes live. */
export interface OpenSessionState {
  /** Epoch ms the session began. */
  startedAt: number;
  /**
   * Epoch ms the session's most recent segment ended. Undefined when the
   * session has never been live -- a session opened at startup, or one that has
   * so far existed entirely offline.
   */
  lastSegmentEndedAt?: number;
  /** True while a segment is open, i.e. the stream is already live. */
  isSegmentOpen: boolean;
}

/**
 * Decide what a `stream.online` means for the currently open session.
 *
 * `extend` continues it and opens a new segment; `split` closes it and opens a
 * fresh session for the broadcast. Both are decisions about the *open* session
 * -- there is always one, so this never has to answer "no session".
 */
export function decideOnStreamOnline(
  state: OpenSessionState,
  now: number,
  graceMs: number = DEFAULT_SESSION_GRACE_MS
): SessionAction {
  // Already live. Twitch redelivers EventSub notifications, and a duplicate
  // must not be read as a gap of zero followed by a new segment.
  if (state.isSegmentOpen) {
    return "extend";
  }

  // An idle session holds offline time, which must stay out of the broadcast's
  // session. The exception is a session that began after the stream did (the
  // engine started mid-broadcast): it holds no offline time, and splitting
  // would end it before it started.
  if (state.lastSegmentEndedAt === undefined) {
    return now > state.startedAt ? "split" : "extend";
  }

  const offlineFor = now - state.lastSegmentEndedAt;

  // A clock that went backwards -- an NTP correction, or an event whose
  // timestamp we trusted -- yields a negative gap. Treat it as no gap rather
  // than as an enormous one, which would split a session mid-stream.
  if (offlineFor < 0) {
    return "extend";
  }

  return offlineFor <= graceMs ? "extend" : "split";
}

/**
 * Whether the stream has stayed down past the grace window, so the session it
 * was live in is over. False for an idle session, which has no broadcast to end.
 */
export function isBroadcastOver(
  state: OpenSessionState,
  now: number,
  graceMs: number = DEFAULT_SESSION_GRACE_MS
): boolean {
  if (state.isSegmentOpen || state.lastSegmentEndedAt === undefined) {
    return false;
  }
  return now - state.lastSegmentEndedAt > graceMs;
}
