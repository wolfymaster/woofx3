import { type NatsConnection } from '@nats-io/transport-node';
import { MessageBus, Subscription, Handler, SubscribeOptions, NATSConfig } from './types';
/**
 * NATS backend implementation
 */
export declare class NATSBackend implements MessageBus {
    private config;
    private connection;
    private logger;
    constructor(config: NATSConfig, logger?: Console);
    connect(): Promise<void>;
    publish(subject: string, data: Uint8Array): Promise<void>;
    subscribe(subject: string, handler: Handler, opts?: SubscribeOptions): Promise<Subscription>;
    close(): Promise<void>;
    asNATS(): NatsConnection | null;
}
