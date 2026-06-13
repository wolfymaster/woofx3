# P2 Event Source — `woofx3.overlay-events` v1

P2 is the push channel that carries backend events from streamware to the scene
manager running in the browser. It is called P2 to distinguish it from P1 (the
`woofx3.widget` postMessage channel between the scene manager and widget iframes).

## Overview

The scene manager connects to the P2 channel at startup and receives frames for all
events that should reach the current overlay: storage changes, widget events, scene
config updates, and control signals.

Two transports implement the same `SceneEventSource` interface:

- `WebSocketEventSource` — default; connects to `./events` relative to the overlay
  shell URL, which resolves through the api proxy unchanged.
- `ParentFrameEventSource` — activated by appending `?eventSource=parent` to the
  overlay URL; used when an embedding page (e.g. Convex UI) wants to drive events
  from its own state rather than the engine WebSocket.

Both transports are in `streamware/ui/src/lib/eventSource.ts`.

## Protocol envelope

Every P2 message is a JSON object with the following outer shape:

```json
{
  "proto": "woofx3.overlay-events",
  "v": 1,
  "frame": { ... }
}
```

The `frame` field is the typed payload. An `isOverlayEventsEnvelope` guard in
`shared/clients/typescript/api/overlay-events.ts` validates the outer shape before
the scene manager dispatches on `frame.kind`.

## Frame types

| `frame.kind` | Direction | Description |
|---|---|---|
| `storage` | server → client | A module storage key changed. |
| `event` | server → client | A trigger event for widgets with matching `acceptedEvents`. |
| `scene.updated` | server → client | The scene config changed; scene manager re-fetches `./config`. |
| `control` | server → client | A control signal (`token.revoked`, `reconnect`). |
| `widget.event` (upstream) | client → server | Widget status report forwarded to NATS `widget.event`. |

### `storage` frame

```json
{
  "kind": "storage",
  "moduleId": "spotify_sr",
  "key": "current_track",
  "value": { "title": "...", "artist": "..." },
  "occurredAt": "2026-06-12T10:00:00.000Z"
}
```

The scene manager looks up all `WidgetBridge` instances subscribed to `(moduleId, key)`
and calls `bridge.sendStorageChanged(subId, key, value, occurredAt)` for each.

### `event` frame

```json
{
  "kind": "event",
  "type": "twitch_platform:trigger:follow.user.twitch",
  "source": "twitch",
  "time": "2026-06-12T10:00:00.000Z",
  "data": { "username": "someviewer" }
}
```

The scene manager matches `type` against each widget's `acceptedEvents` list and
delivers the event only to matching bridges via `event.deliver` (P1).

### `scene.updated` frame

```json
{
  "kind": "scene.updated",
  "sceneId": "scene-abc-123",
  "revision": 1718186400000
}
```

On receipt, the scene manager calls `refetchConfig()` which re-fetches `./config` and
re-renders the layout with updated instances. Widget bridges for unchanged instances
are preserved.

### `control` frame

```json
{ "kind": "control", "action": "token.revoked" }
```

`token.revoked` causes the scene manager to transition to the `revoked` render state
(blank screen). The WebSocket is closed by the server immediately after sending this
frame.

## WebSocketEventSource (default)

Connects to `./events` relative to the overlay shell URL. Because all URLs in the
overlay are relative, the WebSocket URL resolves correctly through any number of
proxy layers — the api proxy, a Convex proxy, or a tunnel — without any hardcoded
origin.

On disconnect, the source reconnects with exponential backoff. When reconnection
succeeds after having been previously connected, the `onReconnected()` sink callback
fires. The scene manager reacts to this by:

1. Re-fetching `./config` to pick up any scene changes that occurred during the gap.
2. Treating its storage cache as stale — the next `storage.changed` delivery for a
   given key takes precedence over any cached value.

## ParentFrameEventSource (`?eventSource=parent`)

Activated when the overlay URL includes `?eventSource=parent`. Intended for embedding
the overlay in an outer page (e.g. the Convex UI or a custom dashboard) that wants to
drive events programmatically instead of going through the engine WebSocket.

### Attach handshake

After the scene manager mounts, the event source posts an `attach.ready` message to
`window.parent`:

```json
{ "proto": "woofx3.overlay-events", "v": 1, "frame": { "kind": "attach.ready" } }
```

The embedding page replies with `attach.ack`. Only after receiving `attach.ack` does
the source accept inbound `frame` messages — and only from `event.source === window.parent`.

```json
{ "proto": "woofx3.overlay-events", "v": 1, "frame": { "kind": "attach.ack" } }
```

After the handshake, the embedding page sends the same frame types as the WebSocket
transport (`storage`, `event`, `scene.updated`, `control`). The scene manager handles
them identically regardless of which transport delivered them.

Messages from any `event.source` other than `window.parent` are dropped after the
handshake. Before the handshake, all messages are dropped.

## NATS → P2 fan-out

Streamware subscribes to these NATS subjects and converts them to P2 frames:

| NATS subject | P2 frame produced |
|---|---|
| `module.storage.*.changed` | `storage` |
| `widget.event` (re-published from WS) | `event` (routed to overlay connections by applicationId) |
| `db.scene.updated.*` | `scene.updated` (routed by sceneId) |
| `db.overlay_token.updated.*` | `control: token.revoked` (after re-resolve confirms revocation) |

Fan-out to overlay WebSocket connections is keyed by `applicationId`
(`OverlayConnectionStore` in `storage-broadcaster.ts`): each connection carries
its `applicationId` as metadata attached at upgrade time, and events are delivered
only to connections matching the event's application context.
