# Streamware

Streamware is the runtime that drives streaming overlays. It renders the SPA shell and
assembles widget frames that OBS browser sources load, owns the P1 (`woofx3.widget`)
and P2 (`woofx3.overlay-events`) protocols, and runs the per-application event queue.
It also carries a legacy NATS subject for chat-bot scene/source commands
(`streamware/src/nats-subscriptions.ts:92`).

Every overlay is addressed by an unguessable token (never the raw scene id), served
through the woofx3 api proxy so streamware itself is never reachable from outside the
engine. See [Streamware — Overlay Architecture](../woofwoofwoof/streamware/index.md)
for the full token/frame/protocol picture — this page covers the event queue and
render-time substitutions, which sit alongside that architecture unchanged.

## What it owns

| Responsibility | Where it lives |
|----------------|----------------|
| Overlay SPA shell + scene config + frame assembly (`/o/{token}/**`) | `streamware/src/server.ts`, `streamware/src/overlay/` |
| Per-application event queue (FIFO + lease semantics) | `streamware/src/events/queue-manager.ts` |
| Inbound `widget.event` dispatcher (status acks, operator commands) | `streamware/src/events/handlers.ts` |
| Outbound event fan-out (`ui.alert.broadcast`, storage, scene updates) | `streamware/src/nats-subscriptions.ts`, `streamware/src/storage/broadcaster.ts` |
| Slim db-proxy gRPC client (alerts + widget_status only) | `streamware/src/db.ts` |
| P1 parent-side bridge + scene manager | `streamware/ui/src/lib/widgetBridge.ts`, `streamware/ui/src/SceneOverlay.tsx` |
| Built-in `media_alert` widget (static HTML, own substitution logic) | `streamware/public/widgets/builtin/media_alert/index.html` |

The api boundary publishes nothing on `widget.*` and runs no queue — it only projects
db-proxy outbox events to outbound webhooks. Workflow alert intent and overlay reports
both land in streamware; the api sees only the resulting db rows via the outbox channel.

## Architecture

```
Workflow                                             Browser overlay
   |                                                          |
   | publish ui.notify.alert (envelope w/ stable id)          |
   v                                                          |
NATS ─── ui.notify.alert ─────────────────┐                   |
                                          v                   |
                          streamware/src/events/handlers.ts
                                          |
                              ┌───────────┴───────────┐
                              v                       v
                  EventQueueManager.enqueue   db.createAlert
                              |
              one alert per app at a time
                              |
                              v
                     publish ui.alert.broadcast
                              |
                              v
              streamware/src/nats-subscriptions.ts
                              |
                              v
              P2 `event` frame → every overlay WS connection ──┐
                                                                |
                                                                v
                                                       media_alert widget
                                                                |
                                                                | widgetHost.reportStatus(
                                                                |   "alert.lifecycle",
                                                                |   { envelopeId, state }
                                                                | )
                                                                v
                                              P1 status.report → P2 widget.event (upstream)
                                                                |
                                                                v
                                            publish widget.event (CloudEvents)
                                                                |
                                                                v
                                            streamware/src/events/handlers.ts
                                                  (dispatches by data.key)
                                                  /                 \
                                                 v                   v
                                  EventQueueManager         db.upsertWidgetStatus
                                  .handleStatus              (widget_status)
```

## Configuration

Loaded from `.woofx3.json` plus environment-variable overrides. See `streamware/src/config.ts`.

| Variable | Default | Description |
|----------|---------|-------------|
| `WOOFX3_STREAMWARE_PORT` | `9700` | HTTP / WS server port |
| `WOOFX3_DATABASE_PROXY_URL` | -- | Required for alert orchestration and overlay token resolution. |
| `WOOFX3_MESSAGEBUS_URL` | -- | NATS URL. Without it, streamware logs a warning and runs in offline mode (overlays receive nothing). |
| `WOOFX3_WIDGET_ASSET_BASE_URL` | -- | Optional CDN override for widget assets — see [Asset prefix rules](../woofwoofwoof/streamware/asset-prefix.md). |

## HTTP routes

The only overlay-serving surface is the token-scoped tree under `/o/{token}/**`
(`streamware/src/server.ts:178-376`); the legacy `/ws/alerts` and `/ws/module-state`
routes documented here previously were removed when the overlay-token architecture
replaced them (see the architecture doc linked above).

| Path | Purpose |
|------|---------|
| `GET /health` | Liveness probe |
| `GET /o/{token}/` | SPA shell (React, served from `streamware/ui` dist) |
| `GET /o/{token}/config` | Scene config JSON (token → scene) |
| `GET /o/{token}/frame/{instanceId}?nonce=...` | Assembled widget frame |
| `GET /o/{token}/widget-assets/{moduleKey}/{manifestId}/**` | Proxied to barkloader `GET /assets/modules/...` |
| `GET /o/{token}/assets/widget-host-shim.js` | The P1 shim IIFE |
| `GET /o/{token}/events` | P2 WebSocket (`woofx3.overlay-events` v1) |

## Read more

- [Overlay architecture](../woofwoofwoof/streamware/index.md) — tokens, P1/P2 protocols, frame assembly, target-state diagram.
- [Event queue](./alert-queue.md) — lease semantics, advance-on-timeout policy, operator controls.
- [Substitutions](./substitutions.md) — the `media_alert` widget's render-time substitution pass.
- [Widget event channel](../services/widget-events.md) — wire format and dispatch rules for `widget.event`.
- [Module format](../barkloader/modules.md#widget-entry-widgets) — how a manifest declares a widget and what `widgetHost` exposes to its code.
- [Workflow expressions](../workflow/expressions.md) — the upstream `${…}` resolver that runs before alerts reach streamware.
