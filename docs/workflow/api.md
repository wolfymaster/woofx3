# Workflow API

Workflow CRUD and execution is exposed through two API layers. The **DB Proxy** provides the canonical Twirp RPC interface used by internal services. The **API Server** wraps the DB Proxy with a UI-focused interface exposed via Cap'n Web RPC.

```
UI / WebSocket Client
    |
    v
API Server (Cap'n Web RPC)    <-- user-friendly, high-level
    |
    v
DB Proxy (Twirp RPC)          <-- canonical CRUD, protobuf schemas
    |
    v
PostgreSQL / SQLite
```

## DB Proxy (Twirp RPC)

**Transport:** HTTP POST with Protobuf or JSON payloads (Twirp protocol)
**Base path:** `/twirp/workflow.WorkflowService/`

All requests use `POST`. Set `Content-Type: application/json` for JSON payloads or `Content-Type: application/protobuf` for binary.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| CreateWorkflow | `/twirp/workflow.WorkflowService/CreateWorkflow` | Create a new workflow definition |
| GetWorkflow | `/twirp/workflow.WorkflowService/GetWorkflow` | Get a workflow by ID |
| UpdateWorkflow | `/twirp/workflow.WorkflowService/UpdateWorkflow` | Update an existing workflow |
| DeleteWorkflow | `/twirp/workflow.WorkflowService/DeleteWorkflow` | Delete a workflow |
| ListWorkflows | `/twirp/workflow.WorkflowService/ListWorkflows` | List workflows with filtering and pagination |
| ExecuteWorkflow | `/twirp/workflow.WorkflowService/ExecuteWorkflow` | Trigger a workflow execution |
| GetWorkflowExecution | `/twirp/workflow.WorkflowService/GetWorkflowExecution` | Get execution status |
| ListWorkflowExecutions | `/twirp/workflow.WorkflowService/ListWorkflowExecutions` | List executions with filtering |
| CancelWorkflowExecution | `/twirp/workflow.WorkflowService/CancelWorkflowExecution` | Cancel a running execution |

### Schemas

#### Workflow

```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "applicationId": "string",
  "createdBy": "string",
  "enabled": true,
  "steps": [WorkflowStep],
  "variables": { "key": "value" },
  "onSuccess": "string",
  "onFailure": "string",
  "maxRetries": 3,
  "timeoutSeconds": 300,
  "createdAt": "2026-01-15T10:30:00Z",
  "updatedAt": "2026-01-15T10:30:00Z"
}
```

#### WorkflowStep

```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "type": "command | http | condition | wait | action",
  "parameters": { "key": "value" },
  "onSuccess": "step-id",
  "onFailure": "step-id",
  "timeoutSeconds": 30,
  "retryAttempts": 2,
  "async": false,
  "outputs": { "varName": "expression" }
}
```

#### WorkflowExecution

```json
{
  "id": "string",
  "workflowId": "string",
  "status": "pending | running | completed | failed | cancelled",
  "startedBy": "string",
  "applicationId": "string",
  "inputs": { "key": "value" },
  "outputs": { "key": "value" },
  "error": "string",
  "startedAt": "2026-01-15T10:30:00Z",
  "completedAt": "2026-01-15T10:31:00Z",
  "createdAt": "2026-01-15T10:30:00Z",
  "updatedAt": "2026-01-15T10:31:00Z",
  "steps": [ExecutionStep]
}
```

#### ExecutionStep

```json
{
  "stepId": "string",
  "name": "string",
  "status": "pending | running | completed | failed | skipped",
  "attempt": 1,
  "error": "string",
  "inputs": { "key": "value" },
  "outputs": { "key": "value" },
  "startedAt": "2026-01-15T10:30:00Z",
  "completedAt": "2026-01-15T10:30:05Z",
  "durationMs": 5000
}
```

### Request / Response Examples

#### CreateWorkflow

**Request:**

```json
{
  "name": "Welcome New Follower",
  "description": "Plays a welcome animation when someone follows",
  "applicationId": "app-123",
  "createdBy": "user-456",
  "enabled": true,
  "steps": [
    {
      "id": "step-1",
      "name": "Play Sound",
      "type": "action",
      "parameters": {
        "action": "playSound",
        "sound": "welcome.mp3"
      }
    },
    {
      "id": "step-2",
      "name": "Show Alert",
      "type": "command",
      "parameters": {
        "command": "obs.showSource",
        "source": "FollowAlert"
      },
      "onSuccess": "step-3"
    },
    {
      "id": "step-3",
      "name": "Hide Alert",
      "type": "command",
      "parameters": {
        "command": "obs.hideSource",
        "source": "FollowAlert"
      },
      "timeoutSeconds": 5
    }
  ],
  "variables": {
    "alertDuration": "5"
  },
  "maxRetries": 1,
  "timeoutSeconds": 30
}
```

