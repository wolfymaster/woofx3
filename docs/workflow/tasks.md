# Task Types

Tasks are the units of execution within a workflow. Each task has a `type` that determines its behavior and the shape of its `parameters`.

## action

Executes a registered action. Actions are the primary way workflows interact with external systems.

### Built-in Actions

#### `print`

Logs the parameters for debugging.

```json
{
  "id": "debug-log",
  "type": "action",
  "parameters": {
    "action": "print",
    "message": "Received ${trigger.data.amount} bits from ${trigger.data.userName}"
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"print"`. |
| `message` | `string` | No | Message to log. Supports expressions. |

Returns all parameters as-is.

#### `function`

Invokes a function registered in the Barkloader module system.

```json
{
  "id": "send-chat",
  "type": "action",
  "parameters": {
    "action": "function",
    "functionName": "sendChatMessage",
    "params": ["Hello ${trigger.data.userName}!"]
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"function"`. |
| `functionName` | `string` | Yes | Name of the Barkloader function to invoke. |
| `params` | `any[]` | No | Arguments to pass to the function. Each element supports expressions. |

Returns the function's result as a map.

#### `publish_event`

Publishes an event to the NATS message bus.

```json
{
  "id": "notify",
  "type": "action",
  "parameters": {
    "action": "publish_event",
    "eventType": "reward.granted",
    "source": "workflow",
    "data": {
      "userId": "${trigger.data.userId}",
      "reward": "special-badge"
    }
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"publish_event"`. |
| `eventType` | `string` | Yes | CloudEvents type for the published event. Also used as the NATS subject unless `subject` is set on the event. |
| `source` | `string` | No | CloudEvents source field. Defaults to `"workflow"`. |
| `data` | `object` | No | Event payload. Supports expressions. |

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `eventId` | `string` | UUID of the published event |
| `eventType` | `string` | The event type |
| `published` | `boolean` | Always `true` on success |

---

## log

Logs a message. Useful for debugging and tracing workflow execution.

```json
{
  "id": "trace",
  "type": "log",
  "parameters": {
    "message": "Processing cheer of ${trigger.data.amount} from ${trigger.data.userName}"
  }
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | `string` | Yes | Message to log. Supports expressions. |

---

## condition

Evaluates conditions and controls branching. Unlike conditions on other task types (which act as guards that skip the task), `condition` tasks determine which downstream tasks to execute or skip.

```json
{
  "id": "check-vip",
  "type": "condition",
  "conditions": [
    { "field": "${trigger.data.amount}", "operator": "gte", "value": 500 },
    { "field": "${trigger.data.isSubscriber}", "operator": "eq", "value": true }
  ],
  "conditionLogic": "or",
  "onTrue": ["send-vip-reward"],
  "onFalse": ["send-standard-reward"]
}
```

When the condition evaluates to `true`, tasks listed in `onFalse` are skipped. When `false`, tasks in `onTrue` are skipped. Both branches can contain multiple task IDs.

The condition task itself always succeeds (unless evaluation throws an error). It exports:

| Export | Type | Description |
|--------|------|-------------|
| `result` | `boolean` | The evaluation result |

---

## wait

Pauses workflow execution until a matching event arrives or a timeout expires. Supports both single-event and aggregation modes.

### Single Event Wait

Waits for one matching event:

```json
{
  "id": "wait-for-follow",
  "type": "wait",
  "wait": {
    "type": "event",
    "eventType": "follow.user.twitch",
    "conditions": [
      { "field": "${trigger.data.userId}", "operator": "eq", "value": "${trigger.data.userId}" }
    ],
    "timeout": "5m",
    "onTimeout": "continue"
  }
}
```

### Aggregation Wait

Collects multiple events and checks a threshold:

```json
{
  "id": "wait-for-bits",
  "type": "wait",
  "wait": {
    "type": "aggregation",
    "eventType": "cheer.user.twitch",
    "aggregation": {
      "strategy": "sum",
      "field": "data.amount",
      "threshold": 1000,
      "timeWindow": "10m"
    },
    "timeout": "30m",
    "onTimeout": "fail"
  }
}
```

### Aggregation Strategies

| Strategy | Description | `field` Required |
|----------|-------------|------------------|
| `count` | Counts matching events until `threshold` is reached | No |
| `sum` | Sums the numeric value at `field` across events until `threshold` | Yes |
| `threshold` | Satisfied when a single event's `field` value meets `threshold` | Yes |

Wait tasks export aggregation results for downstream tasks:

| Export | Type | Description |
|--------|------|-------------|
| `eventCount` | `number` | Total events received |
| `sum` | `number` | Running sum (for sum strategy) |
| `events` | `Event[]` | All received events |

---

## workflow

Executes another registered workflow as a sub-workflow. The parent can optionally wait for the sub-workflow to complete.

```json
{
  "id": "run-reward",
  "type": "workflow",
  "workflow": {
    "workflowId": "grant-reward",
    "waitUntilCompletion": true,
    "eventData": {
      "userId": "${trigger.data.userId}"
    },
    "timeout": "2m"
  }
}
```

The `workflow` config can alternatively be specified entirely through `parameters`:

```json
{
  "id": "run-reward",
  "type": "workflow",
  "parameters": {
    "workflowId": "grant-reward",
    "waitUntilCompletion": true,
    "eventData": {
      "userId": "${trigger.data.userId}"
    }
  }
}
```

When `waitUntilCompletion` is `true`, the task exports sub-workflow results:

| Export | Type | Description |
|--------|------|-------------|
| `executionId` | `string` | Sub-workflow execution UUID |
| `completed` | `boolean` | Whether the sub-workflow finished |
| `result` | `object` | Sub-workflow variables (when completed) |
| `variables` | `object` | Alias for `result` |

When `waitUntilCompletion` is `false`, only `executionId` and `completed: false` are exported.
