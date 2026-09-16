import { getCurrentSessionId } from "./session";

export interface BaseEvent<T> {
  specversion: string;
  type: string;
  source: string;
  id: string;
  time: Date;
  /**
   * CloudEvents extension attribute naming the platform an event came from
   * ("twitch", ...). Provenance, not payload: `type` says what happened,
   * `platform` says where, so a subscriber can take `channel.follow` from
   * every platform and narrow only when it cares.
   *
   * Absent on events that have no originating platform (module lifecycle,
   * db outbox, scheduler).
   */
  platform?: string;
  /**
   * CloudEvents extension attribute naming the stream session this event
   * happened during. Stamped centrally in `Event()` below, so every family
   * carries it -- unlike `platform`, which each factory sets for itself and
   * which only the Twitch one actually does.
   *
   * Not a stable key: a session can be split or merged afterwards, so a reader
   * aggregating events resolves this to a canonical session rather than
   * grouping on it directly. See docs/services/stream-sessions.md.
   *
   * Absent when the publishing process does not yet know a session -- before
   * the first `session.started` reaches it, or if it was never wired up.
   */
  sessionId?: string;
  data: T;
}

export default function Event<T>(opts: Partial<BaseEvent<T>>, data: T): BaseEvent<T> {
  return {
    specversion: "1.0.0",
    type: "unknown",
    source: "unknown",
    id: "unknown",
    time: new Date(),
    // Before the spread, so an explicit sessionId in opts still wins. Undefined
    // drops out at JSON.stringify, so an unknown session omits the attribute
    // rather than emitting a null.
    sessionId: getCurrentSessionId(),
    data,
    ...opts,
  };
}
