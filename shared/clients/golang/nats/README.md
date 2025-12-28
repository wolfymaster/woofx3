# NATS Go Client

A Go client wrapper for NATS that mirrors the TypeScript NATS client interface.

## Features

- Simple, consistent API matching the TypeScript client
- Support for JWT authentication
- Automatic reconnection handling
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

### CreateMessageBus(config Config, logger Logger) (*Client, error)

Creates and connects a new NATS client.

### Client Methods

- `Connect() error` - Connects to NATS server
- `Publish(subject string, data []byte) error` - Publishes a message
- `Subscribe(subject string, handler Handler) (*nats.Subscription, error)` - Subscribes to a subject
- `Close() error` - Closes the connection
- `AsNATS() *nats.Conn` - Returns the underlying NATS connection

### Configuration

```go
type Config struct {
    URL      string  // NATS server URL
    Name     string  // Client name
    JWT      string  // Optional JWT for authentication
    NKeySeed string  // Optional NKey seed for authentication
}
```

### Logger Interface

```go
type Logger interface {
    Info(message string, args ...interface{})
    Error(message string, args ...interface{})
    Warn(message string, args ...interface{})
    Debug(message string, args ...interface{})
}
```

If no logger is provided, a default logger using Go's standard log package will be used.
