import { MessageBus, MessageBusConfig } from './types';
export * from './types';
export * from './msg';
/**
 * Create a new message bus instance
 */
export declare function createMessageBus(config: MessageBusConfig): Promise<MessageBus>;
/**
 * Create a message bus from environment variables
 * Uses NATS if credentials are available, otherwise falls back to HTTP backend
 */
export declare function fromEnv(logger?: Console): Promise<MessageBus>;
