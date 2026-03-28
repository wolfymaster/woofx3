# Integrations

> Generated: 2026-01-14 (Refreshed)

## External APIs

### Twitch API

| Aspect | Details |
|--------|---------|
| **Type** | REST + EventSub WebSocket |
| **Libraries** | @twurple/api, @twurple/chat, @twurple/eventsub-ws (v7.4.0) |
| **Auth** | OAuth 2.0 (authorization code flow) |

**Environment Variables:**
```
TWITCH_WOLFY_CLIENT_ID
TWITCH_WOLFY_CLIENT_SECRET
TWITCH_REDIRECT_URL
TWITCH_CHANNEL_NAME
```

**Features:**
- Chat monitoring
- Stream data
- Viewer analytics
- Clip creation
- Moderation actions

**Implementation Files:**
- `twitch/src/lib/twitch.ts`
- `woofwoofwoof/src/services/twitch.ts`
- `shared/clients/typescript/twitch/`

### Spotify API

| Aspect | Details |
|--------|---------|
| **Type** | REST |
| **Library** | @spotify/web-api-ts-sdk v1.2.0 |
| **Auth** | OAuth 2.0 with refresh token |
| **Endpoint** | https://accounts.spotify.com/api/token |

**Environment Variables:**
```
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
```

**Features:**
- Song search
- Player control
- Playlist management
- Device enumeration

**Implementation File:**
- `woofwoofwoof/src/spotify.ts`

### OBS WebSocket

| Aspect | Details |
|--------|---------|
| **Type** | WebSocket |
| **Library** | obs-websocket-js v5.0.6 |

**Environment Variables:**
```
OBS_HOST
OBS_PORT
OBS_RPC_TOKEN
```

**Features:**
- Scene control
- Source management
- Streaming state

**Implementation File:**
- `streamlabs/server.ts`
- `streamlabs/obs/Manager.ts`

### TTS Monster API

| Aspect | Details |
|--------|---------|
| **Type** | REST |
| **Endpoint** | https://api.console.tts.monster/generate |

**Environment Variables:**
```
TTSMONSTER_API_TOKEN
```

**Implementation File:**
- `twitch/src/handlers.ts`

### Govee Smart Lights

| Aspect | Details |
|--------|---------|
| **Type** | Proprietary API |
| **Purpose** | RGB lighting control |

**Implementation Files:**
- `barkloader/storage/src/light/govee.ts`
- `woofwoofwoof/src/govee.ts`

## Databases

### PostgreSQL

| Aspect | Details |
|--------|---------|
| **Driver** | gorm.io/driver/postgres v1.5.11 |
| **Library** | jackc/pgx v5.7.2+ |
| **ORM** | GORM v1.26.0 |

**Connection Settings:**
- Max open connections: 100
- Max idle connections: 10
- Connection lifetime: 1 hour
- UUID extension support

**Implementation File:**
- `db/internal/database/db.go`

### SQLite

| Aspect | Details |
|--------|---------|
| **Drivers** | glebarez/sqlite, modernc.org/sqlite |
| **Purpose** | Local/embedded storage, workflow state |

**Implementation:**
- `wooflow/workflow.db`

### BadgerDB

| Aspect | Details |
|--------|---------|
| **Library** | dgraph-io/badger v3.2103.5 |
| **Purpose** | High-performance key-value store |

**Implementation File:**
- `db/internal/database/db.go`

### InstantDB

| Aspect | Details |
|--------|---------|
| **Type** | Real-time database as a service |
| **Libraries** | @instantdb/admin, @instantdb/react v0.17.23+ |
| **App ID** | 8c28dd52-4859-4560-8d45-2408b064b248 |

**Environment Variables:**
```
INSTANTDB_ADMIN_TOKEN
```

**Purpose:**
- User preferences
- Configuration storage
- Real-time updates

**Implementation File:**
- `streamlabs/server.ts`

## Message Queues

### NATS (Primary)

| Aspect | Details |
|--------|---------|
| **Version** | 2.29.3 (TypeScript), 1.37.0 (Go) |
| **Server** | tls://connect.ngs.global (NATS Cloud) |
| **Auth** | JWT + NKey |

