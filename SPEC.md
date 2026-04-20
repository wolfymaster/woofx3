# WoofX3 Specification

**Version:** 1.0  
**Status:** Draft  
**Last Updated:** 2026-04-10

---

## 1. Overview

WoofX3 is a unified streaming control plane designed for content creators who require sophisticated real-time automation, viewer engagement, and extensibility. The system orchestrates multiple microservices that collectively provide Twitch chat integration, event-driven workflow automation, viewer permission management, a Rete-based rules engine, and an extensible module/plugin architecture.

### 1.1 Design Philosophy

The platform embodies several core principles:

- **Isolation over coupling**: Services communicate through well-defined event contracts and RPC interfaces, never sharing databases or memory.
- **Local-first operation**: The system must run entirely locally without external SaaS dependencies. Third-party integrations (Twitch, OBS, Spotify) are optional plugins.
- **Fail gracefully**: Services continue operating when external dependencies are unavailable, degrading functionality rather than failing entirely.
- **Extensibility by design**: Users can upload modules containing custom logic, workflows, and assets that execute in isolated sandboxes.

### 1.2 Target Use Cases

- **Stream automation**: Trigger actions based on chat events, follows, subscriptions, and channel point redemptions.
- **Viewer engagement**: Manage viewer permissions, rewards, and interactive features.
- **Custom workflows**: Define complex automation sequences with branching, waiting, and sub-workflow support.
- **Plugin extensibility**: Extend platform functionality through sandboxed Lua or JavaScript modules.
- **Multi-streamer management**: Support multiple streamers from a single deployment with isolated data.

---

## 2. System Architecture

### 2.1 Architectural Overview

The system follows a microservices architecture with three primary communication patterns:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WoofX3 Platform                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    NATS/CloudEvents    ┌──────────────────────────────┐  │
│  │  WoofWoofWoof │ ──────────────────────│  Wooflow (Workflow Engine)    │  │
│  │  (Chatbot)    │                         │                               │  │
│  └──────┬───────┘                         └───────────────┬──────────────┘  │
│         │                                                 │                  │
│         │ WebSocket                              gRPC/Twirp               │
│         ▼                                                 ▼                  │
│  ┌──────────────┐                         ┌──────────────────────────────┐  │
│  │ Barkloader   │                         │         DB Proxy            │  │
│  │ (Plugins)    │                         │   (Postgres/BadgerDB)        │  │
│  └──────────────┘                         └──────────────────────────────┘  │
│                                                   ▲                         │
│         NATS/CloudEvents                         │                         │
│         ▼                                         │                         │
│  ┌──────────────┐    NATS/CloudEvents     ┌────────┴───────────┐            │
│  │  Twitch      │────────────────────────│   Shared Services  │            │
│  │  Service     │                         │   (Message Bus)    │            │
│  └──────────────┘                         └────────────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Service Topology

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| **db** | Go | 26257 (gRPC) | Database proxy for all data access |
| **wooflow** | Go | 26533 (gRPC) | Workflow orchestration engine |
| **barkloader** | Rust | 9653 (HTTP/WS) | Module/plugin management and sandbox execution |
| **twitch** | TypeScript/Bun | 26633 (HTTP) | Twitch API integration and EventBus |
| **woofwoofwoof** | TypeScript/Bun | 26666 (HTTP) | Twitch chatbot and command processing |
| **api** | TypeScript/Bun | 3000 (HTTP) | Public API for UI clients |
| **messagebus-gateway** | Go | 8080 (WS) | WebSocket-to-NATS bridge |

### 2.3 Data Isolation Boundaries

Each streamer operates within an isolated data context identified by an `engineId`. Data never crosses engine boundaries without explicit user action.

---

## 3. Core Services

### 3.1 Database Proxy (db)

**Purpose**: Provide a single, secured access point for all data storage. No service except db communicates directly with any database.

**Databases Managed**:

| Database | Technology | Purpose |
|----------|------------|---------|
| System DB | PostgreSQL or SQLite | Persistent system data, user records, workflow definitions, permissions |
| Module KV | BadgerDB | Key-value storage accessible to user-uploaded modules |

