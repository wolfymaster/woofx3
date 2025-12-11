# TypeScript Message Bus Client

A TypeScript message bus client that provides a unified interface for both NATS and HTTP/WebSocket messaging. Designed to be compatible with existing NATS usage patterns while allowing communication with the Go message bus server.

## Features

- **Dual Backends**: Switch between NATS and HTTP/WebSocket backends
- **NATS Compatible**: Drop-in replacement for existing `@nats-io/transport-node` usage
- **Wildcard Matching**: Full support for NATS-style subject wildcards (`*` and `>`)
- **Environment Detection**: Automatically selects backend based on available credentials
- **Reconnection**: Automatic reconnection for HTTP backend with configurable retry logic

## Quick Start

```typescript
import { fromEnv } from '@wolfymaster/messagebus';

// Automatically detect and configure from environment
const bus = await fromEnv();

// Subscribe to messages (same as existing NATS patterns)
const subscription = await bus.subscribe('workflow.>', (msg) => {
  console.log('Received:', msg.subject, msg.string());
  
  // Parse JSON if needed
  const data = msg.json();
  console.log('Parsed:', data);
});

// Publish a message
const data = new TextEncoder().encode(JSON.stringify({ 
  command: 'start', 
  args: { id: '123' } 
}));
await bus.publish('workflow.started', data);

// Clean up
await subscription.unsubscribe();
await bus.close();
```

## Backend Selection

The library automatically chooses the appropriate backend:

- **NATS Backend**: Used when `NATS_USER_JWT` and `NATS_NKEY_SEED` environment variables are present
- **HTTP Backend**: Used as fallback, connects to Go message bus via WebSocket

## Environment Variables

For NATS backend:
- `NATS_URL`: NATS server WebSocket URL (default: "wss://connect.ngs.global")
- `NATS_NAME`: Client name (default: "messagebus-client")
- `NATS_USER_JWT`: JWT token for authentication (required for NATS)
- `NATS_NKEY_SEED`: NKey seed for signing (required for NATS)

For HTTP backend:
- `MESSAGEBUS_HTTP_URL`: WebSocket URL (default: "ws://localhost:8080/ws")
- `MESSAGEBUS_RECONNECT_TIMEOUT`: Reconnection delay in ms (default: 5000)
- `MESSAGEBUS_MAX_RETRIES`: Maximum reconnection attempts (default: Infinity)

## Migration from Direct NATS Usage

The library is designed for easy migration from existing NATS code:

```typescript
// Before (direct NATS)
import NatsClient from './nats';
const client = await NatsClient();
const sub = client.subscribe('workflow.>', (msg) => {
  console.log(msg.subject, msg.string());
});

// After (message bus)
import { fromEnv } from '@wolfymaster/messagebus';
const bus = await fromEnv();
const sub = await bus.subscribe('workflow.>', (msg) => {
  console.log(msg.subject, msg.string());
});
```

## Compatibility Helper

For existing `natsMessageHandler` patterns:

```typescript
import { adaptNatsMessageHandler } from '@wolfymaster/messagebus';

// Existing handler
const handler = adaptNatsMessageHandler<any>((command, args) => {
  console.log('Command:', command, 'Args:', args);
});

await bus.subscribe('commands.>', handler);
```

## WebSocket Protocol

The HTTP backend communicates with the Go message bus using JSON messages:

**Outbound (to server):**
```json
{"type": "subscribe", "subject": "workflow.>"}
{"type": "unsubscribe", "subject": "workflow.>"}  
{"type": "publish", "subject": "workflow.started", "data": [72,101,108,108,111]}
```

**Inbound (from server):**
```json
{"type": "message", "subject": "workflow.started", "data": [72,101,108,108,111]}
```

Data is transmitted as number arrays (byte arrays) for compatibility with binary data.

## Wildcard Patterns

Supports NATS-style wildcard matching:

- `*`: Matches exactly one token (e.g., `workflow.*` matches `workflow.started`)
- `>`: Matches one or more tokens (e.g., `workflow.>` matches `workflow.started.now`)

## Error Handling

Both backends include comprehensive error handling:

- NATS: Connection failures, subscription errors, authentication issues
- HTTP: WebSocket disconnections, automatic reconnection, message parsing errors

## Development

```bash
npm install
npm run build
npm test
```