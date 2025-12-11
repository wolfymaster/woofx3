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
 * Message interface compatible with NATS messages
 */
export interface Msg {
  subject: string;
  data: Uint8Array;
  json<T = any>(): T;
  string(): string;
}
