import type { StreamEventFrame, StreamEventSubscriber } from "@woofx3/api";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { type EventCatalog, SubjectSubscriptions } from "./event-catalog";
import { holdStub, onStubBroken, releaseStub } from "./held-stub";

/**
 * What a subscriber that names no types receives: the events clients relied
 * on before a subscriber could choose. Pushed whether or not a trigger offers
 * them, as they always were.
 */
export const LEGACY_STREAM_EVENT_TYPES: readonly string[] = [
  EventType.Follow,
  EventType.Cheer,
  EventType.Subscribe,
  EventType.SubscriptionGift,
  EventType.Raid,
  EventType.StreamOnline,
  EventType.StreamOffline,
  EventType.AdBreakUpcoming,
  EventType.AdBreakBegin,
  EventType.AdBreakEnd,
];

/** capnweb stubs carry this; the contract types the argument as a plain object. */
interface Registration {
  subscriber: StreamEventSubscriber;
  /** The engine client the session belongs to; null for an in-process caller. */
  clientId: string | null;
  /** The types asked for, or null for `LEGACY_STREAM_EVENT_TYPES`. */
  requested: ReadonlySet<string> | null;
}

/**
 * Fans stream events out to browser clients over their existing capnweb
 * session. Each subscriber names the event types it wants, any the
 * `EventCatalog` offers; the bus subscriptions are the union of what every
 * subscriber wants, so a type nobody watches costs nothing.
 *
 * Nothing on this path applies backpressure: the WebSocket adapter ignores
 * `bufferedAmount`, and capnweb serializes pushes per session, so a firehose
 * would queue unbounded in the engine's memory. The catalog never offers chat,
 * the engine's one high-volume subject, so what a subscriber can ask for fires
 * at human pace, which this fan-out can carry as-is.
 *
 * A second consumer of these subjects alongside AlertEmitter rather than a hook
 * into it: core NATS delivers to every subscriber, so the extra subscription is
 * free, and AlertEmitter's job is mapping to Convex alert webhooks — it
 * discards the CloudEvent envelope this needs.
 */
export class StreamEventBroadcaster {
  /** Keyed by the session that registered, so a session holds one registration. */
  private registrations = new Map<object, Registration>();
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

  /** Follows the catalog, so a type a subscriber asked for is pushed once a module offers it. */
  async start(): Promise<void> {
    this.catalog.onChange(() => this.resync());
    await this.resync();
    this.logger.info("StreamEventBroadcaster started", { subjects: this.subscriptions.subjects.length });
  }

  /**
   * Register a client callback for the life of its session, pushing `types`
   * (those the catalog offers; others are ignored) or, without `types`, the
   * `LEGACY_STREAM_EVENT_TYPES`. A second call with the same `session`
   * replaces the first: a client re-registers when what it wants changes, and
   * the callback it passes is a new stub each time.
   *
   * Eviction is driven by `onRpcBroken`, the signal capnweb raises when the
   * peer goes away.
   */
  async subscribe(
    subscriber: StreamEventSubscriber,
    types: readonly string[] | undefined,
    session: object,
    clientId: string | null
  ): Promise<void> {
    const held = holdStub(subscriber);
    const registration: Registration = {
      subscriber: held,
      clientId,
      requested: types === undefined ? null : new Set(types),
    };
    const replaced = this.registrations.get(session);
    this.registrations.set(session, registration);
    if (replaced) {
      releaseStub(replaced.subscriber);
    }
    onStubBroken(held, () => {
      // A replaced registration's stub may break after its replacement exists.
      if (this.registrations.get(session) !== registration) {
        return;
      }
      this.registrations.delete(session);
      releaseStub(held);
      this.logger.debug("StreamEventBroadcaster: subscriber disconnected", {
        remaining: this.registrations.size,
      });
      void this.resync();
    });
    await this.resync();
  }

  /** End `session`'s registration, as when the session is disposed. A session with none is a no-op. */
  unsubscribe(session: object): void {
    this.drop((candidate) => candidate === session);
  }

  /**
   * End every registration of `clientId`, whichever session made it and
   * whether or not that session is still tracked, as when the client is
   * deleted.
   */
  dropClient(clientId: string): void {
    this.drop((_, registration) => registration.clientId === clientId);
  }

  private drop(matches: (session: object, registration: Registration) => boolean): void {
    let dropped = 0;
    for (const [session, registration] of this.registrations) {
      if (matches(session, registration)) {
        this.registrations.delete(session);
        releaseStub(registration.subscriber);
        dropped++;
      }
    }
    if (dropped === 0) {
      return;
    }
    this.resync().catch((err) => {
      this.logger.error("StreamEventBroadcaster: resync after dropping subscribers failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /** Exposed for tests and diagnostics. */
  get subscriberCount(): number {
    return this.registrations.size;
  }

  /** The subjects bound on the bus. Exposed for tests and diagnostics. */
  get subjects(): string[] {
    return this.subscriptions.subjects;
  }

  private pushed(registration: Registration): Iterable<string> {
    if (registration.requested === null) {
      return LEGACY_STREAM_EVENT_TYPES;
    }
    return [...registration.requested].filter((type) => this.catalog.events.has(type));
  }

  private wants(registration: Registration, subject: string): boolean {
    if (registration.requested === null) {
      return LEGACY_STREAM_EVENT_TYPES.includes(subject);
    }
    return registration.requested.has(subject) && this.catalog.events.has(subject);
  }

  private resync(): Promise<void> {
    const wanted = new Set<string>();
    for (const registration of this.registrations.values()) {
      for (const subject of this.pushed(registration)) {
        wanted.add(subject);
      }
    }
    return this.subscriptions.sync(wanted);
  }

  private handle(subject: string, msg: Msg): void {
    const recipients = [...this.registrations.values()].filter((registration) => this.wants(registration, subject));
    if (recipients.length === 0) {
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
    for (const { subscriber } of recipients) {
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
