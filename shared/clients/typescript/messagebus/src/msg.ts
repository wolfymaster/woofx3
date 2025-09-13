import { Msg } from './types';

/**
 * Implementation of the Msg interface
 */
export class MessageImpl implements Msg {
  constructor(
    public subject: string,
    public data: Uint8Array
  ) {}

  json<T = any>(): T {
    return JSON.parse(this.string());
  }

  string(): string {
    return new TextDecoder().decode(this.data);
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