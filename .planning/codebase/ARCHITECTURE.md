# Architecture

> Generated: 2026-01-14 (Refreshed)

## Overview

WoofX3 is an **event-driven microservices platform** for live streaming automation. It integrates Twitch, Spotify, OBS, and custom chat bots through a central NATS message bus.

## Architecture Pattern

**Event-Driven Microservices with XState State Machines**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           External Services                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐   │
│  │ Twitch  │  │ Spotify │  │   OBS   │  │ Govee   │  │ TTS Monster │   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └──────┬──────┘   │
└───────┼────────────┼────────────┼────────────┼───────────────┼──────────┘
        │            │            │            │               │
┌───────▼────────────▼────────────▼────────────▼───────────────▼──────────┐
│                        Application Services                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │    twitch    │  │ woofwoofwoof │  │  streamlabs  │  │   reward    │  │
│  │  (EventSub)  │  │  (Chat Bot)  │  │  (Frontend)  │  │   (Bits)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │
└─────────┼─────────────────┼─────────────────┼─────────────────┼─────────┘
          │                 │                 │                 │
┌─────────▼─────────────────▼─────────────────▼─────────────────▼─────────┐
│                         NATS Message Bus                                 │
│                    (Real-time Event Streaming)                          │
│         Topics: workflow.*, slobs, chat.message, HEARTBEAT              │
└─────────┬─────────────────┬─────────────────┬─────────────────┬─────────┘
          │                 │                 │                 │
┌─────────▼─────────────────▼─────────────────▼─────────────────▼─────────┐
│                      Infrastructure Services                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │   wooflow    │  │      db      │  │  messagebus  │  │  barkloader │  │
│  │  (Temporal)  │  │   (Proxy)    │  │  (Gateway)   │  │  (Plugins)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
          │                 │                 │
┌─────────▼─────────────────▼─────────────────▼───────────────────────────┐
│                          Data Stores                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │  PostgreSQL  │  │   BadgerDB   │  │  InstantDB   │                   │
│  │   (Primary)  │  │    (K-V)     │  │  (Real-time) │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Design Patterns

| Pattern | Location | Purpose |
|---------|----------|---------|
| **State Machine (XState 5)** | `shared/common/typescript/runtime/` | Application lifecycle management |
| **Service Registry** | `shared/common/typescript/runtime/application.ts` | Dependency injection |
| **Message Bus Abstraction** | `shared/clients/typescript/messagebus/` | Dual backend (NATS/HTTP) |
| **Factory Pattern** | Bootstrap files | Service instantiation |
| **Adapter Pattern** | `messagebus-gateway` | WebSocket to NATS bridge |
| **Observer/Pub-Sub** | Entire architecture | Event-driven communication |
| **CloudEvents Standard** | `shared/clients/typescript/cloudevents/` | Standardized event format |
| **Workflow Orchestration** | `wooflow/` | Temporal-based workflows |
| **Plugin System** | `barkloader/`, `barkloader-rust/` | Dynamic code execution |

## Core Architectural Concepts

### 1. Application Runtime Framework

All TypeScript services use a shared `ApplicationRuntime` built on XState:

```typescript
// shared/common/typescript/runtime/runtime.ts
export function createRuntime<TContext>(config: RuntimeConfig<TContext>) {
  return createMachine({
    id: "application_runtime",
    initial: "initializing",
    states: {
      initializing: { invoke: { src: "initializeServices" } },
      connecting_services: { invoke: { src: "connectServices" } },
      running: { invoke: { src: "applicationRunning" } },
      health_checking: { invoke: { src: "healthCheck" } },
      restarting: { invoke: { src: "restartApplication" } },
      shutdown: { type: "final" }
    }
  });
}
```

**State Flow:**
```
initializing -> connecting_services -> running <-> health_checking
                                          ↓
                                     restarting -> shutdown
```

**Features:**
- Exponential backoff retry (1s → 2s → 4s → 8s... caps at 60s)
- Health checks before service connection
- Graceful shutdown via SIGTERM/SIGINT

### 2. Service Interface Pattern

Services implement a common interface for lifecycle management:

```typescript
// shared/common/typescript/runtime/service.ts
export interface Service<T> {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly client: T;
  readonly connected: boolean;
  healthcheck: boolean;
  name: string;
  type: string;
}
```

### 3. Message Bus Abstraction

A factory pattern supports multiple backends (NATS or HTTP/WebSocket):

```typescript
// shared/clients/typescript/messagebus/src/index.ts
export async function createMessageBus(config: MessageBusConfig): Promise<MessageBus> {
  if (config.backend === "nats") {
    return new NatsBackend(config);
  }
  return new HttpBackend(config);
}
```

### 4. CloudEvents Standard

All events follow CloudEvents 1.0.0 specification:

