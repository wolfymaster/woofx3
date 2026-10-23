import { type Clock, errorMessage, type Logger } from "./deps";

/** One message as the bus hands it over. `respond` is a no-op returning false when there is no `reply` inbox. */
export interface BusMessage {
  readonly subject: string;
  readonly data: Uint8Array;
  readonly reply?: string;
  respond(data: Uint8Array): boolean;
}

export type BusHandler = (msg: BusMessage) => void | Promise<void>;

/** What the scope knows about a message besides its content. */
export interface Delivery {
  /** Clock time the scope took the message off the bus, before it waited for a free handler slot. */
  receivedAt: number;
}

/** A handler on a scoped subscription. Queue time counts against any deadline, so it gets the arrival time. */
export type ScopedHandler = (msg: BusMessage, delivery: Delivery) => void | Promise<void>;

export interface BusSubscription {
  unsubscribe(): void;
}

/**
 * The bus as the host needs it. @woofx3/nats satisfies it; tests pass a fake.
 * Kept local so the host does not depend on how the shared client evolves.
 */
export interface BusClient {
  publish(subject: string, data: Uint8Array): Promise<void>;
  subscribe(subject: string, handler: BusHandler): Promise<BusSubscription>;
  request(subject: string, data: Uint8Array, opts: { timeout: number }): Promise<{ subject: string; data: Uint8Array }>;
}

/** NATS subject patterns a scope may use, per operation. `*` matches one token and `>` the rest. */
export interface SubjectGrants {
  publishes: readonly string[];
  subscribes: readonly string[];
  requests: readonly string[];
}

export interface SubscriptionLimits {
  /** Handlers one subscription runs at once. */
  concurrency: number;
  /** Messages one subscription holds while every handler slot is busy; any more are dropped. */
  queueCap: number;
}

export type BusOperation = "publish" | "subscribe" | "request";

/** Thrown for any subject the scope's grants do not cover; names the scope and the subject. */
export class ScopedBusRefusal extends Error {
  constructor(
    readonly scope: string,
    readonly operation: BusOperation,
    readonly subject: string
  ) {
    super(`${scope} may not ${operation} on "${subject}": it is not declared in its manifest`);
    this.name = "ScopedBusRefusal";
  }
}

export interface SubscriptionCounters {
  received: number;
  handled: number;
  handlerErrors: number;
  dropped: number;
}

/**
 * What one scope did, kept by its owner so the counts survive the scope: an
 * adapter gets a fresh ScopedBus for every start but one set of counters.
 */
export class ScopeCounters {
  refusals = 0;
  readonly subscriptions = new Map<string, SubscriptionCounters>();

  forSubject(subject: string): SubscriptionCounters {
    let counters = this.subscriptions.get(subject);
    if (counters === undefined) {
      counters = { received: 0, handled: 0, handlerErrors: 0, dropped: 0 };
      this.subscriptions.set(subject, counters);
    }
    return counters;
  }

  snapshot(): { refusals: number; subscriptions: Record<string, SubscriptionCounters> } {
    const subscriptions: Record<string, SubscriptionCounters> = {};
    for (const [subject, counters] of this.subscriptions) {
      subscriptions[subject] = { ...counters };
    }
    return { refusals: this.refusals, subscriptions };
  }
}

export interface ScopedBusOptions {
  /** Who is using the bus: an adapter id, or "host". Appears in every refusal and log line. */
  scope: string;
  client: BusClient;
  grants: SubjectGrants;
  limits: SubscriptionLimits;
  logger: Logger;
  counters: ScopeCounters;
  /** Stamps each message's arrival. */
  clock: Clock;
  /** Called after a handler throws, once the error is logged and counted. */
  onHandlerError?: (subject: string, error: unknown) => void;
}

/** Whether a concrete or wildcard `subject` falls inside `pattern`. */
export function subjectCovered(pattern: string, subject: string): boolean {
  const patternTokens = pattern.split(".");
  const subjectTokens = subject.split(".");
  for (let index = 0; index < patternTokens.length; index++) {
    const token = patternTokens[index];
    if (token === ">") {
      return subjectTokens.length > index;
    }
    const candidate = subjectTokens[index];
    if (candidate === undefined) {
      return false;
    }
    if (token === "*") {
      if (candidate === ">") {
        return false;
      }
      continue;
    }
    if (token !== candidate) {
      return false;
    }
  }
  return patternTokens.length === subjectTokens.length;
}

