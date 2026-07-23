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
message over the single P2 overlay WebSocket (`/o/{token}/events` — see
[P2 event source](../woofwoofwoof/streamware/p2-event-source.md)); there is no longer
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
  applicationId?: string;     // optional; orchestrator falls back to its default
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
    "applicationId": "app-123",
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
| `key === "alert.lifecycle"` AND `instanceId === "alert-overlay"` | `EventQueueManager.handleStatus(applicationId, envelopeId, state, error?)` — see [Event queue](../streamware/alert-queue.md) | `alerts` table — lifecycle column on the existing row keyed by `envelope_id` |
| anything else | `db.upsertWidgetStatus({ applicationId, moduleId, instanceId, widgetCanonicalId?, key, value, occurredAt })` | `widget_status` table — upsert on `(application_id, instance_id, key)` |

The two tables answer different questions and so are kept separate:

- **`alerts`** is the durable record of every dispatched alert envelope, with a full lifecycle (`sent` → `dispatched` → `playing` → `completed` / `failed` / `timed_out` / `skipped` / `replayed`). See `db/database/migrate/migrations/0008_alerts.go` and `0010_alert_lifecycle.go`.
- **`widget_status`** holds only the latest value per `(applicationId, instanceId, key)`. See `db/database/migrate/migrations/0011_widget_status.go` and `db/proto/v1/widget_status.proto`.

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

Every widget gets the same surface — there's no separate "alert overlay" component
anymore; the built-in alert widget (`media_alert`) is just another widget bundle
placed in a scene, using the exact same P1 `WidgetHost` contract as any module
widget. The contract lives in `shared/clients/typescript/module-sdk/src/widget-host.ts`;
see [Widget protocol (P1)](../woofwoofwoof/streamware/widget-protocol.md) for the
full postMessage handshake underneath it.

```typescript
interface WidgetHost {
  readonly moduleId: string;
  readonly instanceId: string;
  readonly settings: Readonly<Record<string, unknown>>;
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

Every widget — including `media_alert` — is served through the frame assembler into
a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) and talks to
the scene manager exclusively through the P1 postMessage protocol; there is no
direct property injection onto `iframe.contentWindow`. This is deliberate, not a
same-origin shortcut waiting to be replaced: widget assets can already be served
from barkloader or a CDN (see [Asset prefix rules](../woofwoofwoof/streamware/asset-prefix.md)),
and postMessage is what makes that origin-agnostic.

### The alert widget's instance id convention

Alert routing (the dispatch rule above) is keyed on the **scene instance id**, not on
a dedicated component type: a `media_alert` widget placed in a scene must be given
the instance id `"alert-overlay"` (the `id` field of its entry in the scene's
`widgetsJson`) for its `alert.lifecycle` status reports to route to the
[event queue](../streamware/alert-queue.md) instead of falling through to generic
`widget_status` upserts. The dispatch condition checks only `key` and `instanceId` —
not `moduleId` — so this is purely a scene-authoring convention, not something the
engine validates. Built-in widgets like `media_alert` use the reserved module key
`"builtin"` (`BUILTIN_MODULE_KEY` in `streamware/src/overlay/scene-host.ts`). Any
instance id other than `"alert-overlay"` — even another `media_alert` placement — is
treated as a generic status report.

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
