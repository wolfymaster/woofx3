// The engine event stream: the envelopes the engine POSTs to a client's
// callback URL (./webhooks), pushed instead over the client's capnweb
// WebSocket session (`subscribeEngineEvents` on `Woofx3EngineApi`), together
// with the requests the engine needs a client to answer.
//
// One schema for both transports: a frame carries the same `CallbackEnvelope`
// or `RequestEnvelope` a webhook body would, so a consumer can share its
// handlers between them and stay idempotent on the envelope `id`.
//
// Delivery is not gapless. It is at most once and in order per subscription,
// with no replay: a client misses whatever happened before it subscribed and
// while it was disconnected, and a subscriber that falls too far behind has
// its oldest undelivered frames dropped. `seq` makes a drop visible. A client
// re-reads the state it shows when it subscribes and whenever `seq` skips.

import type { CallbackEnvelope, EngineEventType, RequestEnvelope } from "./webhooks";

/** What a frame carries: a state-change notification, or a request to answer. */
export type EngineEventMessage =
  | { kind: "event"; envelope: CallbackEnvelope }
  | {
      kind: "request";
      /** Answer it with `answerEngineRequest(envelope.id, answer)`. */
      envelope: RequestEnvelope;
    };

export type EngineEventFrame = EngineEventMessage & {
  /**
   * Starts at 1 for each subscription and rises by one for every frame due
   * to it, delivered or not. A jump of more than one means frames were
   * dropped because the subscriber fell behind.
   */
  seq: number;
};

/**
 * The callback a client passes to `subscribeEngineEvents`. It is a capnweb
 * stub, so it stays live for the duration of the session and the engine drops
 * it when the session breaks. The engine waits for each call before pushing
 * the next frame, and a call that rejects ends the subscription: a handler
 * catches its own errors.
 */
export interface EngineEventSubscriber {
  onEngineEvent(frame: EngineEventFrame): Promise<void>;
}

export interface EngineEventSubscribeOptions {
  /**
   * The event types to push. Absent pushes every event. A type the engine
   * does not know fails the subscribe call. Requests are pushed whatever this
   * says: a client with a subscription is the one the engine asks.
   */
  types?: EngineEventType[];
}

/**
 * A client's answer to a request it received on the stream. `ok: true`
 * carries the body a callback URL would have answered with (for example a
 * `TwitchTokenRequestedResponse`). `ok: false` refuses, as a non-2xx status
 * does over HTTP; `error` is logged and reported to the engine-side caller.
 */
export type EngineRequestAnswer = { ok: true; body: unknown } | { ok: false; error: string };