**Response:**

```json
{
  "status": { "code": "OK", "message": "" },
  "workflow": {
    "id": "wf-789",
    "name": "Welcome New Follower",
    "description": "Plays a welcome animation when someone follows",
    "applicationId": "app-123",
    "createdBy": "user-456",
    "enabled": true,
    "steps": [ ... ],
    "variables": { "alertDuration": "5" },
    "maxRetries": 1,
    "timeoutSeconds": 30,
    "createdAt": "2026-01-15T10:30:00Z",
    "updatedAt": "2026-01-15T10:30:00Z"
  }
}
```

#### GetWorkflow

**Request:**

```json
{ "id": "wf-789" }
```

**Response:** Same shape as `CreateWorkflow` response.

#### ListWorkflows

**Request:**

```json
{
  "applicationId": "app-123",
  "includeDisabled": false,
  "page": 1,
  "pageSize": 20,
  "sortBy": "name",
  "sortDesc": false
}
```

**Response:**

```json
{
  "status": { "code": "OK", "message": "" },
  "workflows": [ ... ],
  "totalCount": 42,
  "page": 1,
  "pageSize": 20
}
```

#### ExecuteWorkflow

**Request:**

```json
{
  "workflowId": "wf-789",
  "applicationId": "app-123",
  "startedBy": "user-456",
  "inputs": { "username": "wolfymaster" },
  "async": true,
  "correlationId": "evt-abc-123"
}
```

**Response:**

```json
{
  "status": { "code": "OK", "message": "" },
  "executionId": "exec-001",
  "async": true,
  "statusUrl": "/twirp/workflow.WorkflowService/GetWorkflowExecution",
  "outputs": {}
}
```

#### ListWorkflowExecutions

**Request:**

```json
{
  "workflowId": "wf-789",
  "applicationId": "app-123",
  "status": "completed",
  "page": 1,
  "pageSize": 10,
  "sortBy": "started_at",
  "sortDesc": true
}
```

**Response:**

```json
{
  "status": { "code": "OK", "message": "" },
  "executions": [ ... ],
  "totalCount": 15,
  "page": 1,
  "pageSize": 10
}
```

#### CancelWorkflowExecution

**Request:**

```json
{
  "id": "exec-001",
  "reason": "User requested cancellation"
}
```

**Response:**

```json
{ "code": "OK", "message": "" }
```

## API Server (Cap'n Web RPC)

> **Design principle:** The engine API only receives semantic workflow data (name, steps, trigger).
> UI-specific state such as visual layout (ReactFlow nodes/edges) is the responsibility of the
> calling UI and should be stored separately (e.g., in Convex for woofx3-ui).

**Transport:** HTTP batch RPC (`POST /api`) or WebSocket (`ws://localhost:8080/api`)
**Protocol:** Cap'n Web -- methods are called by name with JSON arguments. Multiple calls can be batched in a single request.

These methods wrap the DB Proxy and provide a higher-level interface designed for UI consumption. The API server automatically scopes requests to the current application.

### Methods

#### createWorkflow

Creates a new workflow in the engine. Accepts `steps[]` and `trigger` (semantic execution data only).
`nodes` and `edges` (ReactFlow visual layout) are NOT accepted and should be stored separately by the UI.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | yes | Workflow display name |
| `description` | string | no | Human-readable description |
| `accountId` | string | yes | Application/account ID |
| `isEnabled` | boolean | no | Whether the workflow is active |
| `steps` | WorkflowStep[] | no | Executable steps the engine runs |
| `trigger` | WorkflowTrigger | no | Event trigger definition |

Where `WorkflowStep` is:
```typescript
{
  id: string;
  name: string;
  /**
   * Engine task type — must be one of the five built-in types:
   *   action    run a registered action (module function)
   *   log       write a debug message
   *   condition AND/OR branching; parameters carry conditions/conditionLogic/onTrue/onFalse
   *   wait      pause until an event arrives (single or aggregation mode)
   *   workflow  execute a sub-workflow; parameters carry workflowId/waitUntilCompletion/timeout
   */
  type: 'action' | 'log' | 'condition' | 'wait' | 'workflow';
  action?: string;           // e.g. "action-show-alert" — only used when type is "action"
  parameters?: Record<string, unknown>;
  dependsOn?: string[];
}
```

