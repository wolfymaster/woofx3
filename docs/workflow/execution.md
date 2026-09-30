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
| `cancelled` | Stopped by a cancel request (see [Cancelling a Run](#cancelling-a-run)) |

`completed`, `failed` and `cancelled` are terminal. A run settles exactly once,
and db-proxy refuses to move a recorded run out of a terminal status, so a late
report cannot turn a cancelled run back into a completed one.

### Task Execution

| Status | Description |
|--------|-------------|
| `pending` | Task has not started |
| `running` | Task is currently executing |
| `waiting` | Task is waiting for an external event |
| `success` | Task completed successfully |
| `failed` | Task execution failed |
| `skipped` | Task was skipped (guard condition false or branch not taken) |
| `cancelled` | The run was cancelled while this task was pending or in flight |

## Pausing and Resuming

### Wait Tasks

When a `wait` task is encountered:

1. A `WaitState` is initialized with the event type, conditions, and deadline (the timeout, the delay's `durationMs`, or none for an event wait without a timeout)
2. The wait is armed: recorded as unsettled, indexed in `waitingExecutions` by event type (delays are not indexed), and given a `time.AfterFunc` timer for its deadline when it has one. After `Stop`, nothing is armed: the run fails with "engine stopped" instead of pausing
3. The workflow pauses (returns from execution loop)

When a matching event arrives:

1. `processWaitingExecutions` checks all waiting executions for that event type
2. If the wait condition is satisfied (event match + aggregation threshold), the wait is claimed and its timer stopped, and the run resumes
3. If not satisfied, the execution remains in the waiting list

When the timer fires first, it claims the wait instead: a delay is marked satisfied, any other wait is marked timed out, and the run resumes.

Claiming happens under one lock, so an event and a timer racing for the same wait settle it exactly once. A resumed run re-enters the wait task, which applies the outcome -- exports on success, `onTimeout` on a timeout -- and continues with the branches its earlier conditions skipped still skipped. Because the run re-enters the wait task, the wait's own guard `condition` is evaluated again on resume.

An event the wait cannot process (for example a non-numeric value for a `sum`) is logged and skipped; the wait keeps listening.

Waits are held in memory only, and nothing is persisted to re-arm on the next start, so a paused run cannot continue after a restart. `Stop` fails every paused run with "engine stopped" rather than leaving it recorded as running (see [Stopping the Engine](#stopping-the-engine)).

### Sub-Workflows

When a `workflow` task with `waitUntilCompletion: true` is encountered:

1. The sub-workflow is started asynchronously
2. A `SubWorkflowWaiter` is registered keyed by the sub-execution ID
3. The parent workflow pauses

When the sub-workflow completes:

1. `checkSubWorkflowCompletion` finds all parent workflows waiting for it
2. Sub-workflow results are copied to the parent task's exports
3. Parent workflows resume from the next task

## Manual Runs and Sample Trigger Data

`workflow.execute` runs one named workflow on request. Without sample data the
run starts from the request event itself, so `${trigger.data}` is the request's
`{ workflowId, inputs, startedBy }` and trigger conditions are not consulted.

With `triggerData` in the request's data, the engine instead builds the event a
real trigger would deliver: its type is the workflow's own trigger event (for
example `channel.raid`), its data is the sample, its `platform` is the request's
`platform`, and its correlation attributes (`triggerId`, `triggeredBy`) are the
request's. `${trigger.data...}` then resolves exactly as it would for a real
event, and the recorded run stores this event, so a replay repeats the sample.

Unlike publishing a simulated event, only the named workflow runs. Every other
workflow listening for the same event, and its side effects, stays untouched.

The workflow's trigger conditions are evaluated against the sample first.
Every condition is evaluated, not just the first false one, and a sample that
fails any of them starts no run: the reply is `conditions_not_met` with each
unmet condition. `skipConditions: true` runs the workflow anyway. The sample
is at most 16 KiB as JSON.

The subject is subscribed with a reply handler. A caller that publishes gets no
answer, as before; one that sends a request is told the outcome:

```json
{ "outcome": "started", "executionId": "9b1c...", "eventType": "channel.raid" }
{ "outcome": "conditions_not_met", "eventType": "channel.raid",
  "unmet": [{ "field": "${trigger.data.viewers}", "operator": "gte", "value": 10 }] }
{ "outcome": "refused", "error": "workflow not found: wf-1" }
```

## Dry Runs

A manual run with `dryRun: true` runs the workflow without its side effects.
The engine decides what that means. A module never does, and module code is
never told about a dry run.

- **Actions.** Each action is registered with an `ActionSpec`:
  - `SideEffect: true` marks an action that changes something outside the run.
    In a dry run the engine does not call it. Its step succeeds with
    `{ "dryRun": true, "wouldDo": "<sentence>" }` as its output.
  - The optional `DryRun(params)` hook writes that sentence, for example
    `would send "welcome raiders" to twitch chat`. The default is
    `would run <action> with <params>`. The hook may refuse parameters the real
    action would refuse, as `alert` does for a broken layout, so a dry run fails
    where the real run would.
  - An action registered without a spec counts as side-effecting. A new
    native action is therefore skipped by dry runs until it declares itself
    safe.
  - `function` actions run module code and are always skipped: `would call
    module function <id>`. The same goes for `alert`, `chat.reply` and
    `publish_event`. `print` and the `log` task run normally.
- **Waits** complete at once, recording what they would have waited for
  (`would wait for a channel.follow event for up to 2m0s`, or `would wait 10s`
  for a delay). Their exports read `satisfied: true`, `timedOut: false`, with
  no events.
- **Sub-workflows** started by a dry run are dry runs too.
- **Workflows triggered by a dry run.** A dry run's `workflow.run.*`
  lifecycle events carry the CloudEvents extension attribute `dryRun: true`,
  and any workflow such an event triggers starts as a dry run too. A workflow
  that reacts to "workflow A completed" therefore previews its reaction
  instead of posting in chat for real. A stamped event also never resumes a
  real run's wait. The attribute only ever removes side effects, so the
  engine honours it from any producer.
- **Recording.** The run is recorded with `dry_run = true`
  (`WorkflowRunSnapshot.dryRun` on the `workflow.run.recorded`/`updated`
  webhooks). The api records a dry run as origin `test` unless the caller
  names one.
- **Replays stay dry, by design.** Replaying a dry run makes another dry run,
  because replaying a preview should never be how its side effects first
  happen. To run the workflow for real, trigger it normally.

A later step that reads a skipped action's real output (`${say.messageId}`)
has nothing to read, and fails to resolve. The error names the step.

## Cancelling a Run

`workflow.cancel` is a request/reply subject carrying
`{ "executionId": "...", "reason": "..." }`. Each run has its own context, and
cancelling it:

- **Abandons the task in flight.** The engine stops waiting for it at once. The
  task's context (`ActionContext.Context`) is done, so an action that honours it
  can stop early. An action that already sent its request to a service is not
  undone: whatever it did stands. The task is recorded `cancelled`, and no later
  task starts.
- **Claims a pending wait.** A run paused at a `wait` task, or waiting on a
  sub-workflow, is removed from the waiting set under the same lock an arriving
  event and the wait's timer use. Whichever gets there first owns the resume,
  so a cancelled wait never resumes. This includes a `delay` and a wait with a
  `timeout`: the timer is stopped, and the run settles at once rather than when
  the timer would have fired. A run cancelled just before it reaches a wait
  refuses to pause there. A sub-workflow the run was waiting on is cancelled too. A
  sub-workflow started without `waitUntilCompletion` (fire-and-forget) is
  independent of its parent. It keeps running when the parent is cancelled;
  cancel it by its own execution id.
- **Settles the run `cancelled`** through the same path as every other outcome.
  The run recorder writes the status to db-proxy, whose `db.workflow_execution.updated`
  outbox event reaches the dashboard as the `workflow.run.updated` webhook. The
  engine also publishes `workflow.run.cancelled`, which the api relays to a
  caller watching the run's `triggerId`. The run's error is `cancelled: <reason>`.

Once a cancel is accepted, the run ends `cancelled` even if its last task
finishes in the meantime. The caller has already been told it stopped.

The reply is `{ "outcome": "cancelled", "status": "cancelled" }`. The same
answer comes back for a run that is already cancelled, so the request is
idempotent. A run that completed or failed first gets
`{ "outcome": "already_finished", "status": "completed" }` and is unchanged. An
id this engine does not know gets `{ "outcome": "not_found" }`. That covers a
run that was in flight when the engine restarted, which nothing will ever
finish. The api then settles that run's history row as `cancelled` itself.

`Engine.Stop` is not a cancel. Runs in flight are not recorded as cancelled
when the engine shuts down.

## Stopping the Engine

A run's state lives only in the workflow process, so a run that has not finished
when the process exits cannot be continued by the next one. `Engine.Stop` makes
sure no run is left without a recorded outcome:

1. Nothing new starts. `HandleEvent` and `FireByWorkflowID` refuse with
   "engine stopped".
2. A run paused at a wait is abandoned at once: nothing resumes a wait in a
   stopped engine.
3. A run executing tasks gets 5 seconds (`DefaultStopDrainTimeout`) to finish on
   its own. One that does keeps the outcome it reached.
4. Whatever is still running is abandoned. Its task in flight is given up on,
   not undone, as for a cancelled run, and no later step starts.
5. `Stop` waits up to 2 seconds (`DefaultStopSettleTimeout`) for the abandoned
   runs to unwind and for their outcomes to be recorded, then returns.

An abandoned run settles as `failed` with the error `engine stopped`, and the
step it was on is recorded as `cancelled` with the same error. A parent waiting
on a sub-workflow and the sub-workflow are each abandoned in their own right. A
run somebody cancelled stays `cancelled`.

Because the run is recorded as failed, it can be resumed from its last recorded
step once the engine is back. Nothing resumes it automatically.

A process that is killed rather than stopped records nothing, and its runs stay
`running` in the history until someone cancels them (see
[Cancelling a Run](#cancelling-a-run)).

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

A repeating timer is not a loop: each `timer.ended` comes from the timer's deadline
firing, not from the workflow that started it, so every repetition starts a fresh chain.

## Workflow CRUD Events

The service listens for CloudEvents on the workflow change subject. When a workflow is created, updated, or deleted in the database:

1. The `WorkflowManager` receives the event
2. For create/update: fetches the full workflow from the DB proxy and registers it in the engine
3. For delete: unregisters the workflow from the engine

This allows workflows to be managed via the database without restarting the service.

A periodic reconciler (every 5 minutes) lists enabled workflows from the DB proxy and
loads any the engine is missing, which covers lifecycle events the service never received.

## Workflow Health

The engine can refuse a stored workflow: its JSON may not parse, registration may reject
it, or its trigger may not register (an invalid cron expression, an event trigger with no
event, an unsupported trigger type, a subject the bus will not subscribe to). A refused
workflow still appears in the workflow list, but it does not fire as saved. The
`WorkflowHealthTracker` in `workflow/health.go` records the outcome of every load so the
creator can see why.

Every path that loads a stored workflow records its outcome: the start-up load, the
create/update lifecycle event, and the reconciler.

| Outcome | Health | In the registry? |
|---------|--------|------------------|
| Loaded | `{ status: "ok" }` | yes |
| Unreadable JSON, or refused by registration validation | `{ status: "error", reason }` | no (a refused update leaves the previous version) |
| Trigger could not be registered | `{ status: "error", reason }` | yes: it can be run manually by id, but never fires on its own |
| Disabled or deleted (including ones the reconciler finds gone) | entry removed | no |

`reason` is the engine's error verbatim; trigger refusals use the registrar's own wording,
for example `schedule "* * *" is not a valid cron expression: ...`. Each entry carries
`since`, when its current status and reason began.

**Retries.** Every reconcile pass (every 5 minutes) retries every enabled workflow in
error. A workflow refused before it was stored is absent from the registry, so it is
re-added. One stored with a refused trigger is registered again, because a trigger can
fail for a passing reason, such as the bus refusing a subscribe while it restarts. The
tracker logs and publishes only when the status or reason differs from what it last
recorded, so a workflow that stays broken produces one `workflow not running` log line
and one event, not one per pass. A new reason for the same workflow counts as a change.

**Ordering.** The start-up load, each lifecycle event, and each reconcile pass run one at
a time (`WorkflowManager.loadMu`), each from its own read of the database. A reconcile
pass that listed workflows just before a save therefore cannot apply that stale row over
the lifecycle event for the save: whichever runs second read the database second.

**Published events.** See [CloudEvents](../services/cloudevents.md#workflow-health).

- `workflow.health.snapshot`, once, when the first complete load finishes (the start-up
  load, or the first successful reconcile pass if that load failed). It lists every
  workflow in error and is authoritative: a client replaces its whole view with it, and
  any workflow not listed is ok. Nothing is published per workflow before it, so a start
  with many workflows sends one message, not one per workflow.
- `workflow.health.changed` for each change after that: a new error, a changed reason, a
  recovery, or an errored workflow being disabled or deleted (published as `"ok"`). A
  workflow that loads fine and never had an error sends nothing.

**Querying.** The service answers `workflow.health.get` with every tracked entry and a
`loaded` flag, false until the first complete load. The api serves it as the
`getWorkflowHealth()` RPC (rejecting until `loaded`), asking the workflow service each
time rather than caching events. The api also resends it as a snapshot webhook when the
api starts and whenever its bus connection comes back, so errors that cleared while it
was down or disconnected do not linger in a client.

Save-time validation in the api (`assertValidWorkflowDefinition`) refuses what the api can
check on its own and returns every reason in the error. Refusals that need the engine's
knowledge, such as an action no installed module provides, arrive as workflow health once
the engine tries to load the saved workflow.

## Error Handling

Each task can specify `onError`:

- `"fail"` (default): The task failure propagates to the workflow. The workflow is marked as failed and no further tasks execute.
- `"continue"`: The task is marked as failed but execution continues with the next task.

Condition evaluation errors always fail the workflow regardless of `onError`.

Wait task timeouts follow `onTimeout`:

- `"fail"` (default): The workflow fails.
- `"continue"`: The wait task is marked as successful, exports `timedOut: true`, and execution continues.

## Concurrency

- Each workflow execution runs in its own goroutine
- Multiple workflows can be triggered by the same event simultaneously
- Wait task resumptions run on new goroutines (the event handler's, or the wait's timer)
- Internal state is protected by `sync.RWMutex` on executions, waiting executions, and sub-workflow waiters
