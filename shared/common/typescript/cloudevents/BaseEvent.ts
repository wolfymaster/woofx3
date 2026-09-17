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
  /**
   * CloudEvents extension attribute correlating this event with whoever asked
   * for it.
   *
   * Unlike `sessionId`, it is never stamped automatically: only a caller that
   * intends to wait on the outcome supplies one. It travels unchanged onto the
   * workflow run events the engine emits, which is what lets that caller learn
   * what its event actually caused -- publishing is asynchronous, so the
   * outcome is never in the publish call's own result.
   */
  triggerId?: string;
  /**
   * CloudEvents extension attribute naming what caused this event
   * ("dashboard", "twitch", ...).
   *
   * Distinct from `source`, which names the service that published it: the api
   * publishes on behalf of several different origins, and only this says which.
   */
  triggeredBy?: string;
  data: T;
}

export default function Event<T>(opts: Partial<BaseEvent<T>>, data: T): BaseEvent<T> {
  return {
    specversion: "1.0.0",
    type: "unknown",
    source: "unknown",
    // CloudEvents makes `source` + `id` the uniqueness key, so a fixed default
    // would leave every event from a given source indistinguishable from every
    // other -- no consumer could dedupe, and a module reading `ctx.event.id`
    // would see the same value forever. No factory passes an id, so generating
    // one here is what makes the key usable at all.
    id: crypto.randomUUID(),
    time: new Date(),
    // Before the spread, so an explicit sessionId in opts still wins. Undefined
    // drops out at JSON.stringify, so an unknown session omits the attribute
    // rather than emitting a null.
    sessionId: getCurrentSessionId(),
    data,
    ...opts,
  };
}
