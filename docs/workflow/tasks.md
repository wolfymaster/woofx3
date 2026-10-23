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

A skip does not propagate through `dependsOn`. A task that `dependsOn` a disabled task still runs, and finds no exports from it; a task listed in a disabled condition's `onTrue` is skipped because the condition resolved false, not because of the dependency. Only a branch not taken skips what is under it, nested conditions' branches included (see [condition](#condition)).

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

Sends one message to chat by publishing `message.send`, consumed by
woofwoofwoof, which holds the chat client. This is how module functions reply:
they return `ctx.success(message)` and a `chat.reply` step posts it.

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
          "settings": { "text": "${trigger.data.userName} just followed!", "duration": 6 }
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
| `parameters.layout` | `object` | Yes | The alert, as a composition: `layout` (the canvas, `width` × `height`, which the alert widget scales to fit its area), `widgets` keyed by id (placements: `widget` canonical id, `x`, `y`, `width`, `height`, `rotation`, `opacity`, `visible`, `z`, `settings`, ...) and `behaviors` keyed by id (transitions and effects). Each entry must pass the engine's strict registry; each widget must name a widget whose `surfaces` include `"alert"` under an id of letters, digits, `-` or `_`. A widget or behavior that fails is dropped with a warning, a widget taking its behaviors with it. A widget with `visible: false` does not play. |
| `parameters.layout` (list shape) | `object` | — | Still accepted: a canvas `width` × `height` and `widgets[]`, each with `id`, `widgetCanonicalId`, `position`, `size` and `settings`, and optionally the `name`, `visible`, `rotation`, `opacity`, `locked` and `zIndex` the dashboard writes. It is converted to a composition with no behaviors: entries stack by `zIndex` when every entry has one, else in list order; a placement field that is missing or out of range takes the placement default; any other entry field is kept in the placement's `extra`. |
| `parameters.id` | `string` | No | Pin the envelope id (useful for tests / replays). When omitted, the action stamps a UUID — see below. |

`${…}` expressions anywhere in the layout, widget settings included, are resolved before the envelope is published, so layout widgets receive final values.

An alert lasts as long as its longest widget. A widget with a length of its own (a sound, a video, anything with a duration set) holds the alert until it finishes; one without (a Text or Image with no duration) stays up for the rest of the alert. An alert with no timed widget stays up for 5 seconds.

The action stamps a stable `id` onto every envelope at publish time (see `workflow/actions.go` `buildAlertEnvelope`), and records the alert in the alert log before it publishes. A caller-supplied `parameters.id` overrides the generated UUID; this is useful for replays and deterministic tests, but it means every play of the step shares one envelope id. The published envelope therefore also carries `rowId`, the alert log row recorded for that play, and the scene manager reports the play's lifecycle (`playing`, `completed`, `failed`, `skipped`) against that row, so overlapping plays of one envelope each settle their own row.

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `published` | `boolean` | Always `true` on success |

#### `scene.widget.visibility`

Shows or hides one widget on a scene, on every overlay showing that scene. The step asks the scene manager over `engine.scene.command` and waits for its answer, so a step naming a scene or widget that no longer exists fails with that reason instead of reporting success.

```json
{
  "id": "show-hype-board",
  "type": "action",
  "action": "scene.widget.visibility",
  "parameters": {
    "sceneId": "b9e34157-70d0-4c20-b313-08fb0884f62d",
    "placementId": "w-1791078000000",
    "visible": true
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | `string` | Yes | Must be `"scene.widget.visibility"`. Set at the task top level. |
| `parameters.sceneId` | `string` | Yes | The scene the widget is placed on. |
| `parameters.placementId` | `string` | Yes | The placement's `id` in the scene's widgets. A widget placed twice is two placements. |
| `parameters.visible` | `boolean` | No | `true` shows the widget, `false` hides it. Defaults to `true`; `"true"` and `"false"` are accepted, since a value from an expression arrives as text. |

A hidden widget is hidden, not removed: it keeps running, so showing it again is instant and it comes back with its state and timers as they were.

The change is saved: it is applied to the published scene like an edit, written back with the scene, and copied into the editor's draft, so a widget a step hid stays hidden across restarts and the editor shows it hidden, until a step or the editor shows it again. A widget meant to stay out of sight until something happens is saved hidden in the editor.

To show a widget for a while, follow this step with a [`wait`](#delay) and a second step with `visible: false`.

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `sceneId` | `string` | The scene changed |
| `placementId` | `string` | The placement changed |
| `visible` | `boolean` | Whether it is now shown |

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

Reserved names, defined in `shared/common/contracts/reserved-subjects.json`. An entry ending in `.` reserves that whole namespace; any other entry reserves exactly that name.

- **Commands** (also refused as events declared by an uploaded module): `webhook.`, `db.`, `engine.`, `twitchapi`, `message.send`, `ui.notify.`, `ui.alert.`, `platform.gateway.`, `widget.queue.`, `workflow.execute`, `workflow.replay`, `workflow.cancel`, `workflow.command.execute`, `action.execute`.
- **Engine events**: `HEARTBEAT`, `MESSAGEBUS_INIT`, `barkloader.`, `channel.`, `channelpoints.`, `chat.command.`, `command.`, `module.`, `session.`, `setting.`, `stream.offline`, `stream.online`, `user.message`, `viewer.`, `widget.event`, `workflow.health.`, `workflow.run.`.

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

A branch behaves like the steps under an "if" in a step list, whatever `dependsOn` the tasks in it declare:

- **A branch task never runs before its condition.** Listing a task in `onTrue` or `onFalse` makes it wait for the condition, even with no `dependsOn` of its own.
- **A branch not taken skips everything under it, at any depth.** A condition inside a skipped branch is skipped too, never evaluated, and so are both of its branches, and theirs. A condition only needs to list its direct children.
- **The step after a condition waits for its branches.** A task outside a condition's branches that depends on the condition, or on any task in its branches, waits for every task in them, nested ones included. Skipped tasks count as finished, so it runs once the branch taken has finished, or right after the condition when that branch is empty. The one exception is a branch task that itself declares `dependsOn` that following task: the declared order is kept, and the following task does not wait for it.

```json
[
  { "id": "check", "type": "condition", "conditions": [{ "field": "${trigger.data.amount}", "operator": "gte", "value": 500 }],
    "onTrue": ["big-alert", "big-thanks"], "onFalse": ["small-thanks"] },
  { "id": "big-alert", "type": "log", "dependsOn": ["check"], "parameters": { "message": "big alert" } },
  { "id": "big-thanks", "type": "log", "dependsOn": ["big-alert"], "parameters": { "message": "big thanks" } },
  { "id": "small-thanks", "type": "log", "dependsOn": ["check"], "parameters": { "message": "small thanks" } },
  { "id": "log-it", "type": "log", "dependsOn": ["check"], "parameters": { "message": "after the branch" } }
]
```

`log-it` depends only on `check`, but runs after `big-alert` and `big-thanks` (or after `small-thanks`), never alongside them.

A condition listing an unknown task, or listing itself, is refused when the run starts, as is a condition that would have to run after its own branch.

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
      { "field": "${event.data.userName}", "operator": "ne", "value": "" }
    ],
    "timeout": "5m",
    "onTimeout": "continue"
  }
}
```

A wait's `conditions` see only the event being considered, as `${event.data.X}`, `${event.type}` and `${event.id}`; `trigger` and task exports are not available to them. See [Wait conditions](./schema.md#wait-conditions).

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

`field` is a plain dot path rooted at the event, as in `data.amount`; only the
payload is reachable. With no `field` set, `sum` and `threshold` read `data.amount`
and then `data.value`. An event whose value is missing or not a number is logged as
an error and not counted, rather than contributing a default, so a `sum` that cannot
find its number is reported instead of quietly behaving like a `count`; the wait
keeps waiting for events that carry one.

Every strategy keeps both `count` and `sum` current, whichever one decides the
wait, so a `threshold` wait can still report how many events it saw and their
total. A `count` needs no number: an event it cannot read one from still counts
and adds nothing to `sum`.

Wait tasks export aggregation results for downstream tasks:

| Export | Type | Description |
|--------|------|-------------|
| `satisfied` | `boolean` | Whether the wait's event (or aggregation threshold) arrived. `true` for a delay that ran its course |
| `timedOut` | `boolean` | Whether the wait ended at its timeout |
| `count` | `number` | Events counted (aggregation waits, every strategy) |
| `sum` | `number` | Running total of the events' numbers (aggregation waits, every strategy) |
| `events` | `Event[]` | All received events |
| `lastEvent` | `Event` | The most recent received event, when there is one |
| `data` | `object` | `lastEvent`'s data. Empty when the wait ended without an event, and then any field read from it, such as `${pause.data.user}`, resolves to empty instead of failing |

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
