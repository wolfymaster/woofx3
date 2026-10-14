import type { StreamEventFrame, StreamEventSubscriber } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { type EventCatalog, SubjectSubscriptions } from "./event-catalog";

/** capnweb stubs carry this; the contract types the argument as a plain object. */
type MaybeStub = Partial<{ onRpcBroken(callback: (error: unknown) => void): void }>;

/**
 * Fans stream events out to browser clients over their existing capnweb
 * session: every subject of the `EventCatalog`, the same set the event log
 * records, so a client can merge `listEvents` history with live frames.
 *
 * Nothing on this path applies backpressure: the WebSocket adapter ignores
 * `bufferedAmount`, and capnweb serializes pushes per session, so a firehose
 * would queue unbounded in the engine's memory. The catalog leaves out chat,
 * the engine's one high-volume subject, so what remains fires at human pace,
 * which this fan-out can carry as-is.
 *
 * A second consumer of these subjects alongside AlertEmitter rather than a hook
 * into it: core NATS delivers to every subscriber, so the extra subscription is
 * free, and AlertEmitter's job is mapping to Convex alert webhooks — it
 * discards the CloudEvent envelope this needs.
 */
export class StreamEventBroadcaster {
  private subscribers = new Set<StreamEventSubscriber>();
  private subscriptions: SubjectSubscriptions;

  constructor(
    nats: NATSClient,
    private logger: SharedLogger,
    private catalog: EventCatalog
  ) {
    this.subscriptions = new SubjectSubscriptions(
      nats,
      (subject, msg) => {
        this.handle(subject, msg);
      },
      logger,
      "StreamEventBroadcaster"
    );
  }

  /** Pushes the catalog's subjects from now on, following it as it changes. */
  async start(): Promise<void> {
    this.catalog.onChange((events) => this.subscriptions.sync(events.keys()));
    await this.subscriptions.sync(this.catalog.events.keys());
    this.logger.info("StreamEventBroadcaster started", { subjects: this.catalog.events.size });
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

  private handle(subject: string, msg: Msg): void {
    if (this.subscribers.size === 0) {
      return;
    }

    let frame: StreamEventFrame;
    try {
      frame = toFrame(subject, msg.json() as Record<string, unknown>, this.catalog.events.get(subject)?.moduleId);
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
 * fallback for `type` because the EventType value is both. A module event
 * that names no platform gets its module's id, as the event log records it,
 * so a live frame and its logged copy read the same.
 */
function toFrame(subject: string, ce: Record<string, unknown>, moduleId: string | undefined): StreamEventFrame {
  return {
    id: typeof ce.id === "string" ? ce.id : undefined,
    type: typeof ce.type === "string" ? ce.type : subject,
    source: typeof ce.source === "string" ? ce.source : "engine",
    time: typeof ce.time === "string" ? ce.time : new Date().toISOString(),
    platform: typeof ce.platform === "string" ? ce.platform : moduleId || undefined,
    data: ce.data ?? ce,
  };
}
