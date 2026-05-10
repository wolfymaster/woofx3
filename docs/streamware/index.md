# Streamware

Streamware is the runtime that drives streaming overlays. It owns the WebSocket transport to browser-source overlays, the per-application alert queue, the unified widget event channel, and the OBS bridge for legacy chat-bot scene/source commands.

After the widget refactor, streamware is also where alert orchestration lives. The api boundary publishes nothing on `widget.*` and runs no queue — it only projects db-proxy outbox events to outbound webhooks. Workflow alert intent and overlay reports both land in streamware; the api sees only the resulting db rows via the outbox channel.

## What it owns

| Responsibility | Where it lives |
|----------------|----------------|
| `/ws/alerts` WebSocket — alert overlay connection | `streamware/src/alert-broadcaster.ts` |
| `/ws/module-state` WebSocket — scene overlay connection | `streamware/src/storage-broadcaster.ts` |
| Alert FIFO queue with lease semantics | `streamware/src/alert-queue-manager.ts` |
| Inbound widget event dispatcher | `streamware/src/widget-event-handlers.ts` |
| Operator NATS request/reply (`widget.queue.skip|clear|replay`) | `streamware/src/widget-event-handlers.ts` |
| Slim db-proxy gRPC client (alerts + widget_status only) | `streamware/src/db.ts` |
| The shared widget-host contract injected into iframes | `streamware/ui/src/lib/widgetHost.ts` |
| Alert overlay React component | `streamware/ui/src/AlertOverlay.tsx` |
| Scene overlay React component (composes widget iframes) | `streamware/ui/src/SceneOverlay.tsx` |

## Architecture

```
Workflow                                             Browser overlay
   |                                                          |
   | publish ui.notify.alert (envelope w/ stable id)          |
   v                                                          |
NATS ─── ui.notify.alert ─────────────────┐                   |
                                          v                   |
                          streamware/src/widget-event-handlers.ts
                                          |
                              ┌───────────┴───────────┐
                              v                       v
                  AlertQueueManager.enqueue   db.createAlert
                              |
              one alert per app at a time
                              |
                              v
                     publish ui.alert.broadcast
                              |
                              v
              streamware/src/alert-broadcaster.ts
                              |
                              v
              ws.send to every /ws/alerts client ─────────┐
                                                          |
                                                          v
                                                AlertOverlay.tsx
                                                          |
                                                          | host.reportStatus(
                                                          |   "alert.lifecycle",
                                                          |   { envelopeId, state }
                                                          | )
                                                          |
                                                          v
                                                ws.send /ws/alerts (widget.event)
                                                          |
                                                          v
                                            publish widget.event (CloudEvents)
                                                          |
                                                          v
                                            widget-event-handlers.ts
                                                  (dispatches by data.key)
                                                  /                 \
                                                 v                   v
                                  AlertQueueManager         db.upsertWidgetStatus
                                  .handleStatus              (widget_status)
```

## Configuration

Loaded from `.woofx3.json` plus environment-variable overrides. See `streamware/src/config.ts`.

| Variable | Default | Description |
|----------|---------|-------------|
| `WOOFX3_STREAMWARE_PORT` | `9700` | HTTP / WS server port |
| `WOOFX3_DATABASE_PROXY_URL` | -- | Required for alert orchestration. Without it, `/ws/alerts` still works as a passthrough, but alert envelopes are not persisted and the queue is disabled. |
| `WOOFX3_MESSAGEBUS_URL` | -- | NATS URL. Without it, streamware logs a warning and runs in offline mode (overlays receive nothing). |

## HTTP routes

| Path | Purpose |
|------|---------|
| `GET /health` | Liveness probe — `{ status: "ok", overlayClients: <n> }` |
| `GET /ws/alerts` | WebSocket upgrade for the alert overlay |
| `GET /ws/module-state` | WebSocket upgrade for scene overlays |
| `GET /overlay/alerts` | SPA shell for the alert overlay (browser source URL) |
| `GET /overlay/scene` | SPA shell for the scene overlay (browser source URL) |
| `GET /` and other paths | Static SPA assets |

## Read more

- [Alert queue](./alert-queue.md) — lease semantics, advance-on-timeout policy, operator controls.
- [Substitutions](./substitutions.md) — the `{primary}` color tag and the `{…}` expression resolver that runs at render time.
- [Widget event channel](../services/widget-events.md) — wire format and dispatch rules for `widget.event`.
- [Module format](../barkloader/modules.md#widget-entry-widgets) — how a manifest declares a widget and what `widgetHost` exposes to its code.
- [Workflow expressions](../workflow/expressions.md) — the upstream `${…}` resolver that runs before alerts reach streamware.
