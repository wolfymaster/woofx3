# CloudEvents

CloudEvents is the inter-service messaging format used throughout WoofX3. All events exchanged over the NATS message bus conform to the [CloudEvents specification v1.0](https://github.com/cloudevents/spec). The shared client library provides typed event factories for each integration, ensuring consistent event shapes across services.

## Overview

- **Format**: CloudEvents 1.0 over NATS
- **Transport encoding**: JSON serialized to `Uint8Array`
- **Subject routing**: The NATS subject is the CloudEvents `type` field (e.g. `user.message`)
- **Source identification**: Each service sets a `source` string when constructing its `EventFactory`
- **Command pattern**: Some integrations (TwitchApi) use a lightweight command envelope instead of CloudEvents for imperative operations

## Base Event Structure

Every CloudEvent shares the same envelope:

```typescript
// shared/common/typescript/cloudevents/BaseEvent.ts
interface BaseEvent<T> {
  specversion: string;  // always "1.0.0"
  type: string;         // NATS subject / event type
  source: string;       // originating service identifier
  id: string;           // unique event ID
  time: Date;           // event timestamp
  platform?: string;    // extension attribute: where the event came from
  workflowChain?: string; // extension attribute: the workflow runs that led to it
  data: T;              // event-specific payload
}
```

`platform` is provenance rather than payload: `type` says what happened,
`platform` says where, so a subscriber can take `channel.follow` from every
platform and narrow only when it cares. It is absent on events with no
originating platform — module lifecycle, db outbox, scheduler — and, today, also
absent from every family except Twitch, because only that factory stamps it
(`Twitch/index.ts:112-118`). See [Stream sessions](./stream-sessions.md) for why
the next extension attribute is stamped centrally instead.

`workflowChain` names the workflow runs that led to the event, oldest first, as
comma-joined workflow ids. The workflow engine refuses a run whose chain is too
long, which stops a workflow that keeps triggering itself. Absent on an event
nothing in a workflow caused; a `user.message` carries it when the line is one
a workflow said through the platform gateway.

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

```

### Publishing an event

Each factory method returns an `EventTuple` — a `[subject, payload]` pair ready to publish directly on the NATS client:

```typescript
const nats = // ... your NATS connection
const [subject, payload] = factory.Twitch().chatMessage({
    messageId: 'abc-1',
    channelId: '123',
    channelName: 'wolfymaster',
    chatterId: '456',
    chatterName: 'Viewer1',
    chatterLogin: 'viewer1',
    message: 'hello world',
    amount: 0,
    isPaid: false,
    membership: { isBroadcaster: false, isModerator: false, isSubscriber: false, isVip: false },
    fromEngine: false,
});

nats.publish(subject, payload);
```

---

## Message contracts

A message that crosses a language boundary (a Go producer and a TypeScript consumer, a TypeScript
producer and a Rust consumer) is described once, in an OpenAPI 3.1 document, and every language's
types and validator are generated from it. Nothing else holds the shape: not a hand-written type, not
an enum list, not a second validator. This is the message half of the [contracts rules](./contracts.md).

| Contract | Messages | Producer | Consumer |
| --- | --- | --- | --- |
| `shared/contracts/scene/openapi.yaml` | `engine.scene.command` request and reply | workflow engine (Go) | scene manager (TypeScript) |
| `shared/contracts/barkloader/openapi.yaml` | `barkloader.module.field_options` request | api (TypeScript) | barkloader (Rust) |
| `shared/contracts/heartbeat/openapi.yaml` | `com.woofx3.heartbeat`, published on `HEARTBEAT` | every service (Go, TypeScript, Rust) | the runtime health monitors (Go, TypeScript) and the api's readiness probe |
| `shared/contracts/session/openapi.yaml` | `session.started`, `session.ended` | api (TypeScript) | every publishing process (TypeScript, Rust), the api's session summary emitter |
| `shared/contracts/streamstatus/openapi.yaml` | `stream.status.observed`, `stream.status.requested` | connectors host, api (TypeScript) | api, connectors host |
| `shared/contracts/stream/openapi.yaml` | the [streaming platform events](#streaming-platform-events) | connectors (TypeScript) | workflow engine (Go), api (TypeScript) |
| `shared/contracts/module/openapi.yaml` | `module.storage.changed` | barkloader (Rust), api (TypeScript) | api, scene manager (TypeScript) |
| `shared/contracts/outbox/openapi.yaml` | `database.record.changed`, `userpage.form.submitted`, `viewer.segment.entered`, `viewer.segment.left` | db service (Go) | api (TypeScript), workflow engine (Go) |
| `shared/contracts/workflow/openapi.yaml` | `workflow.execute`, `workflow.cancel` (request and reply), `workflow.replay`, `workflow.command.execute`, `workflow.run.started`, `.completed`, `.failed` and `.cancelled`, `workflow.health.snapshot`, `.changed` and `.get` | api and connectors (TypeScript) for the requests, workflow engine (Go) for the replies and events | workflow engine, api |

All the documents take their CloudEvents attributes (`specversion`, `id`, `source`, `time`) and the
opaque id type from `shared/contracts/common/cloudevents.yaml`, a document with no operations of its
own.

Every contract message carries `specversion` `1.0.0`, one value defined once in that document. It is
not a CloudEvents specification value (the specification's is `1.0`): it is what the TypeScript and
Rust event factories wrote first, and a factory serves every event family. A reader refuses `1.0`.
The Go SDK cannot set a version it does not know, so a Go producer writes the generated constant
itself, and the db service's outbox encoder replaces the SDK's `specversion` on the encoded envelope.

### Writing a message

- Each message is a schema in `components.schemas`, and an operation under `paths` references it.
  The operation exists so the generators reach the schema; its path is the message's `type` (the
  NATS subject, except for the heartbeat, which is published on `HEARTBEAT`), and its request body
  and `200` response are the message's request and reply. A message nobody replies to, an event, has
  only a `202` response with no body.
- A request is the whole CloudEvent: `additionalProperties: false`, every attribute listed, `type`
  an `enum` with one value, the subject. A reply is the raw reply body and is open, so a producer
  can add a field before its consumers know it.
- `data` is bounded: `maxLength` on every string, `minimum` and `maximum` on every number, `enum`
  for every closed set, and a name for every id type.
- Only one subset of the language is used, so one validator per language enforces all of it: no
  `if`/`then`/`else`, no `uniqueItems` on arrays of objects, no `propertyNames`, no
  `nullable`. Optional fields are omitted by their producer, never sent as `null` or empty, and the
  schema refuses both.
- A union is written with `oneOf` over variants, each with a single-value string `enum` property
  (the scene reply's `status`), and a `discriminator` with an explicit `mapping`. The tools read
  the `mapping`: ogen and typify emit a tagged union, and openapi-typescript the constant enums. Ajv
  does not take a `mapping`, so the validator generator drops the `discriminator` and validates the
  plain `oneOf`, which the disjoint enums make equivalent. A boolean cannot discriminate in ogen,
  which is why the reply carries a string `status` rather than `ok`.

The subject is a generated constant in every language: the `type` enum becomes
`SceneCommandRequestTypeEngineSceneCommand` in Go (package `messages/scene`), the
`SceneCommandRequestType.engine_scene_command` enum in TypeScript, and
`SceneCommandRequestType::EngineSceneCommand` in Rust (`to_string()` is the subject). A
producer sets `type` from it and a consumer subscribes on it. `scripts/gen-schemas.sh` refuses a
document whose operation path is not the `type` its request fixes.

### Heartbeat, session and stream status

These are published events with no reply, so each document holds the producer's whole CloudEvent,
closed, and every reader checks what it receives against the same schema.

- **`com.woofx3.heartbeat`** carries a fresh `id`, `source`, `subject`
  `HEARTBEAT`, `time` and `data: { application, ready }`. A reader takes `application` as the
  service's runtime name. A message on `HEARTBEAT` that does not fit, such as a bare ping, is not a
  heartbeat and is ignored. The runtime monitors' liveness ping is not published there: it goes to
  `_HEALTH.<application>.ping`.
- **`session.started`** and **`session.ended`** carry no `sessionId` attribute, since they are what
  establishes the session. **`stream.status.observed`** carries the `platform` attribute and, when
  its publisher knows a session, the `sessionId` attribute; `data` is `{ live, startedAt? }` and
  `startedAt` is present only for a live stream whose platform says when it began.
  **`stream.status.requested`** has no `data`.

### Generating

```bash
bun install                  # once; installs the pinned TypeScript generators
scripts/gen-schemas.sh       # regenerate every contract
scripts/gen-schemas.sh --check   # generate into a temporary directory and diff; exit 1 on drift
```

`scripts/gen-schemas.sh` bundles each document, then writes, for every domain listed in its
`DOMAINS` table:

| Language | Generator | Output |
| --- | --- | --- |
| Go | `ogen` 1.25 | `shared/common/golang/messages/<domain>/*_gen.go`: types, enum constants and `Validate()` methods |
| TypeScript | `openapi-typescript` 7.13 with `--enum`, Ajv 8 | `<Dir>/<domain>.gen.ts` (types and enums) and `<Dir>/<domain>.validate.gen.ts` (precompiled validators, one type guard per schema), under `shared/common/typescript/cloudevents/` |
| Rust | `cargo-typify` 0.10.1 | `shared/common/rust/cloudevents/src/<domain>_gen.rs`: serde types and the document as `DOCUMENT` |

The tools and their pins are in `scripts/contracts/` (`go.mod`, `package.json`, the `typify`
version in the script). Generated files carry a header naming the command and are never edited.
`scripts/check.sh schemas` runs the check, and the `schemas` job of `go-checks.yml` runs it in CI,
so a document changed without its outputs, or an output edited by hand, cannot merge.

### Adding a message or a domain

1. Add the schemas and the operation to the domain's document, or create
   `shared/contracts/<domain>/openapi.yaml` with its `fixtures/` directory.
2. For a new domain, add a line to `DOMAINS` in `scripts/gen-schemas.sh`, a Go package directory
   `shared/common/golang/messages/<domain>`, and the TypeScript and Rust consumers' entries (the
   Rust module in `shared/common/rust/cloudevents/src/lib.rs`, the paths in `scripts/check.sh` and
   in the path filters of `go-checks.yml`).
3. Run `scripts/gen-schemas.sh` and commit the outputs.
4. Add fixtures and a test line for each schema (below).
5. Use the generated types in the producer and the consumer. What stays hand-written is the mapping
   between a domain object and its generated type.

### Fixtures

`shared/contracts/<domain>/fixtures/*.json` hold, for one schema each, named cases
`{ name, valid, value }`: valid values, and invalid ones (an unknown field on a request, a missing or
mistyped field, a `null`, an empty value, a value over a bound, a reply with an extra field, which is
valid). A valid case with fields the generated type does not know carries `unknownFields: true`.
The same files run in all three languages, through the generated types and through the run-time
validator: Go in `shared/common/golang/messages/<domain>/fixtures_test.go`, TypeScript in
`shared/common/typescript/cloudevents/contracts.test.ts`, Rust in
`shared/common/rust/cloudevents/tests/contracts.rs`. A valid case must round-trip through the
generated type unchanged.

### Events

An event has no reply, so its operation answers `202` and the document says who publishes it and
who reads it. Its schema is closed like a request, and lists every attribute the publisher puts on
the wire, extension attributes included.

The `outbox` document describes events the db service writes to its outbox inside the transaction
that changed the data. They are published on the subject equal to their `type`, because workflows
trigger on the type, and not on the `db.<entity>.<operation>.system` subjects of the other outbox
rows. `EventPublisher.PublishEventIn` takes the generated data type and calls its `Validate()`
before it writes the row, so data that breaks the contract fails the transaction that produced it
and never reaches the outbox; the worker does no validation of its own, which keeps the publish
path cheap. The worker builds the envelope from the row in one function (`encodeCloudEvent`), and
a test validates what it builds against the generated envelope. Where the contract allows a
`null` (a deleted row's `publicValues`, the platform fields of an anonymous viewer), the value is
required and nullable, never optional.

`module.storage.changed` is published per module on `module.storage.<moduleId>.changed`, once for
every storage write, so it is validated once per consumer at the edge, not by the publishers:
barkloader builds its data from the generated type, and the api's session-end clear builds it from
the generated TypeScript type. Its `value` is any JSON value, `null` included, and is always
present.

### Workflow messages

The `workflow` document covers what the engine receives and announces, except `action.execute`
(whose actions are workflow task definitions, a contract of their own) and the `db.workflow.*`
change events. Two things set it apart from the other documents:

- The engine's own events carry no `specversion`, because its publisher writes only the attributes it
  has. Requests from the api and the connectors carry `1.0.0`. The contract describes what each side
  sends; it does not change either.
- `workflow.cancel` is a plain JSON request and `workflow.health.get` has no body, so only a request
  that is a CloudEvent fixes its `type` to the operation path.

The engine validates every request it reads and every run or health event it publishes
(`workflow/contracts.go`); a refused request is answered `refused`, a refused event is logged and not
published. The api validates the engine's replies and the events it forwards as webhooks, and checks
its own requests before sending them.

### Run-time validation

A consumer validates what it receives against the same document that typed it:

- **Go**: `json.Unmarshal` into the generated type, then its `Validate()`. The workflow engine
  validates its own request before publishing, and the reply it receives. The runtime's NATS monitor
  builds each heartbeat from the generated type, validates it before publishing, and ignores a message
  on `HEARTBEAT` that does not validate.
- **TypeScript**: the `validate<Schema>` type guard from `<domain>.validate.gen.ts`. The scene manager
  validates every `engine.scene.command` request; the api validates a `barkloader.module.field_options`
  request before sending it. The api's resolver and the connectors host check each `session.*` and
  `stream.status.*` event they publish with `encodeContract` (`cloudevents/utils.ts`), which throws when
  the serialised event does not fit; every reader checks what it receives with `parseContract`, as the
  runtime monitors and the api's readiness tracker do for heartbeats. The api validates
  `database.record.changed` and `module.storage.changed` before projecting them onto webhooks, and the
  scene manager validates `module.storage.changed`; an event that breaks its contract is logged and
  dropped. The validators are precompiled, so they need no document at run time
  (and run under Convex); `ajv` is the only dependency.
- **Rust**: the `jsonschema` crate over the `DOCUMENT` the generated module embeds, then serde into the
  generated type. Barkloader validates every field-options request and every `session.started` message this way,
  and builds each heartbeat it publishes from the generated types. A serde type alone
  accepts `null` for an optional field, so the validator is the check, not the type.

## Streaming platform events

The connectors publish what happens on a streaming platform as CloudEvents whose NATS subject is the
CloudEvents `type`. The platform is the `platform` attribute (`twitch`), not part of the subject, so a
workflow subscribes to `channel.follow` once and narrows by platform only when it cares. The contract is
`shared/contracts/stream/openapi.yaml`; its payload schemas are the only description of each payload, so
read them there.

| Subject | Schema (envelope) | Payload |
|---------|-------------------|---------|
| `user.message` | `UserMessageEvent` | `UserMessage` |
| `channel.cheer`, `channel.follow`, `channel.raid`, `channel.hypetrain` | `Channel<Name>Event` | `ChannelCheer`, `ChannelFollow`, `ChannelRaid`, `ChannelHypeTrain` |
| `chat.command.<slug>` | `ChatCommandEvent` | `ChatCommand` |
| `channelpoints.redeem` | `ChannelPointsRedeemEvent` | `ChannelPointsRedeem` |
| `stream.online`, `stream.offline` | `StreamOnlineEvent`, `StreamOfflineEvent` | `StreamOnline`, `StreamOffline` |
| `channel.subscribe`, `channel.subscriptionGift`, `channel.resub`, `channel.giftPaidUpgrade`, `channel.primePaidUpgrade`, `channel.unraid`, `channel.payItForward`, `channel.announcement`, `channel.charityDonation`, `channel.bitsBadgeTier`, `channel.watchStreak` | `Channel<Name>Event` | `Channel<Name>` |
| `channel.shared*` (see [Shared chat](#shared-chat)) | `ChannelShared<Name>Event` | the plain event's payload, except `Subscribe`, `SubscriptionGift` and `Raid`, whose shared payloads add the chat notification fields |
| `channel.ad_break.upcoming`, `.begin`, `.end` | `ChannelAdBreak<Name>Event` | `ChannelAdBreak<Name>` (see [Twitch ad breaks](/services/twitch-channel)); `end` is synthesized by the adapter, not sent by Twitch |

Rules the contract fixes:

- An event is closed: an unknown field, a missing or mistyped one, and a `null` where the schema has none
  are refused. A field the platform can lack (a gifter who is anonymous, a channel outside a shared chat)
  is required and nullable: it is present and `null`, never omitted, so a workflow condition reads `null`
  instead of failing on a missing key. Only `ChannelPointsRedeem.message`, `ChatterMembership.isFollower`
  and `ChatterMembership.subscriberTier` are omitted when absent; absent is never `false` or a default tier.
- `specversion` is `1.0.0`, what `BaseEvent` stamps on every TypeScript event; `sessionId` is present once the
  publisher knows a session; `workflowChain` is present only on a `user.message` the engine said itself.
- `chat.command.<slug>` is one subject per command name, so its operation path is `/chat.command.{slug}` and
  its `type` is a pattern, not a fixed value. Three publishers build it: the connectors when a viewer types the
  command, the api when the dashboard runs it, and the workflow engine's `command.run` step. `specversion` is
  optional on it because the engine does not stamp one, and `data.platform` is `null` on a run no chat caused,
  where `chatter` is empty too.

`TwitchEvents` (`shared/common/typescript/cloudevents/Twitch`) validates each event against its generated
validator before returning the bytes to publish, so an event that does not fit throws at the publish call
and nothing reaches the bus. Consumers do not validate again: the workflow engine matches on subjects and
reads `data` through expressions, and the api reads typed fields after the producer's check. Go
(`shared/common/golang/messages/stream`) and Rust (`stream_gen`) carry the generated types for any consumer
that decodes these payloads; the shared fixtures in `shared/contracts/stream/fixtures` run through all three.

Every payload must also be a plain object. `TwitchEvents` throws when given a
class instance (anywhere in the payload), so a platform SDK event, whose data
sits behind getters and whose API client is an own property, can never be
serialized onto the bus by accident.

### Shared chat

During a Twitch shared chat session, activity in the other participants' channels also shows up in this broadcaster's chat. Twitch delivers it as a `shared_chat_*` chat notification with `source_broadcaster_user_id` set to the channel it happened in.

Those notices are published as separate `shared*` events, never as the plain event, so a partner's sub or raid does not fire this channel's alerts. Each carries the plain event's payload plus the chat notification fields, including `sourceBroadcasterId` and `sourceBroadcasterName`.

| Method | NATS Subject / Type | Twitch notice types |
|--------|---------------------|---------------------|
| `sharedSubscribe` | `channel.sharedSubscribe` | `shared_chat_sub`, `shared_chat_sub_gift` |
| `sharedSubscriptionGift` | `channel.sharedSubscriptionGift` | `shared_chat_community_sub_gift` |
| `sharedRaid` | `channel.sharedRaid` | `shared_chat_raid` |
| `sharedResub` | `channel.sharedResub` | `shared_chat_resub` |
| `sharedGiftPaidUpgrade` | `channel.sharedGiftPaidUpgrade` | `shared_chat_gift_paid_upgrade` |
| `sharedPrimePaidUpgrade` | `channel.sharedPrimePaidUpgrade` | `shared_chat_prime_paid_upgrade` |
| `sharedPayItForward` | `channel.sharedPayItForward` | `shared_chat_pay_it_forward` |
| `sharedAnnouncement` | `channel.sharedAnnouncement` | `shared_chat_announcement` |

A raid on this channel is published once, as `channel.raid`, from the `channel.raid` EventSub subscription. The matching `raid` chat notice is not published.

---

## Running a command's workflow

`workflow.command.execute` asks the workflow engine to run the workflow a chat
command is linked to, for one invocation. Published by the connectors chat dispatcher once a
command has matched and passed its permission and cooldown checks, after it
has announced the match on `chat.command.<slug>`, and by the engine api's
`executeCommand` (which publishes it first, then the announcement). `event` is
the announced `chat.command.<slug>` CloudEvent itself, not a copy: the same
`id`, `time` and `sessionId`, with the command's slug as `data.command`. The
workflow service runs that one workflow (`Engine.RunCommand`), which must have
a trigger of type `"command"` whose `event` matches `event.type`; its trigger
conditions apply, nothing else is checked again.

`data.platform` and the `platform` attribute name the platform the invoking
line was said on, one of the platform gateway's platform ids (`twitch`
today).

```jsonc
// subject: "workflow.command.execute"
{
  "workflowId": "3f1c…",
  "event": {                     // the invocation; the run's ${trigger...}
    "specversion": "1.0.0", "id": "...", "type": "chat.command.hug", "source": "connectors", "time": "...",
    "sessionId": "...", "platform": "twitch", "triggeredBy": "twitch",
    "data": { "command": "hug", "chatter": "wolfy", "text": "", "args": [], "variables": {}, "rawMessage": "!hug", "platform": "twitch" }
  }
}
```

A workflow with a `"command"` trigger is never offered events, so the
`chat.command.<slug>` event of the same invocation does not run it a second
time. The subject is reserved: no workflow or module may publish it.

## Running actions without a workflow

`action.execute` asks the workflow engine to run a list of actions that
belongs to no workflow — the actions of a chat command that has no workflow,
or anything else with actions to run and nothing to hang them on. Published
by the engine api's `runActions(input)` RPC and by the connectors chat dispatcher when such a
chat command matches;
consumed by the workflow service, which runs them through the same executor,
resolver and action handlers a workflow run uses.

```jsonc
// subject: "action.execute"
{
  "label": "command:hug",        // names the run in the engine's logs
  "actions": [                   // run in order; a step may declare dependsOn
    { "id": "action-1", "action": "chat.reply", "parameters": { "message": "hugs ${trigger.data.chatter}" } }
  ],
  "event": { "id": "...", "type": "chat.command.hug", "source": "connectors", "time": "...", "data": { } }
}
```

`event` is what the actions resolve `${trigger.data...}` against. The run is
not recorded and emits no `workflow.run.*` lifecycle: both are keyed by a
workflow id this run does not have.

## Twitch API Commands

`TwitchApi` events use a command envelope rather than a CloudEvent. All commands publish to the `twitchapi` NATS subject; the connectors Twitch adapter reads the bare envelope and a CloudEvent carrying it as `data` alike.

```typescript
// shared/common/typescript/cloudevents/Twitch/commands.ts
// subject: "twitchapi"
// payload: { command: string; args: Record<string, unknown> }
```

### Commands

| Method | Command string | Description |
|--------|----------------|-------------|
| `timeout` | `timeout` | Time out a user in chat |
| `updateStream` | `updateStream` | Change the title, category or tags |
| `createMarker` | `createMarker` | Place a stream marker (live only) |

```typescript
interface TimeoutArgs {
  userId?: string;          // or userName
  userName?: string;
  durationSeconds: number;  // 1 to 1209600
  reason?: string;          // at most 500 characters
}

interface UpdateStreamArgs {
  title?: string;           // at most 140 characters (not UTF-16 units)
  category?: string;        // free text, resolved through Twitch's category search
  categoryId?: string;      // used as given; "" clears the category
  tags?: string[];          // at most 10, each at most 25 letters or numbers
}

interface CreateMarkerArgs {
  description?: string;     // at most 140 characters
}
```

The connectors Twitch adapter serves more commands than these helpers build; the full list, the replies and the rules it checks are in [Twitch channel controls](./twitch-channel.md).

### Usage

```typescript
const [subject, payload] = factory.TwitchApi().timeout({ userName: 'bad_actor', durationSeconds: 600 });
nats.publish(subject, payload);
```

---

## Engine control

### OBS control (`engine.obs.command`)

barkloader's `ctx.obs` host extension controls OBS through the connectors host's obs adapter
with a request/reply CloudEvent on `engine.obs.command`, on behalf of module
code holding the `obs.control` permission. Every request is answered with `{ ok, error? }`. `ctx.obs.listScenes` and its siblings read OBS
over the separate, read-only `engine.obs.options`. See [OBS control](./obs.md).

### Scene control (`engine.scene.command`)

The workflow engine's `scene.widget.visibility` action changes a scene with a
request/reply CloudEvent on `engine.scene.command`, answered by the scene
manager with `{ "status": "ok" }` or `{ "status": "failed", "error": "<reason>" }`.
Its `data` is
`{ command: "set_placement_visibility", sceneId, placementId, visible }`
(the `SceneCommand` schema of the [scene contract](#message-contracts)). A
request that does not fit the contract is answered `{ "status": "failed", "error" }` and
changes nothing, and so is a message with no reply subject. The scene manager applies it as an op on the
published scene, so it reaches overlays and editors like any other change
(see [Scene documents](./scene-documents.md)). See
[Task types → scene.widget.visibility](../workflow/tasks.md#scene-widget-visibility).

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
| `ui.notify.alert` | workflow → sceneManager | `AlertEnvelope` JSON: `{ id, parameters, event, rowId }` (`rowId` absent when the alert log row could not be recorded) | publish/subscribe |
| `ui.alert.broadcast` | streamware queue → streamware broadcaster | The same `AlertEnvelope`, re-emitted when it's the alert's turn to play | publish/subscribe |
| `widget.event` | overlay → streamware | CloudEvents 1.0 envelope; `data` is `{ moduleId, instanceId, widgetCanonicalId?, key, value, occurredAt }` | publish/subscribe |
| `widget.queue.skip` | api → sceneManager | `{}`; reply `{ ok, skipped, reason? }` | NATS request/reply |
| `widget.queue.clear` | api → sceneManager | `{}`; reply `{ ok, cleared, reason? }` | NATS request/reply |
| `widget.queue.replay` | api → sceneManager | `{ id }` (alert row id); reply `{ ok, replayEnvelopeId?, reason? }` | NATS request/reply |

Routing rules for `widget.event` are handled in `streamware/src/events/handlers.ts`. Dispatch is keyed on `data.key`:

- `data.key === "alert.lifecycle"` and `data.instanceId === "alert-overlay"` → `EventQueueManager.handleStatus` (state transitions on the in-flight alert lease).
- Anything else → `db.upsertWidgetStatus` (latest-value upsert per `(instanceId, key)`).

See [Widget event channel](./widget-events.md) for the full message shape, queue semantics, and host API contract, and [Skip, clear and replay](./widget-events.md#skip-clear-and-replay) for the `widget.queue.*` requests.

## Go — DB-Outbox Subjects (engine → api)

The api/ boundary projects db-proxy outbox events to outbound HTTPS webhooks. Every db.proxy CRUD operation publishes a CloudEvent on `db.{entityType}.{operation}.{appId}`. The api subscribes to the wildcards and forwards typed events to the registered callback URL. This used to be centralized in `api/src/api.ts`; since the `api.ts` → per-domain module split, each entity type wires its own outbox subscription — see `api/src/alert-emitter.ts` (alerts), `api/src/overlay-token-handlers.ts` (overlay tokens), `api/src/module-event-handlers.ts` (modules), `api/src/storage-change-emitter.ts` (module storage), all wired up in `api/src/server.ts`, plus `shared/clients/typescript/api/webhooks.ts` for the event shapes.

Alert-related outbox subjects:

| Subject (wildcard) | Fired when | Webhook event |
|---------------------|------------|----------------|
| `db.alert.created.*` | streamware records a fresh alert envelope (`db.createAlert`) | `ALERT_RECORDED` |
| `db.alert.updated.*` | the lifecycle of the newest alert row for an envelope moves forward (`dispatched` / `playing` / `completed` / `failed` / `timed_out` / `skipped` / `replayed`); a refused transition publishes nothing | `ALERT_PLAYING` / `ALERT_COMPLETED` / `ALERT_FAILED` / `ALERT_TIMED_OUT` / `ALERT_SKIPPED` / `ALERT_REPLAYED` (chosen by `alert.status`); `dispatched` has no webhook |
| `db.alert.deleted.*` | an alert row is deleted; its snapshot carries the version after the row's last write | none |
| `db.widget_status.updated.*` | streamware upserts a non-alert widget event (`db.upsertWidgetStatus`) | `WIDGET_STATUS_CHANGED` |

Every alert snapshot carries the row's `version`, which the database increments with each write it publishes. The db proxy alone enforces the lifecycle rule; a receiver keeps the snapshot with the highest version of each row and does not re-check it.

The full set of webhook event types is defined in `shared/clients/typescript/api/webhooks.ts`. Each one also reaches clients subscribed to the engine event stream; see [Engine callbacks](./engine-callbacks.md).

## Go — User Page Subjects

`SubjectUserPageFormSubmitted` (`userpage.form.submitted`) fires when a form submission from a public user page is recorded. See [User page forms](./user-page-forms.md#the-trigger).

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

    SubjectWorkflowHealthSnapshot Subject = "workflow.health.snapshot"
    SubjectWorkflowHealthChanged  Subject = "workflow.health.changed"
    SubjectWorkflowHealthGet      Subject = "workflow.health.get"
)
```

| Subject | Description |
|---------|-------------|
| `workflow.change` | A workflow definition changed (parent subject) |
| `workflow.change.add` | A new workflow was added |
| `workflow.change.update` | An existing workflow was updated |
| `workflow.change.delete` | A workflow was deleted |
| `workflow.execute` | A workflow execution was triggered |
| `workflow.health.snapshot` | Every workflow in error, once the engine's first complete load finishes |
| `workflow.health.changed` | One workflow's health changed after the snapshot |
| `workflow.health.get` | Request/reply: the health of every workflow the engine has tried to load |

### Workflow health

Published by the workflow service with `source: "workflow"` (see
[Execution Model](../workflow/execution.md#workflow-health)). Every message is built from
one entry shape:

```json
{ "workflowId": "wf-1", "status": "error", "reason": "task \"t1\": unknown action \"gone\"", "since": "2026-09-28T12:00:00Z" }
```

`status` is `"ok"` or `"error"`; `reason` is present only on an error; `since` is
RFC 3339 and marks when the current status and reason began.

`workflow.health.snapshot`, once per engine start, is authoritative: replace everything
with it; any workflow not listed is ok. Its `data`:

```json
{ "workflows": [ { "workflowId": "wf-1", "status": "error", "reason": "...", "since": "..." } ], "at": "2026-09-28T12:00:00Z" }
```

`workflow.health.changed` carries one entry as its `data`, for each change after the
snapshot. Apply it on top of the snapshot; for one workflow, keep the later `since`.

A request on `workflow.health.get` (any body) is answered with every tracked entry, ok
included. `loaded` is false until the first complete load, when the list is partial and
must not replace anything:

```json
{ "loaded": true, "at": "2026-09-28T12:00:00Z", "workflows": [ { "workflowId": "wf-1", "status": "ok", "since": "..." } ] }
```

The api forwards both events to registered clients as webhooks:
`workflow.health.snapshot` (`WorkflowHealthSnapshotEvent`: `{ type, workflows, at }`,
errors only) and `workflow.health.changed` (`WorkflowHealthChangedEvent`: the entry plus
`type`). It also sends a snapshot webhook of its own, built from `workflow.health.get`,
when it starts and whenever its bus connection comes back. It serves the request as the
`getWorkflowHealth()` RPC.

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
