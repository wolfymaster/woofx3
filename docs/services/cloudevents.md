# CloudEvents

CloudEvents is the inter-service messaging format used throughout WoofX3. All events exchanged over the NATS message bus conform to the [CloudEvents specification v1.0](https://github.com/cloudevents/spec). The shared client library provides typed event factories for each integration, ensuring consistent event shapes across services.

## Overview

- **Format**: CloudEvents 1.0 over NATS
- **Transport encoding**: JSON serialized to `Uint8Array`
- **Subject routing**: The NATS subject is the CloudEvents `type` field (e.g. `message.user.twitch`)
- **Source identification**: Each service sets a `source` string when constructing its `EventFactory`
- **Command pattern**: Some integrations (TwitchApi, Slobs) use a lightweight command envelope instead of CloudEvents for imperative operations

## Base Event Structure

Every CloudEvent shares the same envelope:

```typescript
// shared/clients/typescript/cloudevents/BaseEvent.ts
interface BaseEvent<T> {
  specversion: string;  // always "1.0.0"
  type: string;         // NATS subject / event type
  source: string;       // originating service identifier
  id: string;           // unique event ID
  time: Date;           // event timestamp
  data: T;              // event-specific payload
}
```

## EventFactory

`EventFactory` is the entry point for creating events. Instantiate it once per service, passing the service's identifier as `source`.

```typescript
// shared/clients/typescript/cloudevents/EventFactory.ts
import EventFactory from '@woofx3/cloudevents';

const factory = new EventFactory({ source: 'my-service' });

// Twitch channel events
const twitch = factory.Twitch();

// Twitch API command events
const twitchApi = factory.TwitchApi();

// Streamlabs OBS events
const slobs = factory.Slobs();
```

### Publishing an event

Each factory method returns an `EventTuple` — a `[subject, payload]` pair ready to publish directly on the NATS client:

```typescript
const nats = // ... your NATS connection
const [subject, payload] = factory.Twitch().chatMessage({
    channelId: '123',
    channelName: 'wolfymaster',
    chatterId: '456',
    chatterName: 'viewer1',
    message: 'hello world',
    amount: 0,
    isPaid: false,
});

nats.publish(subject, payload);
```

---

## Twitch Events

Twitch channel events carry a full CloudEvent envelope. The NATS subject doubles as the CloudEvents `type`.

### Event Types

| Method | NATS Subject / Type | Description |
|--------|---------------------|-------------|
| `chatMessage` | `message.user.twitch` | A chat message was sent in the channel |
| `cheer` | `cheer.user.twitch` | A viewer cheered with bits |
| `follow` | `follow.user.twitch` | A viewer followed the channel |
| `hypeTrainBegin` | `hypetrain.channel.twitch` | A hype train started |
| `streamOnline` | `online.user.twitch` | The stream went online |
| `subscribe` | `subscribe.user.twitch` | A viewer subscribed |
| `subscriptionGift` | `subscription.gift.twitch` | A subscription was gifted |

### Payloads

#### ChatMessage

```typescript
interface ChatMessage {
    amount: number;       // dollar amount if paid message, otherwise 0
    isPaid: boolean;
    channelId: string | null;
    channelName: string | null;
    chatterId: string;
    chatterName: string;
    message: string;
}
```

#### Cheer

```typescript
interface Cheer {
    amount: number;       // bits cheered
    isAnonymous: boolean;
    message: string;
    userId: string | null;
    userName: string | null;
}
```

#### Follow

```typescript
interface Follow {
    userName: string;
}
```

#### HypeTrainBegin

```typescript
interface HypeTrainBegin {}  // no additional payload
```

#### StreamOnline

```typescript
interface StreamOnline {}   // no additional payload
```

#### Subscribe

```typescript
interface Subscribe {
    isGift: boolean;
    tier: string;         // e.g. "1000", "2000", "3000"
    userId: string | null;
    userName: string | null;
}
```

#### SubscriptionGift

```typescript
interface SubscriptionGift {
    amount: number;       // number of subs gifted
    gifterId: string;
    gifterName: string;
    isAnonymous: boolean;
    tier: string;
}
```

---

## Twitch API Commands

`TwitchApi` events use a command envelope rather than a CloudEvent. All commands publish to the `twitchapi` NATS subject.

```typescript
// shared/clients/typescript/cloudevents/Twitch/commands.ts
// subject: "twitchapi"
// payload: { command: string; args: Record<string, unknown> }
```

### Commands

| Method | Command string | Description |
|--------|----------------|-------------|
| `timeout` | `timeout` | Time out a user in chat |
| `updateStream` | `update_stream` | Update stream title or category |

#### TimeoutArgs

```typescript
interface TimeoutArgs {
    user?: string;
    duration: number;   // timeout duration in seconds
}
```

#### UpdateStreamArgs

```typescript
interface UpdateStreamArgs {
    category?: string;
    title?: string;
}
```

### Usage

```typescript
const [subject, payload] = factory.TwitchApi().timeout({ user: 'bad_actor', duration: 600 });
nats.publish(subject, payload);
```

---

## Slobs Events

Slobs events target [Streamlabs OBS](https://streamlabs.com/streamlabs-live-streaming-software). Widget notifications use a CloudEvent envelope; control commands use the command envelope. All commands publish to the `slobs` NATS subject.

### Event Types

| Method | Type | Pattern | Description |
|--------|------|---------|-------------|
| `notifyWidget` | `slobs` | CloudEvent | Send a notification payload to a widget |
| `follow` | `slobs` | Command | Trigger a follow alert |
| `sceneChange` | `slobs` | Command | Switch the active scene |
| `sourceChange` | `slobs` | Command | Update a source property |

### Payloads

#### NotifyWidget

```typescript
interface NotifyWidget<T extends Object = {}> {
    widgetId: string;
    message: string;
    data: T;            // widget-specific data, generic
}
```

#### FollowArgs (command)

```typescript
interface FollowArgs {
    username: string;
}
```

#### SceneChangeArgs (command)

```typescript
interface SceneChangeArgs {
    sceneName: string;
}
```

#### SourceChangeArgs (command)

```typescript
interface SourceChangeArgs {
    sourceName: string;
    value: string;
}
```

---

## Go — Widget & Alert Subjects

The widget refactor introduced a single inbound channel from overlays and a small set of NATS request/reply subjects for operator controls. All four are defined in `shared/common/golang/cloudevents/subjects.go` and form the contract between the workflow engine, the api boundary, and the streamware orchestrator.

```go
// shared/common/golang/cloudevents/subjects.go
const (
    // Workflow alert action → streamware (intent).
    // Subject is conventional, not a constant — the workflow engine
    // publishes literal "ui.notify.alert" from workflow/actions.go.

    // Streamware queue manager → streamware broadcaster (dispatch).
    SubjectUIAlertBroadcast Subject = "ui.alert.broadcast"

    // Overlay → backend (unified widget event channel).
    SubjectWidgetEvent Subject = "widget.event"
)
```

| Subject | Direction | Payload | Pattern |
|---------|-----------|---------|---------|
| `ui.notify.alert` | workflow → streamware | `AlertEnvelope` JSON: `{ id, applicationId?, parameters, event }` | publish/subscribe |
| `ui.alert.broadcast` | streamware queue → streamware broadcaster | The same `AlertEnvelope`, re-emitted when it's the alert's turn to play | publish/subscribe |
| `widget.event` | overlay → streamware | CloudEvents 1.0 envelope; `data` is `{ applicationId, moduleId, instanceId, widgetCanonicalId?, key, value, occurredAt }` | publish/subscribe |
| `widget.queue.skip` | api → streamware | `{ applicationId? }` | NATS request/reply |
| `widget.queue.clear` | api → streamware | `{ applicationId? }` | NATS request/reply |
| `widget.queue.replay` | api → streamware | `{ id }` (alert row id) | NATS request/reply |

Routing rules for `widget.event` are handled in `streamware/src/widget-event-handlers.ts`. Dispatch is keyed on `data.key`:

- `data.key === "alert.lifecycle"` and `data.instanceId === "alert-overlay"` → `AlertQueueManager.handleStatus` (state transitions on the in-flight alert lease).
- Anything else → `db.upsertWidgetStatus` (latest-value upsert per `(applicationId, instanceId, key)`).

See [Widget event channel](./widget-events.md) for the full message shape, queue semantics, and host API contract.

## Go — DB-Outbox Subjects (engine → api)

The api/ boundary projects db-proxy outbox events to outbound HTTPS webhooks. Every db.proxy CRUD operation publishes a CloudEvent on `db.{entityType}.{operation}.{appId}`. The api subscribes to the wildcards and forwards typed events to the registered callback URL — see `api/src/api.ts:325` and `shared/clients/typescript/api/webhooks.ts`.

Alert-related outbox subjects:

| Subject (wildcard) | Fired when | Webhook event |
|---------------------|------------|----------------|
| `db.alert.created.*` | streamware records a fresh alert envelope (`db.createAlert`) | `ALERT_RECORDED` |
| `db.alert.updated.*` | streamware updates lifecycle (`dispatched` / `playing` / `completed` / `failed` / `timed_out` / `skipped` / `replayed`) | `ALERT_COMPLETED` / `ALERT_FAILED` / `ALERT_TIMED_OUT` / `ALERT_SKIPPED` / `ALERT_REPLAYED` (chosen by `alert.status`) |
| `db.widget_status.updated.*` | streamware upserts a non-alert widget event (`db.upsertWidgetStatus`) | `WIDGET_STATUS_CHANGED` |

The full set of webhook event types is defined in `shared/clients/typescript/api/webhooks.ts`.

## Go — Workflow Subjects

The Go shared package defines NATS subjects for workflow-related events:

```go
// shared/common/golang/cloudevents/subjects.go
const (
    SubjectWorkflowChange  Subject = "workflow.change"
    SubjectWorkflowAdd     Subject = "workflow.change.add"
    SubjectWorkflowUpdate  Subject = "workflow.change.update"
    SubjectWorkflowDelete  Subject = "workflow.change.delete"
    SubjectWorkflowExecute Subject = "workflow.execute"
)
```

| Subject | Description |
|---------|-------------|
| `workflow.change` | A workflow definition changed (parent subject) |
| `workflow.change.add` | A new workflow was added |
| `workflow.change.update` | An existing workflow was updated |
| `workflow.change.delete` | A workflow was deleted |
| `workflow.execute` | A workflow execution was triggered |

---

## Go -- Module Subjects

The Go shared package defines NATS subjects for module lifecycle events, published by barkloader when modules are registered, updated, or removed:

```go
// shared/common/golang/cloudevents/subjects.go
const (
    SubjectModuleChange  Subject = "module.change"
    SubjectModuleAdd     Subject = "module.change.add"
    SubjectModuleUpdate  Subject = "module.change.update"
    SubjectModuleDelete  Subject = "module.change.delete"
    SubjectModuleState   Subject = "module.change.state"
)
```

| Subject | Description |
|---------|-------------|
| `module.change` | A module definition changed (parent subject) |
| `module.change.add` | A new module was registered |
| `module.change.update` | An existing module was updated or reloaded |
| `module.change.delete` | A module was unregistered |
| `module.change.state` | A module was enabled or disabled |

### Module resource-instance lifecycle

Runtime-created instances of module-declared kinds (counters, future timers/polls/etc. — see [`docs/barkloader/modules.md` § Runtime resource instances](../barkloader/modules.md#runtime-resource-instances)). The db-proxy emits these on the standard `db.{entityType}.{operation}.{appId}` outbox shape; the api/ service forwards them to the registered Convex webhook.

```go
// shared/common/golang/cloudevents/subjects.go
const (
    SubjectModuleResourceInstanceCreated         Subject = "module.resource.instance.created"
    SubjectModuleResourceInstanceDeleted         Subject = "module.resource.instance.deleted"
    SubjectDbModuleResourceInstanceCreatedPattern Subject = "db.module.resource.instance.created.*"
    SubjectDbModuleResourceInstanceDeletedPattern Subject = "db.module.resource.instance.deleted.*"
)
```

| Subject (wildcard) | Fired when | Payload |
|---------------------|------------|---------|
| `db.module.resource.instance.created.*` | A module function calls `ctx.resources.create()` (db-proxy persists the row before publishing). | `{ id, module_id, module_name, kind, instance_id, display_name, canonical_id }` |
| `db.module.resource.instance.deleted.*` | A module function calls `ctx.resources.delete()`, or a future cascade path runs. | Same shape as above. |

---

## Utility Functions

```typescript
// shared/clients/typescript/cloudevents/utils.ts

// Encode a CloudEvent to Uint8Array for NATS publish
function encode(event: any): Uint8Array

// Encode a command envelope to Uint8Array for NATS publish
function encodeCommand(payload: { command: string; args: Record<string, unknown> }): Uint8Array
```

Both functions serialize to JSON and encode as UTF-8 bytes. These are used internally by the event factories but can be used directly if you need to build custom envelopes.
