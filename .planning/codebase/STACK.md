# Technology Stack

> Generated: 2026-01-14 (Refreshed)

## Languages

| Language | Version | Primary Use |
|----------|---------|-------------|
| TypeScript | 5.0+ | Backend services, clients, shared libraries |
| Go | 1.24.0 | Backend services (database, workflows, gateway) |
| Rust | stable | High-performance plugin system (barkloader-rust) |
| Lua | via wasmoon | Plugin scripting support |
| JavaScript/JSX | ES2022 | React frontend components |

## Runtime Environment

| Component | Version | Purpose |
|-----------|---------|---------|
| **Bun** | 1.1.34 | Primary TypeScript runtime and package manager |
| **Node.js** | 20+ | Fallback runtime (required for some packages) |
| **Go** | 1.24.0 | Go services runtime |
| **process-compose** | 1.46.0 | Service orchestration |
| **Temporal Server** | CLI | Workflow execution |

## Frameworks

### Frontend
| Framework | Version | Purpose |
|-----------|---------|---------|
| **Remix** | 2.16.0 | Full-stack web framework |
| **React** | 18.2.0 | UI component library |
| **Vite** | 6.0.0 | Build tool and dev server |
| **TailwindCSS** | 3.4.4 | Utility-first CSS |

### Backend
| Framework | Version | Purpose |
|-----------|---------|---------|
| **Express** | 4.21.2+ | HTTP server (Remix adapter) |
| **XState** | 5.x | State machine runtime |
| **GORM** | 1.26.0 | Go ORM |
| **Temporal SDK** | 1.25.1+ | Workflow orchestration |
| **Casbin** | 2.103.0 | RBAC authorization (Go) |

### AI/ML
| Library | Version | Purpose |
|---------|---------|---------|
| **LangChain** | 0.3.19 | LLM orchestration |
| **LangGraph** | 0.2.54 | Agent graph framework |
| **@langchain/anthropic** | 0.3.15 | Claude AI integration |

## Key Dependencies

### Messaging & Events
| Package | Version | Purpose |
|---------|---------|---------|
| **nats** | 2.29.3 | Message streaming (TypeScript) |
| **nats-io/nats.go** | 1.37.0 | Message streaming (Go) |
| **cloudevents** | 1.0.0 (spec) | Event format standard |

### Twitch Integration
| Package | Version | Purpose |
|---------|---------|---------|
| **@twurple/api** | 7.4.0 | Twitch Helix API |
| **@twurple/chat** | 7.4.0 | Chat protocol |
| **@twurple/eventsub-ws** | 7.4.0 | EventSub WebSocket |
| **@twurple/auth** | 7.4.0 | OAuth authentication |

### Spotify Integration
| Package | Version | Purpose |
|---------|---------|---------|
| **@spotify/web-api-ts-sdk** | 1.2.0 | Spotify Web API |

### OBS Integration
| Package | Version | Purpose |
|---------|---------|---------|
| **obs-websocket-js** | 5.0.6 | OBS Studio control |

### Database
| Package | Version | Purpose |
|---------|---------|---------|
| **@instantdb/admin** | 0.17.23+ | Real-time database |
| **@instantdb/react** | 0.17.23+ | React bindings |
| **gorm.io/gorm** | 1.26.0 | Go ORM |
| **gorm.io/driver/postgres** | 1.5.11 | PostgreSQL driver |
| **dgraph-io/badger** | 3.2103.5 | Key-value store |
| **glebarez/sqlite** | - | SQLite driver (Go) |

### Plugin System
| Package | Version | Purpose |
|---------|---------|---------|
| **wasmoon** | 1.16.0 | Lua WASM runtime |
| **twirpscript** | 0.0.72 | RPC framework |
| **protoscript** | 0.0.23 | Protobuf generation |

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| **winston** | 3.17.0 | Logging |
| **dotenv** | 16.4.7+ | Environment variables |
| **zod** | 3.x | Schema validation |
| **yargs** | 17.7.2 | CLI argument parsing |
| **uuid** | 11.0.5 | UUID generation |

## Build Tools

| Tool | Purpose |
|------|---------|
| **Bun** | Package manager, bundler, runtime |
| **Vite** | Frontend builds |
| **tsc** | TypeScript compilation |
| **Go toolchain** | Go builds |
| **Cargo** | Rust builds |
| **Biome** | Code formatting and linting |

## Package Manager

- **Primary**: Bun (bun.lockb files throughout)
- **Fallback**: npm (package-lock.json at root)
- **Go**: Go modules (go.mod files)
- **Rust**: Cargo (Cargo.toml files)

## Development Environment

| Tool | Version | Purpose |
|------|---------|---------|
| **Devbox** | latest | Nix-based dev environment |
| **Docker** | latest | Containerization |
| **Caddy** | latest | Reverse proxy |
| **SQLite** | latest | Local database |

## Module System

- **TypeScript**: ESM (type: "module")
- **Build Target**: ES2022
- **Path Aliases**:
  - `@woofx3/common/*` -> `shared/common/typescript/*`
  - `@woofx3/*` -> `shared/clients/typescript/*`

## Version Control & CI

- **Git**: Primary VCS
- **GitHub**: Remote repository hosting
- **dotenv-vault**: Encrypted environment management
