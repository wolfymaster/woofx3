# Execution Model

This page describes how workflows are executed at runtime.

## Lifecycle

```
Event arrives on NATS
    |
    v
EventPatternRegistry match (*.user.twitch, *.channel.twitch)
    |
    v
CloudEvents validation (id, type, source required)
    |
    v
WorkflowRegistry lookup by event type
    |
    v
Trigger condition evaluation (if conditions defined)
    |
    v
WorkflowExecution created (UUID, status: running)
    |
    v
DependencyGraph built from task dependsOn fields
    |
    v
Topological sort -> execution order
    |
    v
Tasks execute sequentially in order:
    |-- Guard conditions evaluated (skip if false)
    |-- Parameters resolved (${...} expressions)
    |-- Task executed
    |-- Exports collected for downstream tasks
    |-- Error handling (continue or fail)
    |
    v
Execution completed/failed
```

## Dependency Resolution

Tasks declare dependencies via `dependsOn`. The engine builds a directed acyclic graph and performs a topological sort to determine execution order.

```json
{
  "tasks": [
    { "id": "A", "type": "log", "parameters": { "message": "first" } },
    { "id": "B", "type": "log", "dependsOn": ["A"], "parameters": { "message": "after A" } },
    { "id": "C", "type": "log", "dependsOn": ["A"], "parameters": { "message": "also after A" } },
    { "id": "D", "type": "log", "dependsOn": ["B", "C"], "parameters": { "message": "after B and C" } }
  ]
}
```

Execution order: A -> B -> C -> D (B and C both depend on A, D depends on both).

Circular dependencies are detected at graph construction time and cause the workflow to fail immediately.

## Execution States

### Workflow Execution

| Status | Description |
|--------|-------------|
| `running` | Workflow is actively executing tasks |
| `waiting` | Workflow is paused (wait task or sub-workflow) |
| `completed` | All tasks finished successfully |
| `failed` | A task failed with `onError: "fail"` |

### Task Execution

| Status | Description |
|--------|-------------|
| `pending` | Task has not started |
| `running` | Task is currently executing |
| `waiting` | Task is waiting for an external event |
| `success` | Task completed successfully |
| `failed` | Task execution failed |
| `skipped` | Task was skipped (guard condition false or branch not taken) |

## Pausing and Resuming

### Wait Tasks

When a `wait` task is encountered:

1. A `WaitState` is initialized with the event type, conditions, and timeout
2. The execution is registered in `waitingExecutions` keyed by event type
3. The workflow pauses (returns from execution loop)

When a matching event arrives:

1. `processWaitingExecutions` checks all waiting executions for that event type
2. If the wait condition is satisfied (event match + aggregation threshold), the execution resumes from the next task
3. If not satisfied, the execution remains in the waiting list

### Sub-Workflows

When a `workflow` task with `waitUntilCompletion: true` is encountered:

1. The sub-workflow is started asynchronously
2. A `SubWorkflowWaiter` is registered keyed by the sub-execution ID
3. The parent workflow pauses

When the sub-workflow completes:

1. `checkSubWorkflowCompletion` finds all parent workflows waiting for it
2. Sub-workflow results are copied to the parent task's exports
3. Parent workflows resume from the next task

## Workflow CRUD Events

The service listens for CloudEvents on the workflow change subject. When a workflow is created, updated, or deleted in the database:

1. The `WorkflowManager` receives the event
2. For create/update: fetches the full workflow from the DB proxy and registers it in the engine
3. For delete: unregisters the workflow from the engine

This allows workflows to be managed via the database without restarting the service.

## Error Handling

Each task can specify `onError`:

- `"fail"` (default): The task failure propagates to the workflow. The workflow is marked as failed and no further tasks execute.
- `"continue"`: The task is marked as failed but execution continues with the next task.

Condition evaluation errors always fail the workflow regardless of `onError`.

Wait task timeouts follow `onTimeout`:

- `"fail"` (default): The workflow fails.
- `"continue"`: The wait task is marked as successful and execution continues.

## Concurrency

- Each workflow execution runs in its own goroutine
- Multiple workflows can be triggered by the same event simultaneously
- Wait task resumptions spawn new goroutines
- Internal state is protected by `sync.RWMutex` on executions, waiting executions, and sub-workflow waiters
