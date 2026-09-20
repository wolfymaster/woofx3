/**
 * Whether a stream going live continues the open session or starts a new one.
 *
 * This is the whole of the session policy, kept separate from the resolver that
 * applies it so the rule can change without touching persistence, and so it can
 * be tested without a broadcast. Everything else in the system consumes the
 * resolver's output and knows nothing about grace windows.
 *
 * The decision is made at `stream.online` and nowhere else. A session is always
 * present and only ends when a new one replaces it, so nothing is ever pending:
 * there is no scheduled close to fire, and a process restart mid-gap loses
 * nothing as long as the session row itself persisted.
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
 * `extend` continues it and opens a new segment; `split` closes it, emits
 * `session.ended`, and opens a fresh session. Both are decisions about the
 * *open* session -- there is always one, so this never has to answer "no
 * session".
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

  // Never been live in this session, so there is no gap to measure and nothing
  // to split away from.
  if (state.lastSegmentEndedAt === undefined) {
    return "extend";
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
