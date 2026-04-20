# Project Structure

> Generated: 2026-01-14 (Refreshed)

## Top-Level Layout

```
woofx3/                          # Root monorepo
├── .planning/                   # Planning documents
│   └── codebase/               # Codebase analysis (this folder)
│
├── barkloader/                  # Rust Module/Plugin System (Lua + QuickJS runtimes)
├── db/                          # Database Proxy (Go + Protobuf)
├── reward/                      # Reward/Bits Handling (Bun/TS)
├── services/                    # Infrastructure Services
│   ├── messagebus-gateway/      # WebSocket ↔ NATS Bridge (Go)
│   └── nats/                    # NATS Server Configuration
├── shared/                      # Shared Libraries
│   ├── clients/typescript/      # Client Libraries (TS)
│   └── common/typescript/       # Runtime, Types, Utils (TS)
├── streamlabs/                  # Primary Frontend (Remix + React)
├── twitch/                      # Twitch Integration Service (Bun/TS)
├── wooflow/                     # Workflow Engine (Go + Temporal)
├── woofwoofwoof/                # Chat Bot Service (Bun/TS)
│
├── build/                       # Build Scripts/Config
├── infra/                       # Infrastructure (Docker, GPU)
├── irl/                         # IRL Streaming Utilities
│
├── package.json                 # Root Workspace
├── process-compose.yml          # Service Orchestration
├── docker-compose.yaml          # Docker Compose Config
├── Dockerfile                   # Production Image
├── Caddyfile                    # Reverse Proxy Config
├── devbox.json                  # Nix Devbox Config
├── biome.json                   # Code Formatter Config
└── axogen.config.ts             # Environment Generator
```

## Service Directory Structure

### TypeScript Services Pattern

```
service/
├── src/
│   ├── api.ts                 # Entry point (main)
│   ├── application.ts         # Application class
│   ├── bootstrap.ts           # Initialization/DI
│   ├── commands.ts            # Command handlers
│   ├── handlers.ts            # Message handlers
│   ├── types.ts               # Type definitions
│   ├── lib/                   # Utilities/helpers
│   │   ├── index.ts          # Barrel exports
│   │   └── *.ts              # Implementation files
│   └── services/              # Service implementations
│       └── *.ts              # Service classes
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
└── bun.lockb                  # Lock file
```

### Go Services Pattern

```
service/
├── cmd/
│   └── server/
│       └── main.go            # Entry point
├── internal/
│   ├── domain/               # Business logic
│   ├── handlers/             # Request handlers
│   └── database/             # Data access
├── api/                       # API definitions
├── go.mod                     # Dependencies
└── go.sum                     # Lock file
```

## Shared Libraries

### Shared Clients (`shared/clients/typescript/`)

```
shared/clients/typescript/
├── barkloader/                # Barkloader WebSocket client
│   ├── src/
│   │   └── index.ts
│   └── package.json
├── cloudevents/               # CloudEvents factory
│   ├── EventFactory.ts
│   ├── events.ts
│   └── types.ts
├── db/                        # Database client (generated)
│   ├── *.pb.ts               # Protocol Buffer generated
│   └── index.ts
├── messagebus/                # Message bus abstraction
│   └── src/
│       ├── index.ts          # Factory function
│       ├── nats-backend.ts   # NATS implementation
│       ├── http-backend.ts   # HTTP/WS implementation
│       └── types.ts
├── nats/                      # NATS client wrapper
│   └── src/
│       ├── client.ts
│       ├── index.ts
│       └── types.ts
├── servicediscovery/          # Service discovery utils
└── twitch/                    # Twitch API client
    └── src/
        └── getAccessToken.ts
```

### Shared Common (`shared/common/typescript/`)

```
shared/common/typescript/
├── runtime/
│   ├── application.ts        # Application interface
│   ├── index.ts              # Barrel exports
│   ├── runtime.ts            # XState machine
│   ├── service.ts            # Service interface
│   └── utils.ts              # Helpers
├── types.ts                   # Configuration types
├── utils.ts                   # General utilities
└── package.json
```

## Frontend Structure

### Streamlabs (`streamlabs/`)

```
streamlabs/
├── app/
│   ├── routes/               # Remix routes
│   │   ├── _index.tsx
│   │   ├── bits/
│   │   └── *.tsx
│   ├── components/           # React components
│   └── root.tsx              # Root layout
├── chatwidget/               # Chat overlay widget
├── obs/                      # OBS control module
│   ├── Manager.ts
│   └── Source.ts
├── slobs/                    # Streamlabs OBS module
│   ├── Manager.ts
│   ├── Scene.ts
│   └── Source.ts
├── timer/                    # Timer widget
├── public/                   # Static assets
├── server.ts                 # Express server
├── nats.ts                   # NATS connection
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

## Plugin System

### Barkloader (`barkloader/`)

Rust module/plugin system. User modules are uploaded as ZIP archives containing
a manifest plus Lua and/or QuickJS source; barkloader parses, stores, and
executes them inside `lib_sandbox`.

```
barkloader/
├── app/                       # Actix-web server, routes, module service
├── lib_sandbox/               # Sandboxed execution (Lua, QuickJS adapters)
│   └── tests/                 # Rust tests
├── lib_repository/            # Storage abstraction (filesystem, S3)
├── Cargo.toml
└── Cargo.lock
```

## Workflow Engine

### Wooflow (`wooflow/`)

```
wooflow/
├── main.go                    # Entry point
├── activities/                # Temporal activities
├── workflows/                 # Temporal workflows
├── internal/
│   └── workflow/
│       └── temporal/
├── workflow.db                # SQLite database
├── go.mod
└── go.sum
```

## Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Root workspace dependencies |
| `process-compose.yml` | Service orchestration |
| `docker-compose.yaml` | Docker configuration |
| `Dockerfile` | Production image |
| `devbox.json` | Nix development environment |
| `biome.json` | Code formatting rules |
| `axogen.config.ts` | Environment variable generation |
| `Caddyfile` | Reverse proxy configuration |
| `.env.vault` | Encrypted environment variables |

## Module Organization Strategy

**Hybrid Domain + Layer-based**

### Domain Organization
```
Streaming Domain:
  twitch/           # Platform integration
  streamlabs/       # UI & alerts
  reward/           # Viewer rewards
  wooflow/          # Workflow automation

Bot/Chat Domain:
  woofwoofwoof/     # Chat automation
  barkloader/       # Module/plugin execution (Rust)

Infrastructure Domain:
  db/               # Data persistence
  services/         # Message passing
  shared/           # Cross-cutting concerns
```

### Naming Conventions

**Files:**
- PascalCase for classes: `Application.ts`, `Manager.ts`
- camelCase for utilities: `utils.ts`, `helpers.ts`
- lowercase for domain: `nats.ts`, `commands.ts`

**Directories:**
- lowercase with hyphens: `messagebus-gateway`
- simple lowercase: `src/`, `lib/`, `internal/`

## Import Path Aliases

```json
{
  "paths": {
    "@woofx3/common/*": ["shared/common/typescript/*"],
    "@woofx3/*": ["shared/clients/typescript/*"]
  }
}
```

**Usage:**
```typescript
import { createRuntime } from "@woofx3/common/runtime";
import MessageBus from "@woofx3/nats";
import TwitchClient from "@woofx3/twitch";
```
