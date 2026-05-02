import type { Msg as NatsCoreMsg } from "@nats-io/nats-core";
import type { Msg } from './types';

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

  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else if (Array.isArray(data)) {
    // Handle number[] from HTTP backend JSON serialization
    bytes = new Uint8Array(data);
  } else {
    throw new Error('Unsupported data format');
  }

  return new MessageImpl(subject, bytes);
}
