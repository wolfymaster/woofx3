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
