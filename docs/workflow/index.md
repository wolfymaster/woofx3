# Workflow Engine

Event-driven workflow execution engine inspired by Cadence/Temporal. Supports both code-defined workflows and dynamic workflows provided via JSON or YAML configuration. Workflows have **Triggers** that start them and **Tasks** that run sequentially until completion.

## Overview

The workflow service is a Go microservice that:

- Listens for events on the NATS message bus
- Matches incoming events against registered workflow triggers
- Executes task graphs with dependency resolution (topological sort)
- Supports branching, waiting for external events, aggregation, and nested sub-workflows
- Integrates with Barkloader for module function invocation
- Manages workflow lifecycle via database persistence and CloudEvents CRUD notifications

## Architecture

```
NATS Message Bus
    |
    v
EventPatternRegistry        CloudEvents (workflow CRUD)
  *.user.twitch                  |
  *.channel.twitch               v
    |                      WorkflowManager
    v                        |         |
WorkflowApp              LoadFromDB  Register/Unregister
    |
    v
Engine
  |-- WorkflowRegistry (event type -> workflow definitions)
  |-- TaskRegistry (built-in task types)
  |-- ActionRegistry (pluggable actions)
  |-- DependencyGraph (topological sort)
  |-- ExpressionResolver (${...} templates)
  |-- ConditionEvaluator (operators)
  |
  v
WorkflowExecution
  |-- TaskExecution[]
  |-- WaitState (paused, waiting for events)
  |-- WorkflowState (sub-workflow tracking)
```

## Services

The workflow service depends on three external services, registered at startup:

| Service | Type | Purpose |
|---------|------|---------|
| **NATS** | Message Bus | Event subscriptions, publishing workflow events |
| **Barkloader** | WebSocket | Invoking module functions from action tasks |
| **DB Proxy** | HTTP/gRPC | Loading and persisting workflow definitions |

## Configuration

Loaded from `.woofx3.json` in the project root, with environment variable overrides:

| Variable | Default | Description |
|----------|---------|-------------|
| `BARKLOADER_WS_URL` | `ws://localhost:3001` | Barkloader WebSocket URL |
| `DATABASE_PROXY_URL` | `http://localhost:3002` | Database proxy HTTP URL |

## Event Subscriptions

The service subscribes to NATS patterns for workflow triggers:

| Pattern | Events |
|---------|--------|
| `*.user.twitch` | Cheers, follows, subscriptions, chat messages |
| `*.channel.twitch` | Hype trains, stream online/offline |

Additionally subscribes to workflow lifecycle events:

| Subject | Purpose |
|---------|---------|
| `workflow.change` | Workflow create/update/delete notifications from DB |
| `workflow.execute` | Direct workflow execution requests |

## API

Workflow CRUD and execution is exposed through two API layers -- the DB Proxy (Twirp RPC) for internal services and the API Server (Cap'n Web RPC) for UI clients. See the [API documentation](./api) for endpoint details, request/response schemas, and examples.
