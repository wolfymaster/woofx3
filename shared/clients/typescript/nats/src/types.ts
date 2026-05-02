export interface NATSConfig {
  url: string;
  name: string;
  jwt?: string;
  nkeySeed?: string;
}

/**
 * Handler function for processing messages
 */
export type Handler = (msg: Msg) => void;

/**
 * Logger interface for custom logging implementations
 */
export interface Logger {
  info(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

/**
 * Message interface compatible with NATS messages.
 *
 * `reply` is the inbox subject set by `nats.request()`. Handlers can
 * either publish to it directly or — preferably — call `respond()`,
 * which is a no-op when the message wasn't a request (no `reply` set).
 */
export interface Msg {
  subject: string;
  data: Uint8Array;
  reply?: string;
  json<T = any>(): T;
  string(): string;
  respond(data: Uint8Array): boolean;
}