**Interface**: Twirp RPC (protocol buffers over HTTP/gRPC)

**Key Operations**:

- CRUD for all entities (users, workflows, commands, permissions, treats, modules)
- Permission enforcement via Casbin RBAC model
- Module KV read/write operations with namespace isolation
- Event subscription for data change notifications

**Schema Domains**:

- **Users**: Viewer accounts with roles, permissions, metadata
- **Workflows**: Definitions and execution state
- **Commands**: Chat command configurations
- **Treats**: Reward/currency system
- **Permissions**: Role-based access control rules
- **Events**: Historical event log with user associations
- **Modules**: Uploaded module metadata and configurations

### 3.2 Workflow Engine (Wooflow)

**Purpose**: Execute event-driven automation workflows with support for branching, waiting, aggregation, and sub-workflows.

**Inspiration**: Cadence/Temporal programming model

**Interface**: gRPC/Twirp for management, NATS/CloudEvents for execution

**Workflow Definition Structure**:

```yaml
id: workflow-uuid
name: On Follow Greeting
trigger:
  type: follow.user.twitch
steps:
  - id: check-tier
    type: condition
    expression: ${trigger.data.tier} >= 2
    onTrue: [premium-greeting]
    onFalse: [basic-greeting]
  - id: premium-greeting
    type: action
    action: send-chat-message
    args:
      message: "Welcome premium follower ${trigger.data.displayName}!"
  - id: basic-greeting
    type: action
    action: send-chat-message
    args:
      message: "Thanks for following, ${trigger.data.displayName}!"
```

**Supported Task Types**:

| Type | Behavior |
|------|----------|
| `action` | Execute a registered action (function call, event publish, HTTP request) |
| `condition` | Evaluate expression, branch to `onTrue` or `onFalse` steps |
| `wait` | Pause execution until specified event arrives or timeout |
| `aggregate` | Collect events until threshold, then continue |
| `workflow` | Execute a named sub-workflow, await completion |
| `log` | Emit debug log entry |

**Expression Language**:

Templates use `${...}` syntax for variable substitution:

- `${trigger.data.field}` — Access trigger event fields
- `${taskId.result}` — Access previous task output
- `${env.VARIABLE}` — Environment configuration
- `${user.meta.key}` — User metadata lookup

**Execution Model**:

- Max concurrent workflows: configurable (default: 100)
- Step timeout: configurable per workflow (default: 30s)
- Retry policy: configurable per step (default: no retries)
- Backend: Local in-process or Temporal (external)

**Hot Reload**: Workflows subscribe to NATS events for live updates without restart:

- `workflow.change.add`
- `workflow.change.update`
- `workflow.change.delete`

### 3.3 Module System (Barkloader)

**Purpose**: Allow users to extend platform functionality through sandboxed code execution.

**Architecture**:

```
Module Upload → Validation → Storage → Sandbox Execution ← WebSocket API
```

**Module Package Format**:

Modules are ZIP archives containing:

| Directory/File | Contents |
|----------------|----------|
| `module.json` | Module manifest |
| `functions/*.lua` | Lua 5.4 executable code |
| `functions/*.js` | QuickJS JavaScript code |
| `widgets/` | Browser source HTML/CSS/JS |
| `overlays/` | Overlay assets |

**Manifest Schema**:

```json
{
  "id": "unique-module-id",
  "name": "Display Name",
  "version": "1.0.0",
  "triggers": [
    { "type": "event", "source": "twitch.follow" }
  ],
  "actions": [
    { "id": "custom-action", "function": "custom/greet" }
  ],
  "functions": [
    { "name": "greet", "runtime": "lua", "file": "functions/greet.lua" }
  ],
  "commands": [
    { "name": "!hello", "function": "custom/hello" }
  ]
}
```

**Supported Runtimes**:

| Runtime | File Extension | Sandbox Level |
|---------|----------------|---------------|
| Lua 5.4 | `.lua` | No stdlib (no io, os, require) |
| QuickJS | `.js` | No filesystem/network access |

