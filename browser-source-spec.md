# WoofX3 Engine — Browser Source & OBS Webhook Spec

## Overview

The WoofX3 engine is the source of truth for **when** alerts and OBS automations should fire. It does not know **how** they are rendered or **how** they map to specific OBS sources/scenes. Both responsibilities belong to the Convex UI app — see `woofx3-ui/browser-source-spec.md`.

This spec covers the engine-side contract: event detection, payload shape, and webhook delivery to Convex. Once a webhook is accepted by Convex, the engine has no further role in the lifecycle of that alert or command.

---

## System Boundary

```
woofx3 engine (NATS internal)
    ↓
woofx3 public API service
    ↓  webhook POST
[ Convex HTTP action ]   ← UI repo handles everything past this point
```

The engine emits **logical intents**:

- An *alert event* describes what happened in the stream (raid, follow, donation).
- An *OBS command* is a logical automation request (e.g. `scene_transition`, target `"intro"`, action `"activate"`).

The engine never references OBS source names, scene names, slot names, layouts, descriptors, or rendering details. Those live in Convex scene config.

---

## Webhook Delivery

### Endpoint Configuration

- Each user has a configured Convex webhook URL, stored in the engine's settings.
- The engine POSTs to the URL when an alert/command intent is generated.
- Webhook URL and signing secret are managed by the Convex app and read by the engine via its config layer (`.woofx3.json` / env). The engine does not provide UI for setting them.

### Authentication

- Each request carries an `X-Woofx3-Signature` header (HMAC-SHA256 of the raw body using a per-user signing secret).
- Convex verifies the signature before accepting the payload. Mismatch → 401.

### Retry Semantics

- 5xx and connection errors → retry with exponential backoff (e.g. 1s, 5s, 30s, 5m, 30m), capped at 1h.
- 4xx → do not retry; log and drop.
- All retries reuse the same stable `eventId` — Convex deduplicates on receipt.

### Idempotency

- Every payload carries a stable `eventId` that does not change across retries.
- If the engine resends the same event (crash recovery, manual replay), Convex must treat it as a duplicate.

---

## Payload Shape

### Envelope

```
WebhookEnvelope
  eventId           string         — stable, globally unique
  channelId         string         — the user/channel this fires for
  emittedAt         number         — engine-side timestamp (ms epoch)
  kind              "alert" | "obs_command"
  payload           AlertContext | OBSCommand
```

### AlertContext

The data describing a stream event. Fields available to the UI's resolver pipeline at render time.

```
AlertContext
  type              string         — "raid" | "follow" | "donation" | ...
  user              string         — display name
  amount            number?        — viewers / bits / dollars depending on type
  message           string?        — optional accompanying text
  metadata          Record<string, any>?   — type-specific extras
```

The engine **owns** this shape. UI scene config addresses fields by name (`{user}`, `{amount}`) but never mutates the source. New event types extend the `type` enum; type-specific extras live under `metadata`.

### OBSCommand (Logical Intent)

```
OBSCommand
  id                string         — same as envelope.eventId for matching
  type              "scene_transition" | "source_visibility"
                  | "filter_state" | "audio_state" | "media_playback"
                  | "hotkey" | "transform"
  target            string         — logical name, e.g. "intro" / "main_cam"
  action            string         — "activate" | "show" | "hide" | "toggle"
                                   | "play" | "stop" | "set"
  params            Record<string, any>
  ttl               number         — seconds; if Convex/OBS Controller is offline
                                     longer than this, the command expires
  priority          number
```

Targets are **logical names** (e.g. `"intro"`). The mapping from `"intro"` to OBS scene `Intro Scene` lives in Convex platform action maps. The engine does not know the OBS-side names.

---

## Engine Health & Status

The engine exposes a health endpoint (`GET /health` on the public API service) the Convex app can poll to verify the engine is reachable. Optional: the engine can also emit a periodic synthetic `kind == "alert"` heartbeat for end-to-end pipeline verification — see "Active Health Check" in the UI spec.

---

## Out of Scope (Convex / UI Owns)

- Browser source URL, source keys, key rotation
- Scenes, slots, alert descriptors, layers, animations
- Resolvable values (tokens, expressions, hooks)
- Sandboxed hook execution
- Asset caching
- Queue management (stack / concurrent / interrupt)
- Alert state machine after webhook receipt (`pending` → `rendering` → `complete` etc.)
- Deduplication storage (Convex tracks rendered IDs)
- Alert history and replay
- Connection indicators
- Test/preview alerts (UI fires those without going through the engine)
- OBS websocket connection and OBS source/scene name mapping
- Platform action map (logical name → concrete OBS operation)
- OBS Controller client (browser dock or local tray)

