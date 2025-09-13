"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NATSBackend = void 0;
const transport_node_1 = require("@nats-io/transport-node");
const msg_1 = require("./msg");
/**
 * NATS backend implementation
 */
class NATSBackend {
    constructor(config, logger) {
        this.config = config;
        this.connection = null;
        this.logger = logger || console;
    }
    async connect() {
        if (this.connection) {
            return;
        }
        try {
            const options = {
                name: this.config.name || 'messagebus-client',
                servers: this.config.url || 'wss://connect.ngs.global'
            };
            // Add JWT authentication if provided
            if (this.config.jwt && this.config.nkeySeed) {
                const authenticator = (0, transport_node_1.jwtAuthenticator)(this.config.jwt, Buffer.from(this.config.nkeySeed));
                options.authenticator = authenticator;
            }
            this.connection = await (0, transport_node_1.wsconnect)(options);
            this.logger.log('Connected to NATS', { url: options.servers, name: options.name });
        }
        catch (error) {
            this.logger.error('Failed to connect to NATS:', error);
            throw error;
        }
    }
    async publish(subject, data) {
        if (!this.connection) {
            await this.connect();
        }
        if (!this.connection) {
            throw new Error('NATS connection not available');
        }
        this.connection.publish(subject, data);
        this.logger.debug?.('Published message', { subject, size: data.length });
    }
    async subscribe(subject, handler, opts) {
        if (!this.connection) {
            await this.connect();
        }
        if (!this.connection) {
            throw new Error('NATS connection not available');
        }
        // Create subscription using correct NATS API
        const subscription = this.connection.subscribe(subject);
        this.logger.debug?.('Subscribed to subject', { subject });
        // Start consuming messages asynchronously
        (async () => {
            try {
                for await (const msg of subscription) {
                    const wrappedMsg = new msg_1.MessageImpl(msg.subject, msg.data);
                    handler(wrappedMsg);
                }
            }
            catch (error) {
                this.logger.error?.('Subscription error:', error);
            }
        })();
        return new NATSSubscription(subscription, this.logger);
    }
    async close() {
        if (this.connection) {
            await this.connection.close();
            this.connection = null;
            this.logger.log('NATS connection closed');
        }
    }
    asNATS() {
        return this.connection;
    }
}
exports.NATSBackend = NATSBackend;
/**
 * NATS subscription wrapper
 */
class NATSSubscription {
    constructor(natsSubscription, logger) {
        this.natsSubscription = natsSubscription;
        this.logger = logger;
    }
    async unsubscribe() {
        if (this.natsSubscription) {
            this.natsSubscription.unsubscribe();
            this.logger.debug?.('Unsubscribed from subject');
        }
    }
    async drain() {
        if (this.natsSubscription && this.natsSubscription.drain) {
            await this.natsSubscription.drain();
            this.logger.debug?.('Drained subscription');
        }
        else {
            // Fallback to unsubscribe if drain not available
            await this.unsubscribe();
        }
    }
}
