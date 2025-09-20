/**
 * Message interface compatible with NATS messages
 */
export interface Msg {
  subject: string;
  data: Uint8Array;
  json<T = any>(): T;
  string(): string;
}

/**
 * Handler function for processing messages
 */
export type Handler = (msg: Msg) => void;

/**
 * Subscription interface for managing subscriptions
 */
export interface Subscription {
  /**
   * Unsubscribe from the subject
   */
  unsubscribe(): Promise<void>;
  
  /**
   * Drain the subscription gracefully
   */
  drain(): Promise<void>;
}

/**
 * Subscribe options for configuring subscriptions
 */
export interface SubscribeOptions {
  // Future options like queue groups can be added here
}

/**
 * Message bus interface
 */
export interface MessageBus {
  /**
   * Publish data to a subject
   */
  publish(subject: string, data: Uint8Array): Promise<void>;
  
  /**
   * Subscribe to a subject with a handler
   */
  subscribe(subject: string, handler: Handler, opts?: SubscribeOptions): Promise<Subscription>;
  
  /**
   * Close the message bus and all connections
   */
  close(): Promise<void>;
  
  /**
   * Get the underlying NATS connection if available
   */
  asNATS(): any | null;
}

/**
 * Backend type for message bus
 */
export type Backend = 'nats' | 'http';

/**
 * NATS configuration
 */
export interface NATSConfig {
  url?: string;
  name?: string;
  jwt?: string;
  nkeySeed?: string;
}

/**
 * HTTP backend configuration
 */
export interface HTTPConfig {
  url?: string;
  reconnectTimeout?: number;
  maxRetries?: number;
}

/**
 * Message bus configuration
 */
export interface MessageBusConfig {
  backend: Backend;
  nats?: NATSConfig;
  http?: HTTPConfig;
  logger?: Logger;
}

export interface Logger {
  info(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}