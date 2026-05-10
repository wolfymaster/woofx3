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

The overlay sends the canonical wire shape (`OverlayWidgetEvent`) over its WebSocket. Both `/ws/alerts` and `/ws/module-state` accept it. See `streamware/ui/src/lib/widgetHost.ts:96` and `streamware/src/widget-event-wire.ts:10`.

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

`streamware/src/widget-event-wire.ts:33` (`publishWidgetEvent`) validates the message, wraps it in a CloudEvents 1.0 envelope, and republishes to NATS `widget.event`. The CloudEvent `data` field carries the same fields, with `ts` renamed to `occurredAt` to match the rest of the engine's CloudEvent payloads.

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

`streamware/src/widget-event-handlers.ts:161` subscribes to `widget.event` and dispatches by `data.key`:

| Condition | Handler | Persistence |
|-----------|---------|-------------|
| `key === "alert.lifecycle"` AND `instanceId === "alert-overlay"` | `AlertQueueManager.handleStatus(applicationId, envelopeId, state, error?)` | `alerts` table — lifecycle column on the existing row keyed by `envelope_id` |
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

Every widget gets the same surface, regardless of whether it's a sandboxed iframe widget or a host-rendered React component. The contract lives in `streamware/ui/src/lib/widgetHost.ts:26`.

```typescript
interface WidgetHost {
  readonly moduleId: string;
  readonly instanceId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly storage: WidgetHostStorage;     // get / subscribe over module storage

  reportStatus(key: string, value: unknown): void;
  reportComplete(reason?: string): void;   // sugar for reportStatus("complete", { reason })
}
```

`reportStatus` and `reportComplete` are best-effort. They never throw; if no transport is wired (the iframe was instantiated outside the streamware shell), reports log a single warning and are dropped.

### Iframe widgets

`streamware/ui/src/components/WidgetFrame.tsx:46` constructs a `WidgetHost` and assigns it to `iframe.contentWindow.widgetHost` once the iframe load event fires. Widgets read `window.widgetHost` directly. The cross-origin assumption today is same-origin (local mode); when assets move to a CDN, this injection point switches to a postMessage bridge — flagged inline at the call site.

### The alert overlay

`streamware/ui/src/AlertOverlay.tsx:44` is itself a widget host. It creates a `WidgetHost` with `moduleId: "core"`, `instanceId: "alert-overlay"`, no storage, and the `/ws/alerts` socket as its transport. The overlay calls `host.reportStatus("alert.lifecycle", { envelopeId, state })` on mount, on completion, and on render failure — exactly the same way a counter widget calls `host.reportStatus("count", 42)`.

This is what the dispatch rule above is enforcing: the alert overlay gets routed to the queue manager because its `(moduleId, instanceId, key)` triple matches `("core", "alert-overlay", "alert.lifecycle")`. Everything else falls through to `widget_status`.

## End-to-end flow

```
Widget code                                  Streamware shell
   |                                            |
   v                                            v
host.reportStatus(key, value)        WidgetHost.emit
   |                                            |
   |--------- WidgetStatusReport ─────────────->|
                                                |
                                                v
                                  ws.send(/ws/{alerts|module-state})
                                                |
                                                v
                                       publishWidgetEvent()
                                                |
                                                v
                                     NATS publish "widget.event"
                                                |
                                                v
                                     widget-event-handlers.ts
                                       /                  \
                                      v                    v
                              AlertQueueManager      db.upsertWidgetStatus
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
