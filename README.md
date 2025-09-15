# Streamlabs Multi-Service Streaming Platform

A comprehensive streaming platform application with multiple interconnected microservices for content creators, featuring real-time chat integration, workflow automation, viewer engagement tools, and plugin systems.

## 🚀 Overview

This platform provides a complete ecosystem for streaming and content creation, including:

- **Real-time Chat Integration**: Twitch chatbot with smart commands and automation
- **Workflow Management**: Temporal-based workflow orchestration for streaming operations  
- **Viewer Engagement**: Permissions system, rewards, and interactive features
- **Plugin Architecture**: Extensible plugin systems in TypeScript/Lua and Rust
- **Multi-Frontend Support**: Primary streaming interface, Twitch extensions, and streamer management UI
- **Message Bus Abstraction**: Unified messaging system with NATS and WebSocket backends

## 🏗️ Architecture

### Frontend Services

| Service | Technology | Purpose | Port |
|---------|------------|---------|------|
| **streamlabs/** | Remix + React + Vite | Primary streaming interface | 5000 |
| **extension/client/** | React + Vite | Twitch extension frontend | TBD |
| **streamerui/** | Remix | Off-stream management interface | TBD |

### Backend Services

| Service | Technology | Purpose | Dependencies |
|---------|------------|---------|-------------|
| **auth/** | Go | Authentication via SuperTokens | - |
| **db/** | Go | Database proxy and API | - |
| **permissions/** | Go | Viewer permissions management | db |
| **twitch/** | Bun/TypeScript | Twitch API integration | db, barkloader-rust, wooflow |
| **reward/** | Bun/TypeScript | Viewer rewards system | TBD |
| **stream/** | Go | Voice control and transcription | TBD |
| **wooflow/** | Go | Workflow management (Temporal) | temporal-server |
| **woofwoofwoof/** | Bun/TypeScript | Twitch chatbot | db, twitch |

### Infrastructure Services

| Service | Technology | Purpose | Dependencies |
|---------|------------|---------|-------------|
| **messagebus-gateway** | Go | WebSocket-to-NATS bridge | shared/clients/messagebus |
| **temporal-server** | Temporal | Workflow orchestration engine | - |

### Plugin Systems

| System | Technology | Purpose | Dependencies |
|--------|------------|---------|-------------|
| **barkloader/** | Bun/TypeScript + Lua | Plugin module system | wooflow |
| **barkloader-rust/** | Rust | High-performance plugin system | wooflow |

### Shared Libraries

| Library | Technology | Purpose |
|---------|------------|---------|
| **shared/clients/messagebus/** | Go | Message bus abstraction (NATS/memory backends) |
| **shared/clients/typescript/messagebus/** | TypeScript | Message bus client (NATS/WebSocket backends) |

## 🚀 Getting Started

### Prerequisites

- **Node.js 20+** with Bun runtime
- **Go 1.22+**  
- **Rust** (stable channel)
- **Temporal CLI** for workflow management
- **PostgreSQL** (optional, uses built-in database)

### Quick Start

1. **Clone and Setup**
   ```bash
   git clone <repository>
   cd streamlabs-platform
   bun install  # Install dependencies
   ```

2. **Start All Services**
   ```bash
   # Using process-compose (recommended for development)
   process-compose up
   
   # Or start individual services
   cd streamlabs && bun run dev  # Primary frontend
   ```

3. **Access the Application**
   - **Main Interface**: http://localhost:5000
   - **Health Checks**: http://localhost:8080/health (messagebus-gateway)

### Development Workflow

The application uses `process-compose.yml` to orchestrate all services with proper dependency management:

```yaml
# Core services start first
temporal-server → wooflow → barkloader/barkloader-rust
db → permissions, twitch, woofwoofwoof
# Frontend depends on backend readiness  
woofwoofwoof → streamlabs
```

## ⚙️ Configuration

### Environment Variables

#### Core Configuration
- `FORCE_COLOR=1` - Enable colored console output

#### NATS/Message Bus
- `NATS_URL` - NATS server URL (default: wss://connect.ngs.global)
- `NATS_USER_JWT` - JWT token for NATS authentication  
- `NATS_NKEY_SEED` - NKey seed for NATS signing
- `MESSAGEBUS_HTTP_URL` - WebSocket URL for HTTP backend (default: ws://localhost:8080/ws)

#### External Integrations
- `INSTANTDB_ADMIN_TOKEN` - Database operations token
- `OBS_HOST`, `OBS_PORT`, `OBS_RPC_TOKEN` - OBS WebSocket integration
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` - Twitch API credentials (TBD)
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` - Spotify integration (TBD)

#### Service Ports
- `MESSAGEBUS_GATEWAY_ADDRESS` - Gateway bind address (default: 0.0.0.0:8080)

### Service Dependencies

The platform gracefully handles missing external services:
- **NATS unavailable**: Falls back to in-memory message bus
- **OBS not running**: Disables OBS integration features  
- **External APIs down**: Services continue with reduced functionality

## 🔧 Technology Stack

### Languages & Runtimes
- **TypeScript/JavaScript**: Bun runtime for backend services
- **Go**: High-performance backend services
- **Rust**: Plugin system and performance-critical components
- **Lua**: Scripting for plugin system

### Frontend Technologies  
- **React 18** - Component library
- **Remix** - Full-stack web framework
- **Vite** - Build tool and dev server
- **TailwindCSS** - Utility-first styling

### Backend Technologies
- **Temporal** - Workflow orchestration
- **NATS** - Message streaming
- **WebSockets** - Real-time communication  
- **PostgreSQL** - Primary database
- **SQLite** - Local/embedded storage

### External Integrations
- **Twitch API** - Stream data and chat
- **OBS WebSocket** - Streaming software control
- **SuperTokens** - Authentication framework
- **Spotify API** - Music integration (TBD)

## 📡 Message Bus System

The platform features a sophisticated dual-backend message bus abstraction:

### Go Client (`shared/clients/messagebus`)
```go
import "github.com/wolfymaster/streamlabs/shared/clients/messagebus"

// Automatically detects NATS or falls back to memory  
bus, err := messagebus.FromEnv(logger)
bus.Subscribe("workflow.>", handler)
bus.Publish("workflow.started", data)
```

### TypeScript Client (`shared/clients/typescript/messagebus`)
```typescript
import { fromEnv } from '@wolfymaster/messagebus';

// Compatible with existing NATS patterns
const bus = await fromEnv();
await bus.subscribe('workflow.>', (msg) => {
  console.log(msg.subject, msg.json());
});
```

### Message Bus Gateway
- **WebSocket Endpoint**: `ws://localhost:8080/ws`
- **Protocol**: JSON messages with subscribe/publish/unsubscribe types
- **Health Checks**: `/health` and `/ready` endpoints
- **Fallback Strategy**: NATS → In-memory for development

## 📦 Services Reference

### Core Services

#### Streamlabs Frontend
- **Path**: `streamlabs/`
- **Purpose**: Primary streaming interface with real-time features
- **Technology**: Remix + React + Vite
- **Port**: 5000 (configured for Replit proxy)

#### Twitch Integration (`twitch/`)
- **Purpose**: Twitch API integration and event processing
- **Features**: Chat monitoring, stream data, viewer analytics
- **Dependencies**: Database, plugin systems

#### Chatbot (`woofwoofwoof/`)  
- **Purpose**: Intelligent Twitch chat automation
- **Features**: Smart commands, viewer engagement, integrations
- **Technology**: Bun/TypeScript with plugin support

#### Workflow Engine (`wooflow/`)
- **Purpose**: Temporal-based workflow orchestration
- **Features**: Stream automation, scheduled tasks, complex workflows
- **Dependencies**: Temporal server

### TBD Sections

The following sections require additional information:

#### 🔐 Authentication & Security
- Authentication flows and user management
- API security and rate limiting  
- JWT token management and refresh strategies

#### 🚀 Deployment
- Production deployment configurations
- Container orchestration (Docker/Kubernetes)
- CI/CD pipeline setup
- Environment-specific configurations

#### 📊 Monitoring & Observability  
- Logging aggregation and analysis
- Metrics collection (Prometheus/Grafana)
- Distributed tracing setup
- Alerting and notification systems

#### 🧪 Testing
- Unit testing strategies for each service
- Integration testing for service communication
- End-to-end testing for user workflows
- Performance testing and benchmarks

#### 📈 Performance & Scaling
- Horizontal scaling strategies
- Database optimization and connection pooling
- CDN integration for static assets
- Caching strategies (Redis/in-memory)

#### 🔌 Plugin Development
- Plugin API documentation
- Development guidelines and best practices
- Plugin marketplace and distribution
- Security model for third-party plugins

#### 🎯 API Documentation
- REST API endpoints and schemas
- WebSocket message protocols
- Rate limiting and authentication
- Client SDK documentation

## 🤝 Development

### Running Individual Services

```bash
# Database proxy
cd db/cmd/server && go run .

# Message bus gateway  
cd services/messagebus-gateway && go run .

# Twitch chatbot
bun run woofwoofwoof/src/woofwoofwoof.ts

# Primary frontend
cd streamlabs && bun run dev
```

### Building for Production

```bash
# Build TypeScript message bus client
cd shared/clients/typescript/messagebus && npm run build

# Build frontend assets  
cd streamlabs && bun run build

# Build Go services
cd services/messagebus-gateway && go build .
```

## 📄 License

TBD

## 🙏 Contributing  

TBD