```typescript
// shared/clients/typescript/cloudevents/EventFactory.ts
export function createEvent(type: string, data: unknown) {
  return {
    specversion: "1.0",
    type,
    source: "/woofx3",
    id: uuidv4(),
    time: new Date().toISOString(),
    data
  };
}
```

## Data Flow

### Chat Message -> Command Execution

```
1. Twitch Chat → Twitch Service (twitch/)
2. Twitch publishes CloudEvent to message bus topic: "chat.message"
3. WoofWoofWoof (chatbot) subscribes to "chat.message" events
4. Command processor matches message against registered commands
5a. Text Commands → Direct response
5b. Function Commands → Sends to Barkloader (WebSocket invoke)
6. Barkloader executes Lua script with helper functions
7. Result published back to message bus
8. Destinations: "slobs" (alerts), "twitchapi" (moderation), "workflow" (automation)
```

### OBS Control Flow

```
1. Viewer redeems channel point
2. twitch publishes to NATS: redemption
3. streamlabs receives, determines action
4. Sends OBS WebSocket command
5. Scene/source changes in OBS
```

## Service Communication

### Subject Naming Convention
```
domain.event      # e.g., chat.message, workflow.follow
service.command   # e.g., slobs, twitchapi
wildcard          # e.g., workflow.> (all workflow topics)
```

### NATS Topics

| Topic | Purpose | Publishers | Subscribers |
|-------|---------|------------|-------------|
| `workflow.*` | Workflow events | wooflow | All services |
| `slobs` | OBS commands | twitch, woofwoofwoof | streamlabs |
| `chat.message` | Chat events | woofwoofwoof | barkloader |
| `HEARTBEAT` | Health monitoring | All services | Monitoring |

### Message Bus Backends

1. **Primary**: NATS (wss://connect.ngs.global)
   - JWT + NKey authentication
   - Subject-based routing

2. **Secondary**: HTTP WebSocket (ws://localhost:8080/ws)
   - Local development fallback
   - WebSocket to NATS bridge via messagebus-gateway

## Key Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| **Twitch Service** | `twitch/src/` | Twitch API, event subscriptions |
| **Chat Bot** | `woofwoofwoof/src/` | Command processing, permissions |
| **Plugin System (Lua)** | `barkloader/` | Lua script execution |
| **Plugin System (Rust)** | `barkloader-rust/` | High-performance plugins |
| **Workflow Engine** | `wooflow/` | Temporal-based automation |
| **Rewards System** | `reward/src/` | Bits, subscriptions, sounds |
| **Frontend/Streaming UI** | `streamlabs/` | Remix + React interface |
| **Database Proxy** | `db/` | Protocol Buffer API gateway |
| **Message Bus Gateway** | `services/messagebus-gateway/` | WebSocket ↔ NATS bridge |
| **Shared Clients** | `shared/clients/typescript/` | Reusable client libraries |
| **Shared Runtime** | `shared/common/typescript/runtime/` | Application framework |

## Bootstrap Sequence

Service startup order (from `process-compose.yml`):

```
1. temporal-server  → Workflow dependency
2. db               → Database proxy
3. messagebus-gateway → WebSocket bridge
4. wooflow          → Workflow engine
5. barkloader       → Lua plugin system
6. twitch           → Twitch API integration
7. woofwoofwoof     → Chat bot (depends on twitch)
8. streamlabs       → Frontend (depends on woofwoofwoof)
```

### Unified Bootstrap Pattern (TypeScript)

```typescript
1. dotenv.config()       // Load environment
2. Bootstrap()           // Initialize clients and services
3. createApplication()   // Wrap in Application interface
4. createRuntime()       // Initialize state machine
5. runtime.start()       // Begin lifecycle management
6. Signal handlers       // SIGTERM/SIGINT → graceful shutdown
```

## Entry Points

| Service | Entry Point | Bootstrap |
|---------|-------------|-----------|
| Twitch | `twitch/src/api.ts` | `Bootstrap()` → `createRuntime()` |
| WoofWoofWoof | `woofwoofwoof/src/woofwoofwoof.ts` | Same pattern |
| Barkloader | `barkloader/index.ts` | Bun WebSocket server |
| Wooflow | `wooflow/main.go` | `NewApp()` → signal handler |
| Streamlabs | `streamlabs/server.ts` | Remix Express server |
| Database | `db/cmd/server/` | Go server with Protobuf |

## Security Model

### Authentication Layers

1. **Twitch OAuth 2.0** - User authentication
2. **NATS JWT/NKey** - Service-to-service auth
3. **InstantDB Admin Token** - Database access
4. **Casbin RBAC** - Permission enforcement (Go services)

### Service Isolation

- Each service runs as separate process
- NATS provides topic-level access control
- Sensitive config in environment variables
