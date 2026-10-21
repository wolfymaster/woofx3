import type {
  CallbackEnvelope,
  EngineEventFrame,
  EngineEventMessage,
  EngineEventSubscriber,
  EngineRequestAnswer,
  RequestEnvelope,
} from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";

export interface EngineEventStreamLimits {
  /**
   * Frames held for one subscriber while it is still handling earlier ones.
   * Past this the oldest is dropped, so a slow subscriber costs bounded
   * memory and never holds up the publisher or anyone else.
   */
  bufferLimit: number;
}

export const DEFAULT_ENGINE_EVENT_STREAM_LIMITS: EngineEventStreamLimits = { bufferLimit: 256 };

/** capnweb stubs carry these; the contract types the callback as a plain object. */
type MaybeStub = Partial<{
  dup(): EngineEventSubscriber;
  onRpcBroken(callback: (error: unknown) => void): void;
  [Symbol.dispose](): void;
}>;

interface Subscription {
  clientId: string;
  subscriber: EngineEventSubscriber;
  /** The event types asked for, or null for every event. Requests ignore it. */
  types: ReadonlySet<string> | null;
  queue: EngineEventFrame[];
  /** The last `seq` handed out, delivered or not. */
  seq: number;
  pumping: boolean;
  /** Set once, when the subscription is dropped; nothing is pushed after. */
  closed: boolean;
  /** Whether a drop has been logged since the queue last drained. */
  overflowLogged: boolean;
}

