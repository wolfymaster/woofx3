# Task Types

Tasks are the units of execution within a workflow. Each task has a `type` that determines its behavior and the shape of its `parameters`.

> **Strings inside `parameters` carry `${…}` expressions resolved by the engine before the task runs.** The grammar is path-only — no operators, no ternary. See [Expressions](./expressions.md) for what's in scope and where to use the streamware-side `{…}` syntax instead.

## Disabling a task

Any task can carry `"disabled": true`. It stays in the workflow, keeps its place in the dependency graph, and is recorded in the run history, but does no work. Nothing it would read is evaluated, so a disabled task cannot fail the run.

What "does no work" means depends on the type:

| Type | When disabled |
|------|---------------|
| `condition` | Resolves as **false**, exactly as if its conditions had failed: the task succeeds, exports `result: false`, its `onTrue` tasks are skipped and its `onFalse` tasks run. A guard reading `${id.result}` sees `false`. The recorded step is indistinguishable from a condition that evaluated false, so a resumed run re-derives the same branch. |
| any other type | Skipped, with the same status and history record as a task whose guard evaluated false. Its guard is not evaluated and it exports nothing. |

```json
{
  "id": "on-cheer",
  "type": "condition",
  "disabled": true,
  "condition": { "field": "${trigger.data.bits}", "operator": "gte", "value": 100 },
  "onTrue": ["play-alert"]
}
```

This is how a single trigger inside a workflow is switched off: the trigger's `condition` task is disabled, so the event still starts the run but that trigger's branch never fires.

A skip does not propagate. A task that `dependsOn` a disabled task still runs, and finds no exports from it; a task listed in a disabled condition's `onTrue` is skipped because the condition resolved false, not because of the dependency.

## action

Executes a registered action. Actions are the primary way workflows interact with external systems.

The registered action name goes in the task's top-level **`action`** field. Handler-specific inputs go in `parameters`. This separation mirrors the `wait`/`workflow`/`condition` types, which keep dispatch config at the top level and `parameters` reserved for runtime inputs.

### Built-in Actions

#### `print`

Logs the parameters for debugging.

```json
{
  "id": "debug-log",
  "type": "action",
  "action": "print",
  "parameters": {
    "message": "Received ${trigger.data.amount} bits from ${trigger.data.userName}"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"print"`. Set at the task top level, not in `parameters`. |
| `parameters.message` | `string` | No | Message to log. Supports expressions. |

Returns all parameters as-is.

#### `chat.reply`

Sends one message to chat, by publishing `message.send` — the same event the
sandbox's chat extension publishes, consumed by woofwoofwoof, which holds the
chat client.

```json
{
  "id": "say-thanks",
  "type": "action",
  "action": "chat.reply",
  "parameters": {
    "message": "thanks for the ${trigger.data.amount} bits, ${trigger.data.userName}!"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"chat.reply"`. Set at the task top level. |
| `parameters.message` | `string` | Yes | What to say. Supports expressions. |
| `parameters.platform` | `string` | No | Where to say it. Defaults to `"twitch"`. |

Native rather than a module function, so replying in chat needs no module
installed. This is what a chat command's reply is made of — see
[Chat commands](../services/commands-ui.md).

#### `function`

Invokes a function registered in the Barkloader module system.

```json
{
  "id": "send-chat",
  "type": "action",
  "action": "function",
  "parameters": {
    "functionName": "sendChatMessage",
    "params": ["Hello ${trigger.data.userName}!"]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"function"`. Set at the task top level. |
| `parameters.functionName` | `string` | Yes | Name of the Barkloader function to invoke. |
| `parameters.params` | `any[]` | No | Arguments to pass to the function. Each element supports expressions. |

Returns the function's result as a map.

#### `alert`

