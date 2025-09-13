# Message Bus Library

A Go message bus library that provides a unified interface for both NATS and in-memory pub/sub messaging. Designed to be compatible with existing NATS code while allowing fallback to in-memory messaging when NATS is not available.

## Features

- **Pluggable Backends**: Switch between NATS and in-memory backends
- **NATS Compatible**: Drop-in replacement for existing NATS usage patterns
- **Wildcard Matching**: Full support for NATS-style subject wildcards (`*` and `>`)
- **Environment Detection**: Automatically selects backend based on available credentials
- **Thread-Safe**: Safe for concurrent use across multiple goroutines

## Quick Start

```go
import "github.com/wolfymaster/woofx3/shared/clients/messagebus"

// Automatically detect and configure from environment
bus, err := messagebus.FromEnv(logger)
if err != nil {
    log.Fatal(err)
}
defer bus.Close()

// Subscribe to messages
sub, err := bus.Subscribe("workflow.>", func(msg *messagebus.Msg) {
    fmt.Printf("Received: %s on %s\n", msg.Data, msg.Subject)
})
if err != nil {
    log.Fatal(err)
}
defer sub.Unsubscribe()

// Publish a message
err = bus.Publish("workflow.started", []byte("Hello World"))
if err != nil {
    log.Fatal(err)
}
```

## Backend Selection

The library automatically chooses the appropriate backend:

- **NATS Backend**: Used when `NATS_USER_JWT` and `NATS_NKEY_SEED` environment variables are present
- **Memory Backend**: Used as fallback when NATS credentials are not available

## Environment Variables

For NATS backend configuration:

- `NATS_URL`: NATS server URL (default: "tls://connect.ngs.global")
- `NATS_NAME`: Client name (default: "messagebus-client")
- `NATS_USER_JWT`: JWT token for authentication (required for NATS)
- `NATS_NKEY_SEED`: NKey seed for signing (required for NATS)

## Wildcard Patterns

Supports NATS-style wildcard matching:

- `*`: Matches exactly one token (e.g., `workflow.*` matches `workflow.started`)
- `>`: Matches one or more tokens (e.g., `workflow.>` matches `workflow.started.now`)

## Migration from Direct NATS Usage

The library is designed for easy migration from existing NATS code:

```go
// Before (direct NATS)
nc, err := nats.Connect(url)
sub, err := nc.Subscribe("workflow.>", handler)

// After (message bus)
bus, err := messagebus.FromEnv(logger)
sub, err := bus.Subscribe("workflow.>", handler)
```

The handler function signature remains the same: `func(msg *nats.Msg)`