And `WorkflowTrigger` is:
```typescript
{
  type: 'event';
  event: string;             // NATS subject, e.g. "follow.user.twitch"
  condition?: Record<string, unknown>;
}
```

**Returns:** `WorkflowItem` including the engine-assigned `id`. The calling UI should store its
visual state (nodes/edges) separately, linked to the engine via this `id`.

---

#### updateWorkflow

Updates an existing workflow. Accepts `steps` and `trigger` to replace stored execution data.
`nodes` and `edges` are not accepted. Any legacy `_nodes`/`_edges` variables are removed on update.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | yes | Engine workflow ID |
| `name` | string | no | Updated display name |
| `description` | string | no | Updated description |
| `isEnabled` | boolean | no | Enable/disable the workflow |
| `steps` | unknown[] | no | Replaces the stored steps array |
| `trigger` | unknown | no | Replaces the stored trigger |

**Returns:** Updated `WorkflowItem` or `null` if not found.

#### getAvailableWorkflows

Returns all enabled workflows with their most recent execution status.

**Parameters:** None

**Response:**

```json
{
  "workflows": [
    {
      "id": "wf-789",
      "name": "Welcome New Follower",
      "description": "Plays a welcome animation when someone follows",
      "enabled": true,
      "lastExecution": {
        "id": "exec-001",
        "status": "completed",
        "startedAt": "2026-01-15T10:30:00Z"
      }
    }
  ]
}
```

#### triggerWorkflowByName

Triggers a workflow by its human-readable name rather than ID. Performs a case-insensitive lookup.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflowName` | string | yes | Name of the workflow to trigger |
| `parameters` | Record\<string, string\> | no | Input parameters for the workflow |
| `userId` | string | no | User ID of the person triggering |

**Response:**

```json
{
  "executionId": "exec-002",
  "status": "started",
  "message": "Workflow 'Welcome New Follower' triggered successfully"
}
```

#### getWorkflowStatus

Returns detailed execution status including per-step progress and a progress percentage.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `executionId` | string | yes | ID of the execution to check |

**Response:**

```json
{
  "id": "exec-001",
  "workflowId": "wf-789",
  "workflowName": "Welcome New Follower",
  "status": "running",
  "progress": 66,
  "startedAt": "2026-01-15T10:30:00Z",
  "steps": [
    { "name": "Play Sound", "status": "completed", "startedAt": "...", "completedAt": "..." },
    { "name": "Show Alert", "status": "completed", "startedAt": "...", "completedAt": "..." },
    { "name": "Hide Alert", "status": "running", "startedAt": "..." }
  ]
}
```

#### getWorkflowHistory

Returns paginated execution history with optional filtering.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workflowName` | string | no | Filter by workflow name |
| `userId` | string | no | Filter by user who triggered |
| `status` | string | no | Filter by execution status |
| `limit` | number | no | Max results to return |

**Response:**

```json
{
  "executions": [
    {
      "id": "exec-001",
      "workflowName": "Welcome New Follower",
      "status": "completed",
      "startedAt": "2026-01-15T10:30:00Z",
      "completedAt": "2026-01-15T10:31:00Z",
      "startedBy": "user-456"
    }
  ]
}
```

#### cancelWorkflow

Cancels a running workflow execution.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `executionId` | string | yes | ID of the execution to cancel |
| `reason` | string | no | Reason for cancellation (defaults to "Cancelled by user") |

**Response:** void (throws on failure)

## Event-Driven Updates

When workflows are created, updated, or deleted through the DB Proxy, CloudEvents are published to the NATS message bus. The workflow engine subscribes to these events and hot-reloads its internal registry without requiring a restart.

### CloudEvent Subjects

| Subject | Trigger | Effect |
|---------|---------|--------|
| `workflow.change.add` | Workflow created | Engine registers the new workflow definition |
| `workflow.change.update` | Workflow updated | Engine replaces the existing definition |
| `workflow.change.delete` | Workflow deleted | Engine unregisters the workflow |
| `workflow.execute` | Execution requested | Engine starts a new workflow execution |

The parent subject `workflow.change` can be used to subscribe to all CRUD events at once.

### Flow

```
Client -> DB Proxy (CreateWorkflow)
              |
              |--> Persists to database
              |--> Publishes CloudEvent to NATS (workflow.change.add)
                        |
                        v
                   Workflow Engine
                     |--> Updates WorkflowRegistry
                     |--> Workflow is immediately available for triggering
```

This event-driven approach means the workflow engine does not poll the database. Changes are propagated in real-time through NATS, keeping the engine's in-memory registry consistent with the persisted state.
