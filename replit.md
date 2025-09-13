# Streamlabs Multi-Service Application

## Overview
This is a comprehensive streaming platform application with multiple interconnected services including a primary frontend, authentication, database management, plugin systems, and streaming tools. The project has been successfully imported and configured to run in the Replit environment.

## Current State
- **Status**: ✅ Successfully imported and running
- **Primary Frontend**: Streamlabs (Remix-based React application)
- **Port**: 5000 (configured for Replit environment)
- **Workflow**: "Streamlabs Frontend" - running successfully

## Recent Changes (2025-09-13)
- Installed required programming languages (Node.js 20, Go 1.24, Rust stable)
- Configured primary frontend service for Replit environment
- Updated vite.config.ts to use host 0.0.0.0 and port 5000
- Modified server.ts to bind to 0.0.0.0:5000 for Replit proxy compatibility
- Added graceful error handling for external services (OBS, NATS)
- Fixed package.json dev script to use bun for TypeScript execution
- Added basic API stubs to prevent 404 errors
- Configured deployment settings for production (autoscale)

## Project Architecture

### Frontend Services
- **streamlabs/**: Primary frontend (Remix + React + Vite)
- **extension/client/**: Twitch extension frontend (React + Vite)
- **streamerui/**: Streamer management interface (Remix)

### Backend Services
- **auth/**: Authentication service (Go)
- **db/**: Database proxy and API (Go)
- **permissions/**: Viewer permissions service (Go)
- **twitch/**: Twitch API integration (Bun/TypeScript)
- **reward/**: Viewer rewards system (Bun/TypeScript)
- **stream/**: Voice control and transcription (Go)
- **wooflow/**: Workflow management (Go)
- **woofwoofwoof/**: Twitch chatbot (Bun/TypeScript)

### Plugin Systems
- **barkloader/**: Plugin module system (Bun/TypeScript + Lua)
- **barkloader-rust/**: Rust-based plugin system

## Technology Stack
- **Frontend**: React, Remix, Vite, TailwindCSS
- **Backend**: Go, Bun (TypeScript), Express
- **Databases**: PostgreSQL, SQLite
- **External Integrations**: Twitch API, OBS WebSocket, NATS messaging
- **Languages**: TypeScript, Go, Rust, Lua

## Configuration Notes
- External services (OBS, NATS) are optional and gracefully handled when not configured
- Environment variables needed for full functionality:
  - `INSTANTDB_ADMIN_TOKEN`: For database operations
  - `OBS_HOST`, `OBS_PORT`, `OBS_RPC_TOKEN`: For OBS integration
  - `NATS_USER_JWT`, `NATS_NKEY_SEED`: For message bus
  - Various Twitch API credentials

## User Preferences
- Development environment optimized for streaming/content creation tools
- Multi-service architecture maintained as intended
- Graceful degradation when external services unavailable

## Running the Application
The primary frontend is accessible via the Replit preview at port 5000. Additional services can be started individually or via the process-compose.yml configuration for local development.