**Execution Interface**: WebSocket at `ws://host:9653/ws`

```json
{
  "type": "invoke",
  "data": {
    "function": "module-id/function-name",
    "args": { "key": "value" }
  }
}
```

**Storage Backends**:

- Local filesystem (development)
- S3-compatible object storage (production)

### 3.4 Rete Rules Engine (Treats)

**Purpose**: Evaluate declarative rules against streaming facts to trigger actions. Implements the Rete algorithm for efficient many-rules, many-facts pattern matching.

**Conceptual Model**:

```
Events → Fact Updates → Rete Network → Rule Evaluation → Actions/Fire
```

**Fact Types**:

| Type | Description |
|------|-------------|
| Direct | Single value facts (e.g., current subscription tier) |
| Aggregated | Computed over event windows (e.g., 5-minute cheer total) |
| Derived | Computed from other facts (e.g., VIP status from sub tenure) |

**Fact Storage Tiers**:

| Tier | Technology | Purpose |
|------|------------|---------|
| Hot | In-memory | Active fact evaluation |
| Warm | Compressed memory | Recent historical facts |
| Cold | Database | Long-term fact archival |

**Rule Definition Schema**:

```json
{
  "id": "rule-uuid",
  "name": "Grant VIP after 1000 bits",
  "conditions": [
    { "fact": "total_bits_lifetime", "operator": ">=", "value": 1000 }
  ],
  "actions": [
    { "type": "grant_role", "role": "vip", "duration": "30d" }
  ]
}
```

**Evaluation Model**:

- Per-user Rete network instances for segmented evaluation
- Fact versioning with invalidation cascades
- Dependency graph tracks fact-to-rule relationships
- Only invalidated rules re-evaluate on fact updates

### 3.5 Twitch Integration

#### 3.5.1 Twitch Service

**Purpose**: Integrate with Twitch API and distribute channel events.

**Responsibilities**:

- Twitch API authentication and token management
- Event subscription management (follows, subs, cheers, raids)
- EventBus event generation and distribution via NATS
- Channel state tracking (online/offline, game, title)

**Event Types Published**:

| Subject | Trigger |
|---------|---------|
| `message.user.twitch` | Chat message received |
| `cheer.user.twitch` | Bits cheered |
| `follow.user.twitch` | New follow |
| `subscribe.user.twitch` | Subscription event |
| `raid.user.twitch` | Raid incoming |
| `channel.state.twitch` | Stream state change |

#### 3.5.2 WoofWoofWoof (Chatbot)

**Purpose**: Process Twitch chat messages, execute commands, and interact with the module system.

**Responsibilities**:

- Chat message parsing and command matching
- Permission checking before command execution
- Module function invocation via WebSocket
- Response formatting and rate limiting

**Command Types**:

| Type | Behavior |
|------|----------|
| Static | Return predefined response |
| Function | Invoke barkloader module function |
| Event | Publish event to NATS for downstream processing |
| Workflow | Trigger named workflow execution |

### 3.6 Message Bus Gateway

**Purpose**: Bridge WebSocket clients to NATS message bus.

**Interface**: WebSocket at `ws://host:8080/ws`

**Protocol**:

```json
{ "type": "subscribe", "subject": "workflow.>" }
{ "type": "publish", "subject": "workflow.started", "data": {...} }
{ "type": "unsubscribe", "subject": "workflow.>" }
```

**Fallback Behavior**: When NATS is unavailable, falls back to in-memory pub/sub for local development.

---

## 4. Data Models

### 4.1 Core Entities

#### User

```typescript
interface User {
  id: string;
  engineId: string;
  twitchId: string;
  displayName: string;
  roles: Role[];
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

#### WorkflowDefinition

```typescript
interface WorkflowDefinition {
  id: string;
  engineId: string;
  name: string;
  trigger: TriggerConfig;
  steps: StepConfig[];
  enabled: boolean;
  concurrency: number;
  timeoutSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}