**Environment Variables:**
```
NATS_URL=wss://connect.ngs.global
NATS_USER_JWT
NATS_NKEY_SEED
```

**Topics:**
- `workflow.>` - Workflow events
- `slobs` - Streamlabs commands
- `chat.message` - Chat events
- `HEARTBEAT` - Health monitoring

**Implementation Files:**
- `shared/clients/typescript/nats/`
- `shared/clients/typescript/messagebus/`
- `shared/clients/golang/messagebus/`

### HTTP WebSocket (Fallback)

| Aspect | Details |
|--------|---------|
| **Endpoint** | ws://localhost:8080/ws |
| **Purpose** | Local development fallback |

**Implementation File:**
- `services/messagebus-gateway/`

## Third-Party Services

### Temporal (Workflow Orchestration)

| Aspect | Details |
|--------|---------|
| **Library** | go.temporal.io/sdk v1.25.1 |
| **Purpose** | Stream automation, scheduled tasks |

**Implementation File:**
- `wooflow/`

### Anthropic Claude (AI)

| Aspect | Details |
|--------|---------|
| **Library** | @langchain/anthropic v0.3.15 |
| **Purpose** | AI-powered moderation and responses |

**Implementation File:**
- `twitch/src/handlers.ts`

## Authentication

### Twitch OAuth 2.0

| Aspect | Details |
|--------|---------|
| **Library** | @twurple/auth v7.4.0 |
| **Flow** | Authorization code |

**Implementation File:**
- `shared/clients/typescript/twitch/getAccessToken.ts`

### JWT

| Aspect | Details |
|--------|---------|
| **Go Library** | golang-jwt/jwt v5.3.0 |
| **Purpose** | API authentication, NATS auth |

### NATS NKey

| Aspect | Details |
|--------|---------|
| **Library** | nats-io/nkeys v0.4.7+ |
| **Purpose** | Cryptographic client authentication |

## Configuration Management

### Environment Variables (.env.vault)

| Aspect | Details |
|--------|---------|
| **System** | dotenv-vault |
| **Vault ID** | vlt_23e1bc31f78... |

**Environments:**
- `DOTENV_VAULT_DEVELOPMENT`
- `DOTENV_VAULT_STAGING`
- `DOTENV_VAULT_CI`
- `DOTENV_VAULT_PRODUCTION`

### Key Environment Variables

```bash
# Core
FORCE_COLOR=1
NODE_ENV=production|development

# NATS/Message Bus
NATS_URL=wss://connect.ngs.global
NATS_USER_JWT=<jwt_token>
NATS_NKEY_SEED=<seed>
MESSAGEBUS_HTTP_URL=ws://localhost:8080/ws
MESSAGEBUS_GATEWAY_ADDRESS=0.0.0.0:8080

# Databases
DATABASE_PROXY_URL=http://localhost:3000
INSTANTDB_ADMIN_TOKEN=<token>

# Twitch
TWITCH_CHANNEL_NAME=<channel>
TWITCH_WOLFY_CLIENT_ID=<id>
TWITCH_WOLFY_CLIENT_SECRET=<secret>
TWITCH_REDIRECT_URL=http://localhost

# Spotify
SPOTIFY_CLIENT_ID=<id>
SPOTIFY_CLIENT_SECRET=<secret>

# OBS
OBS_HOST=localhost
OBS_PORT=4444
OBS_RPC_TOKEN=<token>

# Service Ports
SLOBS_PORT=59650
SLOBS_HOST=127.0.0.1
PORT=5175
```

## Protocol Buffers

**Purpose:** Database client code generation

| Tool | Version |
|------|---------|
| protoscript | 0.0.23 |
| twirpscript | 0.0.72 |
| twitchtv/twirp | 8.1.3 |

**Generated Files:**
- `shared/clients/typescript/db/*.pb.ts`

## Integration Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Twitch API   │     │   Spotify API   │     │  OBS WebSocket  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Application Layer                         │
│   (twitch/, woofwoofwoof/, streamlabs/, reward/, wooflow/)      │
└─────────────────────────────────────────────────────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                         NATS Message Bus                         │
│              (Real-time inter-service communication)             │
└─────────────────────────────────────────────────────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PostgreSQL    │     │    InstantDB    │     │    BadgerDB     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```
