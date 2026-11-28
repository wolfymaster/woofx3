import type { Msg as NatsCoreMsg } from "@nats-io/nats-core";
import { type Context, propagation, ROOT_CONTEXT } from "@opentelemetry/api";
import type { Msg } from "./types";

/**
 * Implementation of the Msg interface. Wraps the underlying nats-core
 * message when one is available so handlers can call `respond()` for
 * NATS request/reply. Synthetic messages (constructed via createMessage,
 * used in tests) lack an underlying msg — `respond()` is a no-op there.
 */
export class MessageImpl implements Msg {
  public reply?: string;

  constructor(
    public subject: string,
    public data: Uint8Array,
    private natsCoreMsg?: NatsCoreMsg
  ) {
    this.reply = natsCoreMsg?.reply;
  }

  json<T = any>(): T {
    return JSON.parse(this.string());
  }

  string(): string {
    return new TextDecoder().decode(this.data);
  }

  respond(data: Uint8Array): boolean {
    if (!this.natsCoreMsg) {
      return false;
    }
    return this.natsCoreMsg.respond(data);
  }
}

/**
 * Create a message from various data formats
 */
export function createMessage(subject: string, data: string | Uint8Array | number[]): Msg {
  let bytes: Uint8Array;

  if (typeof data === "string") {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else if (Array.isArray(data)) {
    // Handle number[] from HTTP backend JSON serialization
    bytes = new Uint8Array(data);
  } else {
    throw new Error("Unsupported data format");
  }

  return new MessageImpl(subject, bytes);
}

const TRACEPARENT_MARKER = '"traceparent"';

/**
 * The trace context a CloudEvent carries in its `traceparent` / `tracestate`
 * extension attributes. Anything that is not a JSON object with a valid
 * traceparent (plain payloads, malformed values) yields the empty root
 * context, so a consumer starts a new trace instead of failing.
 */
export function extractTraceContext(data: Uint8Array): Context {
  const text = new TextDecoder().decode(data);
  // Skips the JSON parse for the many payloads that carry no trace context.
  if (!text.includes(TRACEPARENT_MARKER)) {
    return ROOT_CONTEXT;
  }
  try {
    const event: unknown = JSON.parse(text);
    if (typeof event !== "object" || event === null) {
      return ROOT_CONTEXT;
    }
    const { traceparent, tracestate } = event as Record<string, unknown>;
    if (typeof traceparent !== "string") {
      return ROOT_CONTEXT;
    }
    const carrier: Record<string, string> = { traceparent };
    if (typeof tracestate === "string") {
      carrier.tracestate = tracestate;
    }
    return propagation.extract(ROOT_CONTEXT, carrier);
  } catch {
    // Not JSON: a non-CloudEvent payload has no trace context to continue.
    return ROOT_CONTEXT;
  }
}