```

#### Command

```typescript
interface Command {
  id: string;
  engineId: string;
  name: string;
  responseType: 'static' | 'function' | 'event' | 'workflow';
  response: string | CommandConfig;
  cooldownSeconds: number;
  requiredRole: Role;
  enabled: boolean;
}
```

#### Permission

```typescript
interface Permission {
  id: string;
  engineId: string;
  subject: string;      // User or role
  object: string;       // Resource path
  action: string;       // read, write, execute
  effect: 'allow' | 'deny';
}
```

#### Treat (Reward Currency)

```typescript
interface Treat {
  id: string;
  engineId: string;
  userId: string;
  amount: number;
  reason: string;
  createdAt: Date;
}
```

### 4.2 Event Schemas (CloudEvents)

All NATS events follow CloudEvents 1.0 specification with these common fields:

```typescript
interface CloudEvent {
  specversion: '1.0';
  id: string;
  source: string;        // Service origin (e.g., 'twitch', 'slobs')
  type: string;          // Event type (e.g., 'message.user.twitch')
  subject?: string;      // Resource identifier
  time: string;          // ISO 8601 timestamp
  datacontenttype: string;
  data: unknown;         // Event-specific payload
}
```

---

## 5. Communication Protocols

### 5.1 Service-to-Service (Internal)

**Protocol**: Twirp RPC over HTTP/2 (or HTTP/1.1 fallback)

**Generated Clients**: All services use generated clients from shared protobuf definitions.

**Error Handling**: Twirp error responses with codes (internal, not_found, invalid_argument, etc.)

### 5.2 Event Distribution

**Protocol**: NATS with CloudEvents envelope

**Subject Hierarchy**:

```
{major}.{minor}.{source}
twitch.message.user
slobs.scene.changed
workflow.started
module.invoked
```

**Wildcards**: NATS `>` and `*` wildcards supported for subscription patterns.

### 5.3 External Client Communication

**Protocol**: HTTP/REST with JSON payloads

**Authentication**: Token-based (implementation-specific)

**Rate Limiting**: Per-endpoint limits published in response headers

### 5.4 WebSocket Protocols

**Barkloader**: Module function invocation (binary or JSON)

**Message Bus Gateway**: Subscribe/Publish/Unsubscribe messages

---

## 6. Security Model

### 6.1 Module Sandbox

User-uploaded code executes in restricted sandboxes:

**Lua 5.4 Restrictions**:
- Standard library removed (no `io`, `os`, `require`)
- No filesystem access
- No network access
- No external process spawning

**QuickJS Restrictions**:
- No `fetch` or network APIs
- No filesystem APIs
- No `eval` or `Function` constructor
- Limited globals

### 6.2 Permission Enforcement

**Layer 1**: Database-level permission checks via Casbin
- Enforced in db proxy before any data operation
- Role-based with custom matching functions

**Layer 2**: Command-level permission checks
- Chatbot verifies user role before command execution
- Requires explicit role configuration per command

**Layer 3**: Workflow action permissions
- Workflow steps may require specific permissions
- Enforced at workflow execution time

### 6.3 Data Isolation

- Each engine instance has isolated data namespace
- Module KV uses prefixed namespaces per module
- User data never shared across engines

---

## 7. Extensibility Points

### 7.1 Module System

Users can extend functionality by uploading modules with:

- Custom functions callable from workflows or commands
- Widgets viewable as browser sources in streaming software
- Overlays rendered as browser-based stream elements
- Trigger definitions for custom event sources

### 7.2 Workflow Actions

New actions can be registered at runtime:

```typescript
registry.register('send-email', async (ctx, args) => {
  // Custom action implementation
});
```

### 7.3 Event Sources

Services can publish arbitrary CloudEvents to NATS:

```typescript
bus.publish('custom.event.source', {
  specversion: '1.0',
  type: 'custom.event.source',
  source: 'my-service',
  data: { /* payload */ }
});
```

### 7.4 Workflow Backend Pluggability

The workflow engine supports pluggable backends:

- Local in-process (default, zero dependencies)
- Temporal (external service, enterprise features)

---

## 8. Quality Attributes

### 8.1 Reliability

- **Graceful degradation**: Services continue when external dependencies fail
- **Event persistence**: NATS JetStream optional for durable event log
- **Workflow recovery**: Failed workflows can resume from checkpoint
- **Circuit breakers**: External API calls protected with failure thresholds

### 8.2 Scalability

- **Horizontal service scaling**: Any stateless service can scale out
- **Database sharding**: Engine-based sharding for multi-tenant isolation
- **Message bus fan-out**: NATS handles high-throughput event distribution
- **Workflow concurrency**: Configurable parallel execution limits

### 8.3 Observability

- **Structured logging**: All services emit JSON logs with correlation IDs
- **Health endpoints**: `/health` and `/ready` endpoints on all services
- **Event tracing**: CloudEvents include trace context propagation

### 8.4 Performance Targets

| Metric | Target |
|--------|--------|
| Chat message latency | < 50ms from receive to action |
| Workflow trigger latency | < 100ms from event to first step |
| Module function execution | < 200ms for simple functions |
| API response time (p95) | < 100ms |
| Message throughput | 10,000+ events/second |

### 8.5 Compatibility

- **Platforms**: Windows 10+, Linux (Ubuntu 20.04+, Debian 11+)
- **No external SaaS required**: All core functionality works offline
- **Optional cloud services**: Twitch, OBS, Spotify as available integrations

---

## 9. Deployment Model

### 9.1 Development

Single-machine deployment using `process-compose`:

- All services run as local processes
- Local NATS server (or connect to ngs.global)
- SQLite for system database
- Filesystem storage for modules

### 9.2 Production

Containerized deployment:

- Docker images for all services
- PostgreSQL for system database
- Managed NATS or self-hosted JetStream
- S3-compatible storage for modules
- Reverse proxy (Caddy) for TLS termination

### 9.3 Configuration

All configuration via environment variables. Key variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `ENGINE_ID` | Unique engine instance ID | Required |
| `DATABASE_URL` | System database connection | `sqlite://db.sqlite` |
| `BADGER_PATH` | Module KV storage path | `./badger` |
| `NATS_URL` | NATS server URL | `nats://localhost:4222` |
| `TWITCH_CLIENT_ID` | Twitch OAuth client ID | - |
| `TWITCH_CLIENT_SECRET` | Twitch OAuth secret | - |

