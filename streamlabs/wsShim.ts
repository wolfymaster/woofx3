// Shim for Bun WebSocket to add protocol property
if (typeof Bun !== 'undefined') {
    const ws = require('ws');
    const originalWebSocket = ws.WebSocket;

    // Monkey patch the WebSocket prototype
    Object.defineProperty(originalWebSocket.prototype, 'protocol', {
        get() {
            return 'obswebsocket.msgpack'; // obswebsocket.json if using json protocol
        },
        configurable: false
    });
}
