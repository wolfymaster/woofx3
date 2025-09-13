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
 * Create a message from string data
 */
export function createMessage(subject: string, data: string | Uint8Array): Msg {
  const bytes = typeof data === 'string' 
    ? new TextEncoder().encode(data)
    : data;
  
  return new MessageImpl(subject, bytes);
}