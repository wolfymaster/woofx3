// The engine -> browser stream-event push contract, carried over the caller's
// existing capnweb WebSocket session (`subscribeStreamEvents` on
// `Woofx3EngineApi`).
//
// The frame is deliberately the same flattened CloudEvent that
// `OverlayEventFrame` (./overlay-events) carries and that the api service's
// `publishEvent` builds, so one event vocabulary reaches every browser surface
// rather than each growing its own.
//
// Delivery is explicitly not gapless: there is no replay buffer behind this
// (core NATS, no JetStream), so a subscriber that connects late or reconnects
// has missed whatever happened in between. Consumers should re-read their
// point-in-time state on reconnect rather than assume a continuous stream --
// the same stance the overlay protocol documents.

/** A stream event pushed to a subscribed client. */
export interface StreamEventFrame {
  /** Originating CloudEvent id, when the publisher set one. */
  id?: string;
  /** Event type, e.g. `channel.follow`. Also the NATS subject it arrived on. */
  type: string;
  /** CloudEvent source. */
  source: string;
  /** RFC3339 timestamp. */
  time: string;
  /** Top-level CloudEvents extension attribute naming the originating platform. */
  platform?: string;
  /** Event payload — opaque at this boundary. */
  data: unknown;
}

/**
 * The callback a client passes to `subscribeStreamEvents`. It is a capnweb
 * stub, so it stays live for the duration of the session and the engine drops
 * it when the session breaks.
 */
export interface StreamEventSubscriber {
  onStreamEvent(frame: StreamEventFrame): Promise<void>;
}

/**
 * A page of the engine's event log, for `listEvents`.
 *
 * The log holds the event types the streamer selected (`EventLogSettings`)
 * plus the analytics types, recorded whatever the selection, minus events the
 * api published itself (dashboard tests, `source: "api"`). A type is logged
 * from the moment it is selected, never retroactively.
 */
export interface EventLogQuery {
  /** Event types (CloudEvent `type`) to return. Absent or empty returns every type. */
  types?: string[];
  /** The `nextCursor` of the previous page; absent for the newest page. */
  cursor?: string;
  /** 1-100. Defaults to 50. */
  limit?: number;
}

export interface EventLogPage {
  /**
   * Newest first. The same frame shape `subscribeStreamEvents` pushes, so a
   * client can merge history and live events by `id`. `id` is always set on
   * a logged event.
   */
  events: StreamEventFrame[];
  /** Opaque; pass back as `cursor` for the next older page. Null on the last page. */
  nextCursor: string | null;
}

/**
 * Which event types the engine logs and the Events widget shows: one
 * selection per engine, edited from the widget's filter. Event types are
 * CloudEvent `type`s (a trigger's `event`).
 *
 * Stored as overrides on the defaults rather than as a full list, so a newly
 * installed module's default-on types appear without anyone re-selecting.
 */
export interface EventLogSelection {
  /** Types turned on beyond the defaults. */
  shown: string[];
  /** Types turned off, defaults included. */
  hidden: string[];
}

export interface EventLogSettings {
  selection: EventLogSelection;
  /**
   * The types on by default: installed `eventbus` triggers with an `alert.*`
   * taxonomy entry, except `alert.chat` and `alert.shared` and anything under
   * them.
   */
  defaults: string[];
  /**
   * Every type the streamer may select: the subjects of installed `eventbus`
   * triggers, without wildcards, without chat messages (`user.message`, which
   * has its own channel) and without the `channel.shared*` events.
   */
  offered: string[];
  /** `(defaults ∪ shown) − hidden`, within `offered`. What the widget shows. */
  enabled: string[];
}
