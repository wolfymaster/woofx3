import type { Clock, IdSource, Logger, Timers } from "./deps";
import { errorMessage } from "./deps";
import type { BusMessage, Delivery, ScopedBus } from "./scoped-bus";

/** The CloudEvent `source` of every reply the host wraps. */
export const HOST_REQUEST_SOURCE = "connectors";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parsed<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function parseFailed<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

/**
 * Why the host answered instead of the handler: the request did not parse,
 * the parser or handler threw, or it waited for a free handler slot until
 * its budget was gone.
 */
export type HostRequestErrorCode = "invalid" | "internal" | "expired";

export interface RequestContext {
  /** Clock time by which the reply should be on its way: arrival plus the subject's budget. */
  deadline: number;
  /** Aborts at the deadline. */
  signal: AbortSignal;
  /** Clock time the request came off the bus, before any wait for a free handler slot. */
  arrivedAt: number;
}

interface SpecBase<Req> {
  subject: string;
  /**
   * How long a reply may take, chosen below the callers' own request timeout so
   * they always get an answer rather than a timeout.
   */
  budgetMs: number;
  parse(raw: Uint8Array): ParseResult<Req>;
}

/** The reply bytes go out exactly as `handle` returns them. */
export interface RawRequestSpec<Req> extends SpecBase<Req> {
  replyMode: "raw";
  handle(req: Req, ctx: RequestContext): Promise<Uint8Array>;
  errorReply(code: HostRequestErrorCode, message: string): Uint8Array;
}

/** The reply is JSON, wrapped as the `data` of a CloudEvent of `replyType`. */
export interface CloudEventRequestSpec<Req, Rep> extends SpecBase<Req> {
  replyMode: "cloudevent";
  replyType: string;
  handle(req: Req, ctx: RequestContext): Promise<Rep>;
  errorReply(code: HostRequestErrorCode, message: string): Rep;
}

export type ServeRequestSpec<Req, Rep> = RawRequestSpec<Req> | CloudEventRequestSpec<Req, Rep>;

export interface HostRequestCounters {
  received: number;
  replied: number;
  invalid: number;
  internal: number;
  expired: number;
  no_inbox: number;
}

export interface HostRequestsDeps {
  clock: Clock;
  ids: IdSource;
  timers: Timers;
  logger: Logger;
}

const encoder = new TextEncoder();

/**
 * The host's one way to answer requests on the bus. Every served subject,
 * whether an adapter's or a gateway's, goes through `serveRequest`, so they all
 * share the same deadline, error and counting rules.
 */
export class HostRequests {
  private readonly counters = new Map<string, HostRequestCounters>();

  constructor(private readonly deps: HostRequestsDeps) {}

  /** Subscribes `scope` to `spec.subject` and answers each request on it until the scope closes. */
  async serveRequest<Req, Rep>(scope: Pick<ScopedBus, "subscribe">, spec: ServeRequestSpec<Req, Rep>): Promise<void> {
    if (!(Number.isInteger(spec.budgetMs) && spec.budgetMs > 0)) {
      throw new Error(`${spec.subject}: budgetMs must be a whole number of milliseconds above 0, got ${spec.budgetMs}`);
    }
    if (this.counters.has(spec.subject)) {
      throw new Error(`${spec.subject} is already served`);
    }
    const counters: HostRequestCounters = {
      received: 0,
      replied: 0,
      invalid: 0,
      internal: 0,
      expired: 0,
      no_inbox: 0,
    };
    this.counters.set(spec.subject, counters);
    await scope.subscribe(spec.subject, (msg, delivery) => this.answer(spec, counters, msg, delivery));
  }

  /** Per-subject counts, for /health. */
  snapshot(): Record<string, HostRequestCounters> {
    const out: Record<string, HostRequestCounters> = {};
    for (const [subject, counters] of this.counters) {
      out[subject] = { ...counters };
    }
    return out;
  }