Plays an on-stream alert. The step publishes an envelope onto NATS `ui.notify.alert`; the scene manager validates the layout and delivers it to every alert widget named `target` on a running scene. An alert widget plays one alert at a time, so alerts to the same name queue behind each other. See [Alerts](../services/widget-events.md#alerts) for how a scene plays one.

```json
{
  "id": "follower-alert",
  "type": "action",
  "action": "alert",
  "parameters": {
    "target": "default",
    "layout": {
      "width": 1920,
      "height": 1080,
      "widgets": [
        {
          "id": "message",
          "widgetCanonicalId": "woofx3:widget:text",
          "position": { "x": 360, "y": 780 },
          "size": { "width": 1200, "height": 160 },
          "settings": { "text": "{primary}${trigger.data.userName}{primary} just followed!", "duration": 6 }
        },
        {
          "id": "sound",
          "widgetCanonicalId": "woofx3:widget:audio",
          "position": { "x": 0, "y": 0 },
          "size": { "width": 1, "height": 1 },
          "settings": { "src": "${asset:pleasure}" }
        }
      ]
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"alert"`. Set at the task top level. |
| `parameters.target` | `string` | No | Name of the alert widgets to play on. Defaults to `"default"`, the name a scene's first alert widget gets. |
| `parameters.layout` | `object` | Yes | The alert: a canvas `width` × `height` and the `widgets` placed on it. The alert widget scales the canvas to fit its area. |
| `parameters.layout.widgets[]` | `object` | Yes | `id` (letters, digits, `-` or `_`, unique in the layout), the `widgetCanonicalId` of a widget whose `surfaces` include `"alert"`, `position`, `size` and `settings`. A widget that fails these rules is dropped with a warning. |
| `parameters.id` | `string` | No | Pin the envelope id (useful for tests / replays). When omitted, the action stamps a UUID — see below. |

`${…}` expressions anywhere in the layout, widget settings included, are resolved before the envelope is published, so layout widgets receive final values.

An alert lasts as long as its longest widget. A widget with a length of its own (a sound, a video, anything with a duration set) holds the alert until it finishes; one without (a Text or Image with no duration) stays up for the rest of the alert. An alert with no timed widget stays up for 5 seconds.

The action stamps a stable `id` onto every envelope at publish time (see `workflow/actions.go` `buildAlertEnvelope`). All three downstream layers — the api alert log, the streamware queue, and the overlay's lifecycle reports — key on this value end-to-end. A caller-supplied `parameters.id` overrides the generated UUID; this is useful for replays and deterministic tests.

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `published` | `boolean` | Always `true` on success |

#### `publish_event`

Publishes an event to the NATS message bus.

```json
{
  "id": "notify",
  "type": "action",
  "action": "publish_event",
  "parameters": {
    "eventType": "badge.awarded",
    "source": "workflow",
    "data": {
      "userId": "${trigger.data.userId}",
      "reward": "special-badge"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"publish_event"`. Set at the task top level. |
| `parameters.eventType` | `string` | Yes | CloudEvents type for the published event, and the NATS subject it is published on. May not be reserved (below), or contain a wildcard (`*`, `>`), whitespace or a control character. |
| `parameters.source` | `string` | No | CloudEvents source field. Defaults to `"workflow"`. |
| `parameters.data` | `object` | No | Event payload. Supports expressions. |

The event type is the subject the event goes out on, so a workflow could otherwise command the engine or forge the events it acts on (see [Engine integrity](../services/engine-integrity.md)). The engine refuses a reserved `eventType`:

- when the workflow is saved (api) or registered (engine), if `eventType` is written out;
- when the step runs, once an `eventType` built from an expression has resolved.

Reserved names, defined in `shared/common/golang/cloudevents/reserved.go`. An entry ending in `.` reserves that whole namespace; any other entry reserves exactly that name.

- **Commands** (also refused as events declared by an uploaded module): `webhook.`, `db.`, `engine.`, `slobs`, `twitchapi`, `message.send`, `ui.notify.`, `ui.alert.`, `widget.queue.`, `workflow.execute`, `workflow.replay`, `workflow.cancel`, `action.execute`.
- **Engine events**: `HEARTBEAT`, `MESSAGEBUS_INIT`, `barkloader.`, `channel.`, `channelpoints.`, `chat.command.`, `module.`, `reward`, `session.`, `setting.`, `stream.offline`, `stream.online`, `user.message`, `widget.event`, `workflow.health.`, `workflow.run.`.

Pick an event name of the workflow's own, such as `badge.awarded`. To test a workflow against a platform event (`channel.*`, `stream.online`, ...), fire it with the api's `simulateTwitchEvent` rather than publishing it.

A workflow refused when it is saved or loaded is not registered, and a refused update unregisters the version it would have replaced: the db holds the refused definition, so the engine does not keep running the old one.

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

Pauses workflow execution until a matching event arrives or a timeout expires, or for a fixed time. Supports single-event, aggregation and delay modes.

### Single Event Wait

Waits for one matching event:

```json
{
  "id": "wait-for-follow",
  "type": "wait",
  "wait": {
    "type": "event",
    "event": "channel.follow",
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
    "event": "channel.cheer",
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

### Delay

Pauses for a fixed time, then continues. "On raid, wait 10 seconds, then shout out" is a delay between the trigger and the shoutout:

```json
{
  "id": "settle",
  "type": "wait",
  "wait": {
    "type": "delay",
    "durationMs": 10000
  }
}
```

`durationMs` is required and must be a whole number from `1` to `86400000` (24 hours). A delay takes no `event`, `conditions`, `aggregation`, `timeout` or `onTimeout`; a workflow that sets any of them on a delay is refused when it is saved, as is one whose `durationMs` is out of range. A delay always succeeds, and events arriving while it runs do not end it early.

### Timeouts

An event or aggregation wait without a `timeout` waits for its event however long that takes; a run started by `stream.online` can wait for `stream.offline`.

With a `timeout`, the wait ends when it passes even if no event ever arrives: the engine arms a timer when the run pauses and cancels it when the wait is satisfied. What happens next follows `onTimeout`: `"fail"` (the default) fails the task and the run; `"continue"` marks the task successful with `timedOut: true` and runs the next task. If an event and the timeout land at the same moment, exactly one of them settles the wait.

`timeout` is a duration string such as `"30s"`, `"2m"` or `"1h30m"`, at least one second. A number is refused: it would be read as nanoseconds.

A `timeout` was accepted but not enforced by engines before this behaviour was introduced, so a workflow saved then that names one will now time out where it used to keep waiting.

A wait's own guard `condition`, if it has one, is evaluated again when the run resumes at the wait.

Paused waits and delays live in the engine's memory. A run paused when the engine stops is not resumed when it starts again.

### Aggregation Strategies

| Strategy | Description | `field` Required |
|----------|-------------|------------------|
| `count` | Counts matching events until `threshold` is reached | No |
| `sum` | Sums the numeric value at `field` across events until `threshold` | Yes |
| `threshold` | Satisfied when a single event's `field` value meets `threshold` | Yes |

`field` is a dot path rooted at the event, as in `data.amount`. With no `field` set,
`sum` and `threshold` read `data.amount` and then `data.value`; an event carrying
neither fails the wait rather than contributing a default, so a `sum` that cannot
find its number is reported instead of quietly behaving like a `count`.

Wait tasks export aggregation results for downstream tasks:

| Export | Type | Description |
|--------|------|-------------|
| `satisfied` | `boolean` | Whether the wait's event (or aggregation threshold) arrived. `true` for a delay that ran its course |
| `timedOut` | `boolean` | Whether the wait ended at its timeout |
| `count` | `number` | Events counted (aggregation waits) |
| `sum` | `number` | Running sum (aggregation waits) |
| `events` | `Event[]` | All received events |
| `lastEvent` | `Event` | The most recent received event, when there is one |
| `data` | `object` | `lastEvent`'s data, when there is one |

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
