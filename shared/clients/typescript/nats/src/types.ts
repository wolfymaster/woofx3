export interface NATSConfig {
  url: string;
  name: string;
  jwt?: string;
  nkeySeed?: string;
  /** Sent when the message bus requires a token (WOOFX3_MESSAGEBUS_TOKEN); blank sends none. */
  token?: string;
  /** How long to wait between reconnect attempts; DEFAULT_RECONNECT_POLICY when unset. */
  reconnect?: ReconnectPolicy;
}

/** How a client reaches the bus at first and after it drops. */
export interface ReconnectPolicy {
  /** Pause before retrying a server that was just tried. */
  reconnectTimeWaitMs: number;
  /** Most added at random to the pause, so clients do not reconnect in lockstep. */
  reconnectJitterMs: number;
  /**
   * Tries for the first dial, reconnectTimeWaitMs apart, before connect()
   * rejects. Only the first dial is bounded; an established connection
   * reconnects forever.
   */
  firstConnectAttempts: number;
}

/**
 * Handles one message. A thrown error or a rejected promise is logged with
 * the subject and does not end the subscription.
 */
export type Handler = (msg: Msg) => void | Promise<void>;

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
