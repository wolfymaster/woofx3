/**
 * Whether a platform's stream is live right now, as opposed to `stream.online`
 * and `stream.offline`, which say it just changed.
 *
 * Those two are only delivered as they happen, so an engine that was not running
 * at the time never hears them. These subjects carry the same fact as a state
 * rather than an occurrence, and they are never offered as workflow triggers:
 * learning the stream is already live must not replay what going live does.
 *
 * The value is also the NATS subject, matching the other event families.
 * See docs/services/stream-sessions.md.
 */
export enum EventType {
  /** A platform's current state. Published when a connection reads it, and in answer to a request. */
  StreamStatusObserved = "stream.status.observed",
  /** Asks every connected platform to publish its current state. Carries no data. */
  StreamStatusRequested = "stream.status.requested",
}

/** The data of `stream.status.observed`; the platform is the event's `platform` attribute. */
export interface StreamStatusObserved {
  live: boolean;
  /** When the live stream began, as an ISO 8601 time, when the platform says. Absent when offline. */
  startedAt?: string;
}