---

## Engine ↔ UI Contract Summary

| Item | Owner |
|---|---|
| Decision to fire alert/automation | Engine |
| Stable `eventId` | Engine |
| Webhook delivery + retry + signing | Engine |
| `AlertContext` field shape | Engine |
| Logical `OBSCommand` schema | Engine |
| Logical → OBS name mapping | UI (Convex) |
| Alert/command state after receipt | UI (Convex) |
| All rendering, queueing, hooks | UI (Convex / browser source) |
| obs-websocket execution | UI (OBS Controller) |

Any change to the envelope, `AlertContext`, or `OBSCommand` shape is a breaking contract change and requires coordinated updates in `woofx3-ui`.

---

## Module Widgets (related contract)

Widgets are user-facing components placed on scene canvases by the Convex scene editor. They render alerts and module-supplied data inside browser sources. Widgets are exposed to the engine as a fourth module-extension surface alongside triggers, actions, and functions — barkloader modules declare them in their `manifest.json`, the engine persists registrations, and the UI consumes them via the existing webhook callback channel (Bearer auth, not the HMAC-signed alert/OBS channel).

### Two concepts — don't conflate

- **`WidgetDefinition`** (engine-owned) — a registered widget from a module's manifest. One row per `(module, manifestId)`. Projected to the UI via `module.widget.registered` / `module.widget.deregistered` webhook events.
- **`WidgetInstance`** (UI-owned) — a placement of a `WidgetDefinition` onto a specific scene, with position, size, and per-instance settings. Many instances can reference one definition. The engine never sees `WidgetInstance`.

### Webhook events

```
module.widget.registered
  moduleKey      string
  moduleName     string
  version        string
  widgets        WidgetDefinition[]

module.widget.deregistered
  moduleKey      string
  moduleName     string
  version        string
  widgets        WidgetDefinition[]
```

`WidgetDefinition` carries:

```
WidgetDefinition
  id              string                      — engine UUID
  canonicalId?    string                      — {moduleId}:widget:{manifestId}
  projectionKey?  string                      — {moduleKey}:widget:{manifestId}
  manifestId      string                      — stable manifest-local id
  name            string
  description?    string
  directory       string                      — path inside zip with widget assets
  alertTypes      string[]                    — AlertContext.type strings the widget renders
  settings        WidgetSettingDefinition[]   — UI-editable configuration surface
  createdByType   string
  createdByRef    string
```

`WidgetSettingDefinition` mirrors the UI's `moduleWidgets.settings` row shape: `{ key, fieldType, label, defaultValue, options? }`.

### Manifest authoring

A barkloader module declares widgets in its `manifest.json`:

```json
{
  "widgets": [
    {
      "id": "raid_counter",
      "name": "Raid Counter",
      "description": "Counts incoming raids.",
      "entry": "widgets/raid_counter/index.html",
      "assets": "widgets/raid_counter",
      "acceptedEvents": ["twitch_platform:trigger:raid.user.twitch"],
      "settingsSchema": {
        "fields": [
          { "key": "minViewers", "fieldType": "number", "label": "Minimum viewers", "defaultValue": 1 }
        ]
      }
    }
  ]
}
```

Engine-internal validation resolves `acceptedEvents` (canonical trigger ids) against the trigger graph at install time. The wire-format `alertTypes` is derived from `acceptedEvents` via the same NATS-subject → `AlertContext.type` mapping the api/ `AlertEmitter` uses (see `api/src/alert-emitter.ts`). Authors can override by declaring `alertTypes` directly when the derivation isn't right.

### Reference module

`barkloader/modules/scene_widgets/` ships a 3-widget reference pack — `recent_followers`, `raid_counter`, `alert_feed` — exercising single-event, multi-event, and styled / themed widget patterns. Use it as a template when writing new widget modules.

### Out of scope (UI owns)

- Scene-canvas placement (`WidgetInstance`)
- Per-instance settings storage (`scenes.widgets[]`)
- Slot binding + queue mode interactions
- Widget asset serving to OBS browser sources
- Live-update propagation when settings change at runtime
