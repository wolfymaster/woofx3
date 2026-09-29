# Widget Event Channel

Every overlay-originated message — alert lifecycle acks, counter increments, timer state, goal progress, generic completion — flows through one NATS subject (`widget.event`) and one UI-side surface (`widgetHost.reportStatus` / `widgetHost.reportComplete`). This page documents the wire format, the dispatch rules, and the host API contract.

## Why one channel

Before this refactor, the api boundary owned three subscriptions:

- `ui.notify.alert` — workflow alert intent
- `ui.widget.status` — alert overlay acks
- `module.widget.status.changed` — generic widget reports

The api layered the alert queue manager and the widget-status persistence on top of those subscriptions, which made it both a webhook gateway and a runtime orchestrator. The refactor pushed the orchestration role into **streamware** and collapsed the inbound channels to a single `widget.event` subject. The api now subscribes only to db-proxy outbox events and projects them to outbound webhooks (its actual boundary job).

A generic widget reporting `key="count"` and the alert overlay reporting `key="alert.lifecycle"` use the exact same plumbing. The only difference is what streamware does with the event after it arrives — see [Dispatch rules](#dispatch-rules) below.

## Wire format

The overlay sends the canonical wire shape (`OverlayWidgetEvent`) as a raw JSON
message over the single P2 overlay WebSocket (`/o/{token}/events`); there is no longer
a separate alert-specific transport. See
`shared/clients/typescript/module-sdk/src/widget-host-shim.ts` (widget → shim →
`status.report` P1 message → `WidgetBridge` → this shape) and
`streamware/src/events/wire.ts:9` (`publishWidgetEvent`, server-side decode + republish).

```typescript
interface OverlayWidgetEvent {
  kind: "widget.event";
  moduleId: string;          // "core" for system widgets, manifest id otherwise
  instanceId: string;        // stable per-placement id (e.g. "alert-overlay")
  widgetCanonicalId?: string; // {moduleId}:widget:{manifestId}, when known
  key: string;               // event name owned by the widget ("count", "alert.lifecycle", ...)
  value: unknown;            // any JSON-serializable payload
  ts?: string;               // ISO 8601; defaults to now if omitted
}
```

`streamware/src/events/wire.ts` (`publishWidgetEvent`) validates the message, wraps it in a CloudEvents 1.0 envelope, and republishes to NATS `widget.event`. The CloudEvent `data` field carries the same fields, with `ts` renamed to `occurredAt` to match the rest of the engine's CloudEvent payloads.

```jsonc
{
  "specversion": "1.0",
  "id": "<uuid>",
  "source": "streamware",
  "type": "widget.event",
  "time": "2026-05-09T14:32:11.482Z",
  "datacontenttype": "application/json",
  "data": {
    "moduleId": "raid_counter",
    "instanceId": "raid-counter-1",
    "widgetCanonicalId": "raid_counter:widget:counter",
    "key": "count",
    "value": 42,
    "occurredAt": "2026-05-09T14:32:11.482Z"
  }
}
```

Malformed messages (missing `kind`, `moduleId`, `instanceId`, or `key`) are dropped with a single warning so a misbehaving widget cannot flood the log.

## Dispatch rules

`streamware/src/events/handlers.ts` subscribes to `widget.event` and dispatches by `data.key`:

| Condition | Handler | Persistence |
|-----------|---------|-------------|
| `key === "alert.lifecycle"` AND `instanceId === "alert-overlay"` | `EventQueueManager.handleStatus(envelopeId, state, error?)` | `alerts` table — lifecycle column on the existing row keyed by `envelope_id` |
| anything else | `db.upsertWidgetStatus({ moduleId, instanceId, widgetCanonicalId?, key, value, occurredAt })` | `widget_status` table — upsert on `(instance_id, key)` |

The two tables answer different questions and so are kept separate:

- **`alerts`** is the durable record of every dispatched alert envelope, with a full lifecycle (`sent` → `dispatched` → `playing` → `completed` / `failed` / `timed_out` / `skipped` / `replayed`). See `db/database/migrate/migrations/0008_alerts.go` and `0010_alert_lifecycle.go`.
- **`widget_status`** holds only the latest value per `(instanceId, key)`. See `db/database/migrate/migrations/0011_widget_status.go` and `db/proto/v1/widget_status.proto`.

Alert lifecycle reports are intentionally not also written to `widget_status` — the alerts table is already the durable record and double-bookkeeping would create reconciliation work for no gain.

## The `alert.lifecycle` value

When the alert overlay calls `host.reportStatus("alert.lifecycle", value)`, `value` is:

```typescript
{
  envelopeId: string;                              // matches alerts.envelope_id
  state: "playing" | "completed" | "failed";
  error?: string;                                  // populated when state === "failed"
}
```

The orchestrator drops reports where `state` is anything other than the three values above, where `envelopeId` is empty, or where the in-flight lease for that application doesn't match the reported envelope id (stale acks after a reconnect or lease expiration).

## Host API contract

Every framed widget gets the same `WidgetHost` contract, whether it is placed on a
scene or plays inside an alert layout; `surface` tells it which. The contract lives
in `shared/clients/typescript/module-sdk/src/widget-host.ts`.

```typescript
interface WidgetHost {
  readonly moduleId: string;
  readonly instanceId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly surface: "scene" | "alert";     // placed on a scene, or playing in an alert
  readonly storage: WidgetHostStorage;     // get / subscribe over module storage

  onEvent(handler: (event: WidgetEvent) => void): () => void;
  reportStatus(key: string, value: unknown): void;
  reportComplete(reason?: string): void;   // sugar for reportStatus("complete", { reason })
}
```

`reportStatus` and `reportComplete` are best-effort: they post a P1 `status.report`
message and never throw. If the handshake with the parent scene manager hasn't
completed yet, the shim queues nothing and the report is silently dropped.

### Iframe widgets

Every framed widget is served through the frame assembler into
a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) and talks to
the scene manager exclusively through the P1 postMessage protocol; there is no
direct property injection onto `iframe.contentWindow`. This is deliberate, not a
same-origin shortcut waiting to be replaced: widget assets can already be served
from barkloader or a CDN (see [Asset delivery](./asset-delivery.md)),
and postMessage is what makes that origin-agnostic.

