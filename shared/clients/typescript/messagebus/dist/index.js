"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMessageBus = createMessageBus;
exports.fromEnv = fromEnv;
const nats_backend_1 = require("./nats-backend");
const http_backend_1 = require("./http-backend");
__exportStar(require("./types"), exports);
__exportStar(require("./msg"), exports);
/**
 * Create a new message bus instance
 */
async function createMessageBus(config) {
    switch (config.backend) {
        case 'nats':
            const natsBackend = new nats_backend_1.NATSBackend(config.nats || {}, config.logger);
            await natsBackend.connect();
            return natsBackend;
        case 'http':
            const httpBackend = new http_backend_1.HTTPBackend(config.http || {}, config.logger);
            return httpBackend;
        default:
            throw new Error(`Unknown backend: ${config.backend}`);
    }
}
/**
 * Create a message bus from environment variables
 * Uses NATS if credentials are available, otherwise falls back to HTTP backend
 */
async function fromEnv(logger) {
    const config = {
        backend: 'http', // default
        logger: logger || console,
        nats: {
            url: process.env.NATS_URL || 'wss://connect.ngs.global',
            name: process.env.NATS_NAME || 'messagebus-client',
            jwt: process.env.NATS_USER_JWT,
            nkeySeed: process.env.NATS_NKEY_SEED,
        },
        http: {
            url: process.env.MESSAGEBUS_HTTP_URL || 'ws://localhost:8080/ws',
            reconnectTimeout: parseInt(process.env.MESSAGEBUS_RECONNECT_TIMEOUT || '5000'),
            maxRetries: process.env.MESSAGEBUS_MAX_RETRIES ?
                parseInt(process.env.MESSAGEBUS_MAX_RETRIES) : Infinity,
        }
    };
    // Use NATS if both JWT and NKey are provided
    if (config.nats?.jwt && config.nats?.nkeySeed) {
        config.backend = 'nats';
        if (logger) {
            logger.log('Using NATS backend from environment');
        }
    }
    else {
        config.backend = 'http';
        if (logger) {
            logger.log('Using HTTP backend (NATS credentials not found)');
        }
    }
    return createMessageBus(config);
}