---

## 10. Future Considerations

The following capabilities are identified for future development:

- **Multi-engine federation**: Services discovering and coordinating across multiple engine instances
- **Workflow versioning**: Support for workflow deployment with rollback
- **Metrics and dashboards**: Prometheus exporters and Grafana visualizations
- **Plugin marketplace**: Distribution system for community modules
- **Audit logging**: Comprehensive audit trail for compliance requirements
- **Workflow replay**: Temporal compatibility for historical event replay
- **Distributed modules**: Module execution across multiple barkloader instances

---

## 11. Glossary

| Term | Definition |
|------|------------|
| **Engine** | Single deployment unit serving one or more streamers |
| **EngineId** | Unique identifier for an engine instance |
| **Treat** | Reward currency earned/spent by viewers |
| **Rete** | Pattern matching algorithm for rules engines |
| **CloudEvents** | Vendor-neutral specification for event data |
| **Twirp** | RPC framework using protocol buffers |
| **Barkloader** | The module/plugin system |
| **Wooflow** | The workflow orchestration engine |
| **WoofWoofWoof** | The Twitch chatbot service |

---

## 12. References

- [CloudEvents Specification](https://github.com/cloudevents/spec)
- [Twirp Documentation](https://twirp.dev/)
- [NATS Documentation](https://docs.nats.io/)
- [Rete Algorithm](https://en.wikipedia.org/wiki/Rete_algorithm)
- [Temporal Workflow Engine](https://temporal.io/)
- [Lua 5.4 Reference Manual](https://www.lua.org/manual/5.4/)
- [QuickJS Documentation](https://bellard.org/quickjs/)

---

*This specification describes the intended design and architecture of the WoofX3 platform. Implementation details may vary from this document as the system evolves.*
