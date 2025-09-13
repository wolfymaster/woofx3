"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTTPBackend = void 0;
const msg_1 = require("./msg");
/**
 * HTTP/WebSocket backend implementation that connects to Go message bus
 */
class HTTPBackend {
    constructor(config, logger) {
        this.config = config;
        this.ws = null;
        this.subscriptions = new Map();
        this.subscriptionCounter = 0;
        this.reconnectTimer = null;
        this.shouldReconnect = true;
        this.currentRetryCount = 0;
        this.isConnecting = false;
        this.logger = logger || console;
    }
    async connect() {
        if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
            return;
        }
        this.isConnecting = true;
        const url = this.config.url || 'ws://localhost:8080/ws';
        try {
            this.ws = new WebSocket(url);
            this.setupWebSocketHandlers();
            // Wait for connection to open
            await new Promise((resolve, reject) => {
                if (!this.ws) {
                    reject(new Error('WebSocket creation failed'));
                    return;
                }
                const onOpen = () => {
                    this.isConnecting = false;
                    this.currentRetryCount = 0;
                    this.logger.log('Connected to HTTP message bus', { url });
                    resolve();
                };
                const onError = (error) => {
                    this.isConnecting = false;
                    reject(new Error('WebSocket connection failed'));
                };
                this.ws.addEventListener('open', onOpen, { once: true });
                this.ws.addEventListener('error', onError, { once: true });
            });
            // Re-establish subscriptions
            await this.reestablishSubscriptions();
        }
        catch (error) {
            this.isConnecting = false;
            this.logger.error('Failed to connect to HTTP message bus:', error);
            throw error;
        }
    }
    setupWebSocketHandlers() {
        if (!this.ws)
            return;
        this.ws.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            }
            catch (error) {
                this.logger.error('Failed to parse message:', error);
            }
        });
        this.ws.addEventListener('close', () => {
            this.logger.log('WebSocket connection closed');
            if (this.shouldReconnect) {
                this.scheduleReconnect();
            }
        });
        this.ws.addEventListener('error', (error) => {
            this.logger.error('WebSocket error:', error);
        });
    }
    handleMessage(message) {
        if (message.type === 'message' && message.subject && message.data !== undefined) {
            const handlers = this.subscriptions.get(message.subject) || new Set();
            // createMessage now handles string, Uint8Array, and number[] formats
            const msg = (0, msg_1.createMessage)(message.subject, message.data);
            handlers.forEach(handler => {
                try {
                    handler(msg);
                }
                catch (error) {
                    this.logger.error('Handler error:', error);
                }
            });
            // Handle wildcard subscriptions
            this.matchWildcardSubscriptions(message.subject, msg);
        }
    }
    matchWildcardSubscriptions(subject, msg) {
        const subjectTokens = subject.split('.');
        for (const [pattern, handlers] of this.subscriptions) {
            if (pattern !== subject && this.matchesWildcard(pattern, subject)) {
                handlers.forEach(handler => {
                    try {
                        handler(msg);
                    }
                    catch (error) {
                        this.logger.error('Wildcard handler error:', error);
                    }
                });
            }
        }
    }
    matchesWildcard(pattern, subject) {
        const patternTokens = pattern.split('.');
        const subjectTokens = subject.split('.');
        let pi = 0, si = 0;
        while (pi < patternTokens.length && si < subjectTokens.length) {
            switch (patternTokens[pi]) {
                case '*':
                    // '*' matches exactly one token
                    pi++;
                    si++;
                    break;
                case '>':
                    // '>' matches one or more remaining tokens (must be last in pattern)
                    if (pi === patternTokens.length - 1) {
                        return si < subjectTokens.length;
                    }
                    return false;
                default:
                    // Exact match required
                    if (patternTokens[pi] !== subjectTokens[si]) {
                        return false;
                    }
                    pi++;
                    si++;
            }
        }
        // Handle remaining pattern tokens
        if (pi < patternTokens.length) {
            return patternTokens.length - pi === 1 &&
                patternTokens[pi] === '>' &&
                si < subjectTokens.length;
        }
        return pi === patternTokens.length && si === subjectTokens.length;
    }
    async reestablishSubscriptions() {
        for (const subject of this.subscriptions.keys()) {
            await this.sendSubscribeMessage(subject);
        }
    }
    async sendSubscribeMessage(subject) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }
        const message = {
            type: 'subscribe',
            subject: subject
        };
        this.ws.send(JSON.stringify(message));
        this.logger.debug?.('Sent subscribe message', { subject });
    }
    scheduleReconnect() {
        if (!this.shouldReconnect || this.currentRetryCount >= (this.config.maxRetries || Infinity)) {
            this.logger.warn('Max reconnection attempts reached or reconnect disabled');
            return;
        }
        this.currentRetryCount++;
        const timeout = this.config.reconnectTimeout || 5000;
        this.reconnectTimer = setTimeout(() => {
            this.logger.log(`Attempting to reconnect (${this.currentRetryCount}/${this.config.maxRetries || '∞'})`);
            this.connect().catch(error => {
                this.logger.error('Reconnection attempt failed:', error);
            });
        }, timeout);
    }
    async publish(subject, data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.connect();
        }
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('HTTP message bus connection not available');
        }
        const message = {
            type: 'publish',
            subject: subject,
            data: Array.from(data) // Convert Uint8Array to regular array for JSON
        };
        this.ws.send(JSON.stringify(message));
        this.logger.debug?.('Published message', { subject, size: data.length });
    }
    async subscribe(subject, handler, opts) {
        if (!this.subscriptions.has(subject)) {
            this.subscriptions.set(subject, new Set());
            // Send subscribe message to server if connected
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                await this.sendSubscribeMessage(subject);
            }
            else {
                // Connect and then subscribe
                await this.connect();
                await this.sendSubscribeMessage(subject);
            }
        }
        const handlers = this.subscriptions.get(subject);
        handlers.add(handler);
        const subscriptionId = ++this.subscriptionCounter;
        this.logger.debug?.('Subscribed to subject', { subject, id: subscriptionId });
        return new HTTPSubscription(subscriptionId, subject, handler, this, this.logger);
    }
    async unsubscribeHandler(subject, handler) {
        const handlers = this.subscriptions.get(subject);
        if (!handlers)
            return;
        handlers.delete(handler);
        // If no more handlers for this subject, unsubscribe from server
        if (handlers.size === 0) {
            this.subscriptions.delete(subject);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'unsubscribe',
                    subject: subject
                };
                this.ws.send(JSON.stringify(message));
                this.logger.debug?.('Sent unsubscribe message', { subject });
            }
        }
    }
    async close() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close(1000, 'Client closing');
            this.ws = null;
        }
        this.subscriptions.clear();
        this.logger.log('HTTP message bus connection closed');
    }
    asNATS() {
        return null; // HTTP backend doesn't provide NATS connection
    }
}
exports.HTTPBackend = HTTPBackend;
/**
 * HTTP subscription wrapper
 */
class HTTPSubscription {
    constructor(id, subject, handler, backend, logger) {
        this.id = id;
        this.subject = subject;
        this.handler = handler;
        this.backend = backend;
        this.logger = logger;
    }
    async unsubscribe() {
        await this.backend.unsubscribeHandler(this.subject, this.handler);
        this.logger.debug?.('Unsubscribed from subject', { subject: this.subject, id: this.id });
    }
    async drain() {
        // For HTTP backend, drain is equivalent to unsubscribe
        await this.unsubscribe();
    }
}