  private async answer<Req, Rep>(
    spec: ServeRequestSpec<Req, Rep>,
    counters: HostRequestCounters,
    msg: BusMessage,
    delivery: Delivery
  ): Promise<void> {
    counters.received++;
    if (!msg.reply) {
      counters.no_inbox++;
      this.deps.logger.warn("request has no reply inbox; not handled", { subject: spec.subject });
      return;
    }

    // The budget runs from arrival: time spent queued behind busy handlers is time the caller is already waiting.
    const arrivedAt = delivery.receivedAt;
    const deadline = arrivedAt + spec.budgetMs;
    const remainingMs = deadline - this.deps.clock.now();
    if (remainingMs <= 0) {
      counters.expired++;
      this.deps.logger.warn("request waited past its budget for a free handler; answered without handling", {
        subject: spec.subject,
        budgetMs: spec.budgetMs,
      });
      this.reply(
        counters,
        msg,
        errorOf(spec, "expired", `waited past the ${spec.budgetMs}ms budget for a free handler`)
      );
      return;
    }

    let request: ParseResult<Req>;
    try {
      request = spec.parse(msg.data);
    } catch (error) {
      counters.internal++;
      this.deps.logger.error("request parser threw", { subject: spec.subject, error: errorMessage(error) });
      this.reply(counters, msg, errorOf(spec, "internal", errorMessage(error)));
      return;
    }
    if (!request.ok) {
      counters.invalid++;
      this.reply(counters, msg, errorOf(spec, "invalid", request.error));
      return;
    }

    const controller = new AbortController();
    const timer = this.deps.timers.setTimeout(() => {
      controller.abort(new Error(`${spec.subject}: the ${spec.budgetMs}ms budget ran out`));
    }, remainingMs);
    const ctx: RequestContext = { arrivedAt, deadline, signal: controller.signal };
    let outcome: Reply<Rep>;
    try {
      outcome = await handleWith(spec, request.value, ctx);
    } catch (error) {
      counters.internal++;
      this.deps.logger.error("request handler failed", { subject: spec.subject, error: errorMessage(error) });
      outcome = errorOf(spec, "internal", errorMessage(error));
    } finally {
      this.deps.timers.clearTimeout(timer);
    }
    this.reply(counters, msg, outcome);
  }

  private reply<Rep>(counters: HostRequestCounters, msg: BusMessage, outcome: Reply<Rep>): void {
    const bytes = outcome.mode === "raw" ? outcome.bytes : encoder.encode(JSON.stringify(this.wrap(outcome)));
    if (msg.respond(bytes)) {
      counters.replied++;
    }
  }

  private wrap<Rep>(outcome: CloudEventReply<Rep>) {
    return {
      id: this.deps.ids.next(),
      type: outcome.type,
      source: HOST_REQUEST_SOURCE,
      time: new Date(this.deps.clock.now()).toISOString(),
      data: outcome.value,
    };
  }
}

type CloudEventReply<Rep> = { mode: "cloudevent"; type: string; value: Rep };

type Reply<Rep> = { mode: "raw"; bytes: Uint8Array } | CloudEventReply<Rep>;

async function handleWith<Req, Rep>(
  spec: ServeRequestSpec<Req, Rep>,
  req: Req,
  ctx: RequestContext
): Promise<Reply<Rep>> {
  if (spec.replyMode === "raw") {
    return { mode: "raw", bytes: await spec.handle(req, ctx) };
  }
  return { mode: "cloudevent", type: spec.replyType, value: await spec.handle(req, ctx) };
}

function errorOf<Req, Rep>(spec: ServeRequestSpec<Req, Rep>, code: HostRequestErrorCode, message: string): Reply<Rep> {
  if (spec.replyMode === "raw") {
    return { mode: "raw", bytes: spec.errorReply(code, message) };
  }
  return { mode: "cloudevent", type: spec.replyType, value: spec.errorReply(code, message) };
}