class LimitedSubscription {
  private running = 0;
  private dropping = false;
  private closed = false;
  private readonly queue: Array<{ msg: BusMessage; delivery: Delivery }> = [];
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly subject: string,
    private readonly handler: ScopedHandler,
    private readonly options: ScopedBusOptions,
    private readonly counters: SubscriptionCounters
  ) {}

  accept(msg: BusMessage): void {
    if (this.closed) {
      return;
    }
    this.counters.received++;
    const delivery: Delivery = { receivedAt: this.options.clock.now() };
    if (this.running < this.options.limits.concurrency) {
      this.run(msg, delivery);
      return;
    }
    if (this.queue.length < this.options.limits.queueCap) {
      this.queue.push({ msg, delivery });
      return;
    }
    this.counters.dropped++;
    // One warning per overload, not one per dropped message.
    if (!this.dropping) {
      this.dropping = true;
      this.options.logger.warn("subscription is full, dropping messages", {
        scope: this.options.scope,
        subject: this.subject,
        concurrency: this.options.limits.concurrency,
        queueCap: this.options.limits.queueCap,
      });
    }
  }

  /** Stops taking messages, forgets the queued ones and waits for the running handlers. */
  async drain(): Promise<void> {
    this.closed = true;
    this.queue.length = 0;
    await Promise.allSettled([...this.inFlight]);
  }

  private run(msg: BusMessage, delivery: Delivery): void {
    this.running++;
    const done = Promise.resolve()
      .then(() => this.handler(msg, delivery))
      .then(
        () => {
          this.counters.handled++;
        },
        (error: unknown) => {
          this.counters.handlerErrors++;
          this.options.logger.error("subscription handler failed", {
            scope: this.options.scope,
            subject: this.subject,
            messageSubject: msg.subject,
            error: errorMessage(error),
          });
          this.options.onHandlerError?.(this.subject, error);
        }
      )
      .finally(() => {
        this.running--;
        this.inFlight.delete(done);
        this.next();
      });
    this.inFlight.add(done);
  }

  private next(): void {
    if (this.closed) {
      return;
    }
    const queued = this.queue.shift();
    if (queued === undefined) {
      this.dropping = false;
      return;
    }
    this.run(queued.msg, queued.delivery);
  }
}

/**
 * The bus as one scope sees it: only the subjects its manifest declares, each
 * subscription with its own concurrency and queue caps, handler errors caught
 * and counted instead of reaching the process. The caps are per subscription
 * so one slow subject (a request held while an adapter starts) cannot starve
 * another (the settings event that would start it).
 */
export class ScopedBus {
  private closed = false;
  private readonly subscriptions: Array<{ subscription: BusSubscription; limited: LimitedSubscription }> = [];

  constructor(private readonly options: ScopedBusOptions) {
    const { concurrency, queueCap } = options.limits;
    if (!(Number.isInteger(concurrency) && concurrency > 0) || !(Number.isInteger(queueCap) && queueCap >= 0)) {
      throw new Error(`${options.scope}: subscription limits need concurrency > 0 and queueCap >= 0`);
    }
  }

  get scope(): string {
    return this.options.scope;
  }

  async publish(subject: string, data: Uint8Array): Promise<void> {
    this.allow("publish", subject, this.options.grants.publishes);
    await this.options.client.publish(subject, data);
  }

  async request(
    subject: string,
    data: Uint8Array,
    opts: { timeout: number }
  ): Promise<{ subject: string; data: Uint8Array }> {
    this.allow("request", subject, this.options.grants.requests);
    return this.options.client.request(subject, data, opts);
  }

  async subscribe(subject: string, handler: ScopedHandler): Promise<void> {
    this.allow("subscribe", subject, this.options.grants.subscribes);
    const limited = new LimitedSubscription(subject, handler, this.options, this.options.counters.forSubject(subject));
    const subscription = await this.options.client.subscribe(subject, (msg) => limited.accept(msg));
    if (this.closed) {
      // closeAll ran while the subscribe was in flight; it must not outlive the scope.
      subscription.unsubscribe();
      return;
    }
    this.subscriptions.push({ subscription, limited });
  }

  /**
   * Unsubscribes everything, drops queued messages and waits for running
   * handlers. Every subscription is closed even when one fails; the failures
   * are then thrown together. The scope refuses all use afterwards.
   */
  async closeAll(): Promise<void> {
    this.closed = true;
    await this.unsubscribeAll();
  }

  /**
   * Like closeAll, but the scope stays open: the handlers still running can
   * publish and request until they finish, and nothing new is delivered.
   */
  async drainSubscriptions(): Promise<void> {
    await this.unsubscribeAll();
  }

  private async unsubscribeAll(): Promise<void> {
    const failures: unknown[] = [];
    const draining: Promise<void>[] = [];
    for (const { subscription, limited } of this.subscriptions.splice(0)) {
      try {
        subscription.unsubscribe();
      } catch (error) {
        failures.push(error);
      }
      draining.push(limited.drain());
    }
    await Promise.all(draining);
    if (failures.length > 0) {
      throw new AggregateError(failures, `${this.options.scope}: ${failures.length} subscription(s) failed to close`);
    }
  }

  private allow(operation: BusOperation, subject: string, granted: readonly string[]): void {
    if (this.closed) {
      throw new Error(`${this.options.scope}: the bus scope is closed`);
    }
    if (!granted.some((pattern) => subjectCovered(pattern, subject))) {
      this.options.counters.refusals++;
      throw new ScopedBusRefusal(this.options.scope, operation, subject);
    }
  }
}
