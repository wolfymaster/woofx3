import { MessageBus, Subscription, Handler, SubscribeOptions, HTTPConfig } from './types';
/**
 * HTTP/WebSocket backend implementation that connects to Go message bus
 */
export declare class HTTPBackend implements MessageBus {
    private config;
    private ws;
    private subscriptions;
    private subscriptionCounter;
    private reconnectTimer;
    private shouldReconnect;
    private currentRetryCount;
    private isConnecting;
    private logger;
    constructor(config: HTTPConfig, logger?: Console);
    private connect;
    private setupWebSocketHandlers;
    private handleMessage;
    private matchWildcardSubscriptions;
    private matchesWildcard;
    private reestablishSubscriptions;
    private sendSubscribeMessage;
    private scheduleReconnect;
    publish(subject: string, data: Uint8Array): Promise<void>;
    subscribe(subject: string, handler: Handler, opts?: SubscribeOptions): Promise<Subscription>;
    unsubscribeHandler(subject: string, handler: Handler): Promise<void>;
    close(): Promise<void>;
    asNATS(): any;
}
