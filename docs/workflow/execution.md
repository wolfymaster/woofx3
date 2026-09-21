# Execution Model

This page describes how workflows are executed at runtime.

## Lifecycle

```
Event arrives on NATS
    |
    v
EventPatternRegistry match (channel.*, stream.*, user.*)
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
Tasks execute in order; independent adjacent ones run together:
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

### Concurrency

Adjacent tasks that do not depend on one another execute at the same time,
bounded by a concurrency cap (8 by default). Two actions hanging off the same
condition run together rather than one after the other, so "play the sound
*while* the overlay animates" is expressible by declaring both against the
same dependency rather than chaining them.

A task stays sequential when any of the following holds, because none of them
has a defined answer under concurrency:

- It is a `wait` or `workflow` task. Both suspend the whole execution and
  resume by index, so they cannot sit inside a set of tasks with no ordering
  between them.
- It is a `condition` task, which decides which later tasks are skipped.
- It declares `dependsOn` a task in the same run.
- It reads another run member's exports as `${otherTask.field}` **without**
  declaring `dependsOn`. Such a workflow works today only because the sorted
  order happened to put them in sequence; it keeps working, sequentially,
  rather than becoming a race.

A failing task fails the execution, exactly as it does sequentially. Siblings
already running are allowed to finish rather than being cancelled: they are
independent by construction, and tearing them down partway would make a task's
side effects depend on how quickly an unrelated sibling failed.

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

## Loops

A run can cause events, and an event can start a run, so workflows can trigger
each other in a circle: a "counter changed" workflow that changes the same
counter, a "run finished" workflow that finishes, A publishing what B listens for
while B publishes what A listens for. The engine stops these at run time.

**Every event remembers the runs that led to it.** The `workflowChain` CloudEvents
extension attribute lists them, oldest first, as comma-separated workflow ids.
Each way a run causes an event stamps the event with the chain of the run's own
trigger event plus the run's workflow:

| How a run causes an event | Where the chain is stamped |
|---|---|
| A `publish_event` step | the engine, on the published event |
| A module function step that returns [`ctx.result`](../barkloader/sandbox.md#ctxresult) events | barkloader, on each announced event; the engine passes the chain with the invoke |
| A sub-workflow step | the engine, on the sub-workflow's trigger event |
| The run's own `workflow.run.*` lifecycle events | the engine |

An event nothing in a workflow caused — a platform event, a dashboard request, a
background task such as the timer expiry check — has no chain, and starts one.

**A run is refused when the chain behind it holds `MaxWorkflowChain` (8) runs.**
The refused run is recorded as failed, with an error naming the loop:
`stopped a workflow loop: Counter changed keeps triggering itself (Counter changed →
Counter changed), 8 runs deep`, or the whole chain when it does not close on the
refused workflow. See `workflow/internal/engine/loopguard.go`.

The rule is a length, not "this workflow is already in the chain". The dashboard
stores one workflow per event with a condition per instance, so "when counter A
changes, add to counter B" and "when counter B changes, say so in chat" are branches
of the same workflow, and that chain visits it twice on purpose. What every loop
does, and no chain that means to end does, is keep growing.

Nor is it a check on the workflow graph when a workflow is saved. Which events a
step causes is decided when it runs — a module function announces what it chooses,
a condition on the trigger decides whether an edge exists at all — so the graph a
save-time check could see is both missing edges and full of ones that never fire.
The chain is the path actually taken.

A repeating timer is not a loop: each `timer.ended` comes from the expiry check, a
background task, so every repetition starts a fresh chain.

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