interface PendingRequest {
  clientId: string;
  subscription: Subscription;
  type: string;
  resolve(body: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Pushes engine events and requests to clients over their capnweb sessions.
 * The transport only: `WebhookClient` builds each envelope and decides which
 * clients get it, here and over HTTP alike, so the two cannot drift.
 *
 * Each subscription has its own queue and at most one push in flight, so
 * frames arrive in order and a slow subscriber holds up only itself. Its queue
 * is bounded: past `bufferLimit` the oldest frame is dropped, and `seq` tells
 * the subscriber it missed something. A push that rejects drops the
 * subscription, as does the session breaking (`onRpcBroken`).
 */
export class EngineEventStream {
  /** Keyed by the session that subscribed, so a session holds one subscription. */
  private subscriptions = new Map<object, Subscription>();
  private pending = new Map<string, PendingRequest>();

  constructor(
    private readonly logger: SharedLogger,
    private readonly limits: EngineEventStreamLimits = DEFAULT_ENGINE_EVENT_STREAM_LIMITS
  ) {
    if (!Number.isInteger(limits.bufferLimit) || limits.bufferLimit < 1) {
      throw new Error(`EngineEventStream: bufferLimit must be a positive integer, got ${limits.bufferLimit}`);
    }
  }

  /**
   * Subscribe `clientId` for the life of `session`. A second call with the
   * same session replaces the first, and its requests in flight fail.
   */
  subscribe(
    subscriber: EngineEventSubscriber,
    types: readonly string[] | undefined,
    session: object,
    clientId: string
  ): void {
    const stub = subscriber as MaybeStub;
    // capnweb disposes a stub passed as a parameter when the call that
    // received it returns, so one kept for later pushes must be duplicated.
    const held = typeof stub.dup === "function" ? stub.dup() : subscriber;
    const subscription: Subscription = {
      clientId,
      subscriber: held,
      types: types === undefined ? null : new Set(types),
      queue: [],
      seq: 0,
      pumping: false,
      closed: false,
      overflowLogged: false,
    };
    const replaced = this.subscriptions.get(session);
    if (replaced) {
      this.close(replaced, "replaced by a new subscription on the same session");
    }
    // Deleted first so insertion order is subscription order: a request goes
    // to the client's newest subscription.
    this.subscriptions.delete(session);
    this.subscriptions.set(session, subscription);
    (held as MaybeStub).onRpcBroken?.(() => {
      this.drop(session, subscription, "session closed");
    });
    this.logger.info("EngineEventStream: subscribed", { clientId, types: types ?? "all" });
  }

  /** Engine client ids with a live subscription, in subscription order, each once. */
  clientIds(): string[] {
    return [...new Set([...this.subscriptions.values()].map((s) => s.clientId))];
  }

  hasSubscriber(clientId: string): boolean {
    return this.newestFor(clientId) !== null;
  }

  /** Exposed for tests and diagnostics. */
  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Queue `envelope` for every subscription that wants it: those of
   * `targetClientId` alone when one is given. Returns how many it was queued
   * for; never waits on a subscriber.
   */
  publish(envelope: CallbackEnvelope, targetClientId?: string): number {
    let queued = 0;
    for (const subscription of this.subscriptions.values()) {
      if (targetClientId !== undefined && subscription.clientId !== targetClientId) {
        continue;
      }
      if (subscription.types !== null && !subscription.types.has(envelope.type)) {
        continue;
      }
      this.enqueue(subscription, { kind: "event", envelope });
      queued += 1;
    }
    return queued;
  }

  /**
   * Push `envelope` to the newest subscription of `clientId` and resolve with
   * the body it answers with through `answer`. Rejects when the client has no
   * subscription, refuses, or does not answer within `timeoutMs`, and as soon
   * as its subscription drops or the frame is dropped unanswered.
   */
  request(envelope: RequestEnvelope, clientId: string, timeoutMs: number): Promise<unknown> {
    const subscription = this.newestFor(clientId);
    if (!subscription) {
      return Promise.reject(new Error(`no engine event stream subscription for client id ${clientId}`));
    }
    if (this.pending.has(envelope.id)) {
      return Promise.reject(new Error(`${envelope.type}: request id ${envelope.id} is already waiting`));
    }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(envelope.id, new Error(`${envelope.type}: no answer on the event stream within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(envelope.id, { clientId, subscription, type: envelope.type, resolve, reject, timer });
      this.enqueue(subscription, { kind: "request", envelope });
    });
  }

  /**
   * Settle the request `requestId` with `answer`. Throws when no such request
   * is waiting for `clientId`, so one client cannot answer for another.
   */
  answer(clientId: string, requestId: string, answer: EngineRequestAnswer): void {
    const request = this.pending.get(requestId);
    if (!request || request.clientId !== clientId) {
      throw new Error(`no engine request ${requestId} is waiting for this client`);
    }
    if (answer.ok) {
      this.settle(requestId, null, answer.body);
      return;
    }
    this.settle(requestId, new Error(`${request.type}: the client refused: ${answer.error}`));
  }

  private newestFor(clientId: string): Subscription | null {
    let newest: Subscription | null = null;
    for (const subscription of this.subscriptions.values()) {
      if (subscription.clientId === clientId) {
        newest = subscription;
      }
    }
    return newest;
  }

  private enqueue(subscription: Subscription, message: EngineEventMessage): void {
    subscription.seq += 1;
    if (subscription.queue.length >= this.limits.bufferLimit) {
      const dropped = subscription.queue.shift() as EngineEventFrame;
      if (dropped.kind === "request") {
        this.settle(dropped.envelope.id, new Error(`${dropped.envelope.type}: dropped unsent, the client fell behind`));
      }
      if (!subscription.overflowLogged) {
        subscription.overflowLogged = true;
        this.logger.warn("EngineEventStream: subscriber fell behind, dropping its oldest frames", {
          clientId: subscription.clientId,
          bufferLimit: this.limits.bufferLimit,
        });
      }
    }
    subscription.queue.push({ ...message, seq: subscription.seq });
    if (!subscription.pumping) {
      void this.pump(subscription);
    }
  }

  private async pump(subscription: Subscription): Promise<void> {
    subscription.pumping = true;
    try {
      for (let frame = subscription.queue.shift(); frame; frame = subscription.queue.shift()) {
        if (subscription.closed) {
          return;
        }
        try {
          await subscription.subscriber.onEngineEvent(frame);
        } catch (err) {
          this.dropSubscription(subscription, `push failed: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      subscription.overflowLogged = false;
    } finally {
      subscription.pumping = false;
    }
  }

  private dropSubscription(subscription: Subscription, reason: string): void {
    for (const [session, candidate] of this.subscriptions) {
      if (candidate === subscription) {
        this.drop(session, subscription, reason);
        return;
      }
    }
    this.close(subscription, reason);
  }

  /** Remove `subscription` if `session` still holds it, and close it either way. */
  private drop(session: object, subscription: Subscription, reason: string): void {
    if (this.subscriptions.get(session) === subscription) {
      this.subscriptions.delete(session);
    }
    if (subscription.closed) {
      return;
    }
    this.close(subscription, reason);
    this.logger.warn("EngineEventStream: subscription dropped", {
      clientId: subscription.clientId,
      reason,
      remaining: this.subscriptions.size,
    });
  }

  private close(subscription: Subscription, reason: string): void {
    if (subscription.closed) {
      return;
    }
    subscription.closed = true;
    subscription.queue = [];
    for (const [id, request] of this.pending) {
      if (request.subscription === subscription) {
        this.settle(id, new Error(`${request.type}: the event stream subscription closed (${reason})`));
      }
    }
    (subscription.subscriber as MaybeStub)[Symbol.dispose]?.();
  }

  private settle(requestId: string, error: Error | null, body?: unknown): void {
    const request = this.pending.get(requestId);
    if (!request) {
      return;
    }
    this.pending.delete(requestId);
    clearTimeout(request.timer);
    if (error) {
      request.reject(error);
      return;
    }
    request.resolve(body);
  }
}
