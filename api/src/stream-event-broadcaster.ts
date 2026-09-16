import type { StreamEventFrame, StreamEventSubscriber } from "@woofx3/api";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";

/**
 * Chat (`EventType.ChatMessage`) is deliberately absent. It is the only
 * high-volume subject, and nothing on this path applies backpressure: the
 * WebSocket adapter ignores `bufferedAmount`, and capnweb serializes pushes
 * per session, so a firehose would queue unbounded in the engine's memory. The
 * events below fire at human pace, which this fan-out can carry as-is. Chat
 * needs batching designed for it before it can join.
 */
const BROADCAST_SUBJECTS: readonly EventType[] = [
  EventType.Follow,
  EventType.Cheer,
  EventType.Subscribe,
  EventType.SubscriptionGift,
  EventType.Raid,
  EventType.StreamOnline,
  EventType.StreamOffline,
];

/** capnweb stubs carry this; the contract types the argument as a plain object. */
type MaybeStub = Partial<{ onRpcBroken(callback: (error: unknown) => void): void }>;

/**
 * Fans stream events out to browser clients over their existing capnweb
 * session.
 *
 * A second consumer of these subjects alongside AlertEmitter rather than a hook
 * into it: core NATS delivers to every subscriber, so the extra subscription is
 * free, and AlertEmitter's job is mapping to Convex alert webhooks — it
 * discards the CloudEvent envelope this needs.
 */
export class StreamEventBroadcaster {
  private subscribers = new Set<StreamEventSubscriber>();

  constructor(
    private nats: NATSClient,
    private logger: SharedLogger
  ) {}

  async start(): Promise<void> {
    for (const subject of BROADCAST_SUBJECTS) {
      await this.bind(subject);
    }
    this.logger.info("StreamEventBroadcaster started", { subjects: BROADCAST_SUBJECTS.length });
  }

  /**
   * Register a client callback for the life of its session.
   *
   * Eviction is driven by `onRpcBroken`, the signal capnweb raises when the
   * peer goes away. The older triggerSubscribers set has no disconnect path at
   * all -- it only drops a subscriber whose call happens to reject, so a closed
   * tab lingers until the next event, and forever if none arrives.
   */
  subscribe(subscriber: StreamEventSubscriber): void {
    this.subscribers.add(subscriber);
    const stub = subscriber as MaybeStub;
    stub.onRpcBroken?.(() => {
      this.subscribers.delete(subscriber);
      this.logger.debug("StreamEventBroadcaster: subscriber disconnected", {
        remaining: this.subscribers.size,
      });
    });
  }

  /** Exposed for tests and diagnostics. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private async bind(subject: string): Promise<void> {
    await this.nats.subscribe(subject, (msg: Msg) => {
      this.handle(subject, msg);
    });
  }

  private handle(subject: string, msg: Msg): void {
    if (this.subscribers.size === 0) {
      return;
    }

    let frame: StreamEventFrame;
    try {
      frame = toFrame(subject, msg.json() as Record<string, unknown>);
    } catch (err) {
      this.logger.error("StreamEventBroadcaster: failed to decode CloudEvent", {
        subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Not awaited, and not sequential: notifyTriggerChange awaits each
    // subscriber in turn, so one slow or hanging client delays delivery to
    // everyone behind it. A failed push is logged rather than evicted --
    // onRpcBroken is the authoritative signal that a client is gone, and a
    // handler that threw once is not necessarily dead.
    for (const subscriber of this.subscribers) {
      void Promise.resolve()
        .then(() => subscriber.onStreamEvent(frame))
        .catch((err) => {
          this.logger.warn("StreamEventBroadcaster: push failed", {
            subject,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }
}

/**
 * The publisher wraps payloads in a CloudEvent, but `ce.data ?? ce` mirrors
 * AlertEmitter: some producers publish the payload bare. The subject is the
 * fallback for `type` because the EventType value is both.
 */
function toFrame(subject: string, ce: Record<string, unknown>): StreamEventFrame {
  return {
    id: typeof ce.id === "string" ? ce.id : undefined,
    type: typeof ce.type === "string" ? ce.type : subject,
    source: typeof ce.source === "string" ? ce.source : "engine",
    time: typeof ce.time === "string" ? ce.time : new Date().toISOString(),
    platform: typeof ce.platform === "string" ? ce.platform : undefined,
    data: ce.data ?? ce,
  };
}
