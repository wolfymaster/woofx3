# NATS Go Client

A Go client wrapper for NATS that mirrors the TypeScript NATS client interface.

## Features

- Simple, consistent API matching the TypeScript client
- Support for JWT authentication
- Unlimited reconnects with jitter; subscriptions survive a bus restart
- Connection events and slow consumers logged through slog
- Custom logger interface
- Message wrapping with JSON support

## Usage

```go
package main

import (
    "log"
    nats "github.com/wolfymaster/woofx3/clients/nats"
)

func main() {
    config := nats.Config{
        URL:  "nats://localhost:4222",
        Name: "my-service",
    }

    client, err := nats.CreateMessageBus(config, nil)
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Subscribe to messages
    sub, err := client.Subscribe("my.subject", func(msg nats.Msg) {
        log.Printf("Received on %s: %s", msg.Subject(), msg.String())
    })
    if err != nil {
        log.Fatal(err)
    }

    // Publish a message
    err = client.Publish("my.subject", []byte("Hello NATS!"))
    if err != nil {
        log.Fatal(err)
    }
}
```

## API

### CreateMessageBus(config Config, logger *slog.Logger) (*Client, error)

Creates and connects a new NATS client. When the bus is not reachable yet it
returns at once and keeps dialling in the background.

### Client Methods

- `Connect() error` - Connects to NATS server
- `Publish(subject string, data []byte) error` - Publishes a message
- `Subscribe(subject string, handler Handler) (*nats.Subscription, error)` - Subscribes to a subject
- `Close() error` - Closes the connection for good; later calls return `ErrConnectionClosed`
- `Healthy() bool` - False before the first dial and once the connection is closed; true while reconnecting
- `AsNATS() *nats.Conn` - Returns the underlying NATS connection

### Configuration

```go
type Config struct {
    URL      string  // NATS server URL
    Name     string  // Client name
    JWT      string  // Optional JWT for authentication
    NKeySeed string  // Optional NKey seed for authentication
    Token    string  // Optional token (WOOFX3_MESSAGEBUS_TOKEN); sent when not blank
}
```

### Reconnects

The client keeps one connection and reconnects it forever, `DefaultReconnectWait`
(1s) plus up to `DefaultReconnectJitter` (500ms) apart. Subscriptions survive a
bus restart. It never dials a replacement connection: a closed client stays
closed.

### Logging

Connection events (connect, disconnect, reconnect, close) and asynchronous
errors are logged through the `*slog.Logger` given to `NewClient` (`slog.Default()`
when nil). A slow consumer logs its subject, the error, its pending message and
byte counts and its dropped total.
