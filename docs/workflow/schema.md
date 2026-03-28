# Workflow Schema

Workflow definitions can be provided as JSON or YAML. This page documents every property in the schema.

## WorkflowDefinition

The root object of a workflow definition.

```json
{
  "id": "my-workflow",
  "name": "My Workflow",
  "description": "Optional description",
  "trigger": { ... },
  "tasks": [ ... ],
  "options": { ... }
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier for the workflow. Used for registration, lookups, and sub-workflow references. |
| `name` | `string` | Yes | Human-readable display name. |
| `description` | `string` | No | Optional description of what the workflow does. |
| `trigger` | [TriggerConfig](#triggerconfig) | Yes | Defines what event starts this workflow. |
| `tasks` | [TaskDefinition[]](#taskdefinition) | Yes | Ordered list of tasks to execute. Must contain at least one task. |
| `options` | [WorkflowOptions](#workflowoptions) | No | Global workflow settings like timeout and concurrency. |

---

## TriggerConfig

Defines the event that starts a workflow execution.

```json
{
  "type": "event",
  "eventType": "cheer.user.twitch",
  "conditions": [
    { "field": "${trigger.data.amount}", "operator": "gte", "value": 100 }
  ]
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `string` | Yes | Trigger type. Currently only `"event"` is supported. |
| `eventType` | `string` | Yes | The CloudEvents `type` field to match against incoming events. Uses dot notation (e.g., `cheer.user.twitch`). Must match a NATS subscription pattern. |
| `conditions` | [ConditionConfig[]](#conditionconfig) | No | Optional conditions that must be satisfied for the trigger to fire. All conditions are evaluated with AND logic. If omitted, any event matching `eventType` will trigger the workflow. |

---

## TaskDefinition

A single unit of work within a workflow. Tasks execute in dependency order determined by `dependsOn` relationships.

```json
{
  "id": "send-message",
  "type": "action",
  "dependsOn": ["check-amount"],
  "parameters": {
    "action": "function",
    "functionName": "sendChatMessage",
    "params": ["Thank you ${trigger.data.userName}!"]
  },
  "exports": {
    "messageId": "result.id"
  },
  "onError": "continue",
  "timeout": "30s"
}
```

### Core Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier within the workflow. Referenced by `dependsOn`, `onTrue`, and `onFalse` in other tasks. |
| `type` | `string` | Yes | Task type. One of: `action`, `log`, `wait`, `condition`, `workflow`. See [Task Types](./tasks.md). |
| `dependsOn` | `string[]` | No | List of task IDs that must complete before this task runs. The engine builds a directed acyclic graph from these relationships and executes tasks in topological order. |
| `parameters` | `map<string, any>` | Yes | Task-specific parameters. All string values support [expression resolution](#expression-syntax). The shape depends on the task `type`. |
| `exports` | `map<string, string>` | No | Extracts values from the task result and makes them available to downstream tasks. Keys are the export names, values are dot-notation paths into the task's result data. |
| `onError` | `string` | No | Error handling strategy. `"fail"` (default) stops the workflow. `"continue"` marks the task as failed but continues execution. |
| `timeout` | [Duration](#duration) | No | Maximum time the task is allowed to run before being considered failed. |

### Condition Properties

These properties control conditional execution. For non-`condition` type tasks, conditions act as **guards** -- the task is skipped if the condition evaluates to false. For `condition` type tasks, conditions control **branching** via `onTrue`/`onFalse`.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `condition` | [ConditionConfig](#conditionconfig) | No | Single condition (backward compatible). Evaluated before the task runs. |
| `conditions` | [ConditionConfig[]](#conditionconfig) | No | Multiple conditions. Combined using `conditionLogic`. |
| `conditionLogic` | `string` | No | How multiple conditions are combined. `"and"` (default) requires all conditions to be true. `"or"` requires at least one. |
| `onTrue` | `string[]` | No | Task IDs to execute when the condition is **true**. Only used with `type: "condition"`. Tasks listed in `onFalse` are skipped. |
| `onFalse` | `string[]` | No | Task IDs to execute when the condition is **false**. Only used with `type: "condition"`. Tasks listed in `onTrue` are skipped. |

### Special Type Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `wait` | [WaitConfig](#waitconfig) | No | Configuration for `wait` type tasks. Defines what event to wait for and optional aggregation. |
| `workflow` | [WorkflowConfig](#workflowconfig) | No | Configuration for `workflow` type tasks. Defines which sub-workflow to execute. |

---

## ConditionConfig

A single condition that compares a field value against an expected value using an operator.

```json
{
  "field": "${trigger.data.amount}",
  "operator": "gte",
  "value": 500
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `field` | `string` | Yes | The value to test. Supports [expression syntax](#expression-syntax) (e.g., `${trigger.data.amount}`). |
| `operator` | `string` | Yes | Comparison operator. See [Operators](#operators). |
| `value` | `any` | Yes | The expected value to compare against. Also supports expression syntax if it's a string. Type depends on the operator. |

### Operators

| Operator | Aliases | Description | Value Type |
|----------|---------|-------------|------------|
| `eq` | `==`, `equals` | Equal (numeric or string comparison) | `any` |
| `ne` | `!=`, `not_equals` | Not equal | `any` |
| `gt` | `>` | Greater than | `number` |
| `gte` | `>=` | Greater than or equal | `number` |
| `lt` | `<` | Less than | `number` |
| `lte` | `<=` | Less than or equal | `number` |
| `contains` | | String contains substring | `string` |
| `starts_with` | | String starts with prefix | `string` |
| `ends_with` | | String ends with suffix | `string` |
| `in` | | Value exists in array | `any[]` |
| `not_in` | | Value does not exist in array | `any[]` |
| `exists` | | Field is not null/undefined | _(ignored)_ |
| `not_exists` | | Field is null/undefined | _(ignored)_ |
| `regex` | `matches` | Value matches regex pattern | `string` (regex) |
| `between` | `range` | Value is within inclusive range | `[min, max]` |

Numeric comparisons use type coercion -- string representations of numbers are converted to floats before comparison. Non-numeric values fall back to string comparison.

---

## WaitConfig

Configuration for `wait` type tasks. Pauses workflow execution until a matching event arrives or a timeout expires.

```json
{
  "type": "aggregation",
  "eventType": "cheer.user.twitch",
  "conditions": [
    { "field": "${trigger.data.channelId}", "operator": "eq", "value": "${trigger.data.channelId}" }
  ],
  "aggregation": {
    "strategy": "sum",
    "field": "data.amount",
    "threshold": 1000,
    "timeWindow": "5m"
  },
  "timeout": "10m",
  "onTimeout": "continue"
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `string` | Yes | Wait type. `"event"` waits for a single matching event. `"aggregation"` collects multiple events and checks an aggregation threshold. |
| `eventType` | `string` | Yes | The CloudEvents type to listen for while waiting. |
| `conditions` | [ConditionConfig[]](#conditionconfig) | No | Conditions that incoming events must match to be counted. |
| `aggregation` | [AggregationConfig](#aggregationconfig) | No | Required when `type` is `"aggregation"`. Defines the aggregation strategy. |
| `timeout` | [Duration](#duration) | No | Maximum time to wait. If exceeded, behavior is determined by `onTimeout`. |
| `onTimeout` | `string` | No | What happens when the timeout expires. `"continue"` marks the task as successful and proceeds. `"fail"` (default) fails the task and the workflow. |

---

## AggregationConfig

Defines how multiple events are aggregated in a `wait` task.

```json
{
  "strategy": "sum",
  "field": "data.amount",
  "threshold": 1000,
  "timeWindow": "5m"
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `strategy` | `string` | Yes | Aggregation strategy. `"count"` counts events until threshold. `"sum"` sums a numeric field until threshold. `"threshold"` checks if a single event's field meets the threshold. |
| `field` | `string` | No | Dot-notation path to the numeric field to aggregate. Required for `"sum"` and `"threshold"` strategies. |
| `threshold` | `number` | Yes | Target value. The wait is satisfied when the aggregated value reaches or exceeds this. |
| `timeWindow` | [Duration](#duration) | No | Rolling time window for aggregation. Events outside this window are not counted. |

---

## WorkflowConfig

Configuration for `workflow` type tasks. Executes another workflow as a sub-workflow.

```json
{
  "workflowId": "reward-sub-workflow",
  "waitUntilCompletion": true,
  "eventType": "custom.trigger.type",
  "eventData": {
    "userId": "${trigger.data.userId}",
    "amount": "${trigger.data.amount}"
  },
  "timeout": "2m"
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `workflowId` | `string` | Yes | ID of the workflow to execute. Must be registered in the engine. Supports expression syntax. |
| `waitUntilCompletion` | `boolean` | No | If `true`, the parent workflow pauses until the sub-workflow completes. If `false` (default), the sub-workflow is fire-and-forget. |
| `eventType` | `string` | No | CloudEvents type for the trigger event sent to the sub-workflow. If omitted, uses the sub-workflow's own trigger event type. Falls back to `"workflow.trigger"`. |
| `eventData` | `map<string, any>` | No | Data payload for the sub-workflow's trigger event. Supports expression syntax for passing data from the parent workflow. |
| `timeout` | [Duration](#duration) | No | Timeout when waiting for sub-workflow completion. Defaults to 5 minutes. Only relevant when `waitUntilCompletion` is `true`. |

---

## WorkflowOptions

Global settings for the workflow.

```json
{
  "timeout": "30m",
  "maxConcurrent": 5
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `timeout` | [Duration](#duration) | No | Maximum time the entire workflow is allowed to run. |
| `maxConcurrent` | `integer` | No | Maximum number of tasks that can execute concurrently. |

---

## Duration

Durations can be specified as either a Go duration string or a numeric value (nanoseconds).

**String format** (recommended):

| Unit | Suffix | Example |
|------|--------|---------|
| Nanoseconds | `ns` | `"500ns"` |
| Microseconds | `us` | `"100us"` |
| Milliseconds | `ms` | `"500ms"` |
| Seconds | `s` | `"30s"` |
| Minutes | `m` | `"5m"` |
| Hours | `h` | `"2h"` |

Combinations are supported: `"1h30m"`, `"5m30s"`.

**Numeric format**: Raw nanosecond count as a JSON number (e.g., `5000000000` for 5 seconds).

---

## Expression Syntax

All string values in task parameters, conditions, and workflow configs support template expressions using `${...}` syntax.

### Sources

| Source | Description | Example |
|--------|-------------|---------|
| `trigger` | The event that triggered the workflow | `${trigger.data.amount}`, `${trigger.type}`, `${trigger.id}` |
| `<taskId>` | Exported values from a completed task | `${check-amount.result}`, `${fetch-user.name}` |
| `env` | Environment variables | `${env.API_KEY}` |

### Path Navigation

Expressions support dot notation and array indexing:

```
${trigger.data.user.name}        // nested object access
${trigger.data.items[0]}         // array index
${trigger.data.items[0].name}    // combined
```

### Full vs Partial Expressions

- **Full expression**: `"${trigger.data.amount}"` -- resolves to the original type (number, object, etc.)
- **Partial expression**: `"User ${trigger.data.userName} cheered ${trigger.data.amount} bits"` -- always resolves to a string with interpolated values

### Trigger Event Fields

The `trigger` source exposes the full CloudEvents structure:

| Path | Type | Description |
|------|------|-------------|
| `trigger.id` | `string` | Event UUID |
| `trigger.type` | `string` | Event type (e.g., `cheer.user.twitch`) |
| `trigger.source` | `string` | Event source (e.g., `twitch`) |
| `trigger.time` | `time` | Event timestamp |
| `trigger.data` | `object` | Event-specific payload |
| `trigger.data.*` | `any` | Fields within the payload (varies by event type) |
