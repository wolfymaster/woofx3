"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageImpl = void 0;
exports.createMessage = createMessage;
/**
 * Implementation of the Msg interface
 */
class MessageImpl {
    constructor(subject, data) {
        this.subject = subject;
        this.data = data;
    }
    json() {
        return JSON.parse(this.string());
    }
    string() {
        return new TextDecoder().decode(this.data);
    }
}
exports.MessageImpl = MessageImpl;
/**
 * Create a message from various data formats
 */
function createMessage(subject, data) {
    let bytes;
    if (typeof data === 'string') {
        bytes = new TextEncoder().encode(data);
    }
    else if (data instanceof Uint8Array) {
        bytes = data;
    }
    else if (Array.isArray(data)) {
        // Handle number[] from HTTP backend JSON serialization
        bytes = new Uint8Array(data);
    }
    else {
        throw new Error('Unsupported data format');
    }
    return new MessageImpl(subject, bytes);
}