### Alerts

A scene gets alerts through **alert widgets** (`woofx3:widget:alert`): named areas the
page draws itself, with no frame of their own. The workflow `alert` action carries a
target name and a layout (see [Tasks → alert](../workflow/tasks.md#alert)). The scene
manager validates the layout against the widget catalog and records one scene event for
each running scene that has an alert widget answering to the target; a scene nobody has
open gets nothing.

For each alert, the page frames the layout's widgets inside the alert widget's area,
scaled from the layout's canvas, at `/scene/{sceneId}/alert/{eventId}/widget/{widgetId}`.
That frame is assembled only from the stored scene event, so it can show nothing the
scene manager did not validate and deliver to that scene. Each layout widget boots with
`surface: "alert"` and receives one `alert` event whose `data` is the triggering
CloudEvent (`{ type, data }`, or `null` when nothing triggered the workflow).

A layout widget that subscribes with `autoComplete: false` has a length of its own and
holds the alert until it calls `complete()`; one that completes on handler return has
none. Once every timed widget is done, or after 5 seconds when none is timed, the page
removes the frames, acks the scene event, and plays the alert widget's next alert.

## End-to-end flow

```
Widget iframe                                Scene manager (parent)         Streamware server
   |                                            |                              |
   v                                            v                              |
host.reportStatus(key, value)        WidgetBridge.handleMessage               |
   |                                            |                              |
   |------ P1 status.report (postMessage) ---->|                              |
                                                |                              |
                                                |-- P2 send (raw JSON, /o/{token}/events) -->|
                                                                                |
                                                                                v
                                                                     publishWidgetEvent()
                                                                                |
                                                                                v
                                                                     NATS publish "widget.event"
                                                                                |
                                                                                v
                                                                     streamware/src/events/handlers.ts
                                                                       /                  \
                                                                      v                    v
                                                              EventQueueManager      db.upsertWidgetStatus
                                                              .handleStatus              (widget_status)
                                                                      |                    |
                                                                      v                    v
                                                              db.updateAlertLifecycle  db-outbox event
                                                                      |               db.widget_status.updated.{appId}
                                                                      v                    |
                                                              db-outbox event              v
                                                              db.alert.updated.{appId}  api/ projects to webhook
                                                                      |               WIDGET_STATUS_CHANGED
                                                                      v
                                                              api/ projects to webhook
                                                              (ALERT_COMPLETED / FAILED / etc.)
```
