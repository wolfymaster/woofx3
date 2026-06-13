# End-to-End Walkthrough: spotify_sr `now_playing` widget

This page traces the complete path from module installation to a live overlay in OBS,
using the `spotify_sr` module's `now_playing` widget as a concrete example.

## 1. Install the module

Barkloader receives the `spotify_sr` ZIP archive and processes its manifest. The
manifest declares a `now_playing` widget with a polling background task:

```json
{
  "id": "spotify_sr",
  "widgets": [
    {
      "id": "now_playing",
      "name": "Now Playing",
      "entry": "index.html",
      "assets": "widgets/now_playing/",
      "settingsSchema": {},
      "acceptedEvents": []
    }
  ],
  "backgroundTasks": [
    {
      "id": "spotify_poll",
      "intervalSecs": 30,
      "handler": "poll_spotify"
    }
  ]
}
```

On install, barkloader:

- Copies all files under `widgets/now_playing/` into the asset repository at
  `modules/spotify_sr/widgets/now_playing/`.
- Registers the widget definition via db-proxy (writes to the `module_widgets` table).
- Publishes `module.widget.registered` on NATS.
- Schedules the `spotify_poll` background task with a 30-second interval.

The widget canonical id becomes `spotify_sr:widget:now_playing`. The `entry` field
(`index.html`) is relative to the asset root and is resolved by the frame assembler
at request time.

## 2. Create a scene

Call the api with a scene definition. The `widgetsJson` array contains one widget
instance:

```json
POST api → createScene({
  name: "My Overlay",
  widgetsJson: "[{\"id\":\"wp1\",\"widgetCanonicalId\":\"spotify_sr:widget:now_playing\",\"moduleId\":\"spotify_sr\",\"position\":{\"x\":0,\"y\":0,\"width\":400,\"height\":150},\"settings\":{},\"acceptedEvents\":[]}]"
})
→ { sceneId: "scene-abc-123" }
```

The `id` field (`wp1`) is the stable instance id for this placement. The `position`
block places the widget at (0, 0) with a 400×150 pixel bounding box.

## 3. Mint an overlay token

```
POST api → mintOverlayToken({ sceneId: "scene-abc-123", label: "OBS main" })
→ {
    tokenId: "tok_...",
    token: "ovl_xxxxx...",
    url: "http://127.0.0.1:9100/overlay/ovl_xxxxx.../"
  }
```

The returned `url` is the browser-source URL. Copy it directly into OBS.

## 4. Add to OBS

In OBS Studio: **Add Source → Browser**, paste the URL. OBS loads it as a browser
source. The overlay is 400×150 pixels (or whatever the scene canvas size is).

## 5. What happens when OBS loads the URL

### a. API proxy

OBS issues `GET http://127.0.0.1:9100/overlay/ovl_xxxxx.../`.

The api strips the `/overlay/{token}` prefix and reverse-proxies to:

```
GET http://127.0.0.1:9101/o/ovl_xxxxx.../
```

Streamware never receives connections directly from OBS.

### b. SPA shell delivery

Streamware serves the scene manager SPA shell (the React app built from
`streamware/ui`). The shell is a static HTML document that loads the React bundle.
All asset URLs in the bundle are relative so they resolve through the api proxy
unchanged.

### c. Config fetch

The React app mounts `SceneOverlay`. It detects token mode (URL path matches
`/o/{token}/`) and fetches `./config`.

Streamware resolves the token via `OverlayTokenResolver` (30-second TTL cache, backed
by db-proxy). The config response includes one widget instance:

```json
{
  "scene": {
    "sceneId": "scene-abc-123",
    "name": "My Overlay",
    "layout": {},
    "instances": [
      {
        "id": "wp1",
        "widgetCanonicalId": "spotify_sr:widget:now_playing",
        "moduleId": "spotify_sr",
        "manifestId": "now_playing",
        "position": { "x": 0, "y": 0, "width": 400, "height": 150 },
        "settings": {},
        "acceptedEvents": [],
        "frameUrl": "./frame/wp1"
      }
    ]
  }
}
```

The `frameUrl` field (`./frame/wp1`) is derived by the server — it is never stored.

### d. Scene manager mounts the widget iframe

`SceneOverlay` renders one `<WidgetFrame>` for instance `wp1`. `WidgetFrame` generates
a per-mount nonce and creates a `WidgetBridge`. The iframe `src` is set to:

```
./frame/wp1?nonce=<base64url-16-bytes>
```

The iframe element is:

```html
<iframe
  src="./frame/wp1?nonce=abc123..."
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  style="position:absolute; left:0; top:0; width:400px; height:150px; border:none;"
/>
```

### e. Frame assembly

The iframe request reaches streamware at `/o/{token}/frame/wp1?nonce=abc123...`.

`FrameAssembler.assemble()`:

1. Resolves the token → scene config, locates instance `wp1`.
2. Looks up the widget definition for `spotify_sr:widget:now_playing` in the widget
   catalog (30-second cache, backed by db-proxy `listWidgets`).
3. Fetches `now_playing/index.html` from barkloader:
   ```
   GET http://127.0.0.1:3005/assets/modules/spotify_sr/widgets/now_playing/index.html
   ```
4. Validates and sanitizes the `entry` path through the traversal pipeline.
5. Builds the boot payload:
   ```json
   {
     "v": 1,
     "nonce": "abc123...",
     "instanceId": "wp1",
     "moduleId": "spotify_sr",
     "widgetCanonicalId": "spotify_sr:widget:now_playing",
     "settings": {},
     "capabilities": ["storage", "events", "status"]
   }
   ```
6. Injects the scaffold into `now_playing/index.html`:
   ```html
   <head>
     <script>window.__WOOFX3_WIDGET_BOOT__ = { ... };</script>
     <script src="../assets/widget-host-shim.js"></script>
     <base href="../widget-assets/spotify_sr/now_playing/">
     <!-- rest of original <head> -->
   ```
7. Returns the assembled document with `Referrer-Policy: no-referrer`,
   `Cache-Control: no-store`.

### f. Shim install and handshake

The iframe loads the assembled document. The boot payload global is set synchronously
before any widget code runs. The shim script (`widget-host-shim.js`) loads, reads
`window.__WOOFX3_WIDGET_BOOT__`, and installs `window.widgetHost`.

The shim immediately posts `hello` to `window.parent`:

```json
{ "proto": "woofx3.widget", "v": 1, "type": "hello", "nonce": "abc123...", "moduleId": "spotify_sr" }
```

`WidgetBridge.handleMessage` in the parent verifies the `nonce` matches, confirms
`v === 1`, records the `moduleId`, and replies with `init`:

```json
{ "proto": "woofx3.widget", "v": 1, "type": "init", "nonce": "abc123...", "settings": {}, "capabilities": ["storage","events","status"], "acceptedEvents": [] }
```

The handshake is complete. `window.widgetHost` is now live.

### g. Storage subscription

The `now_playing` widget's IIFE calls:

```javascript
window.widgetHost.storage.subscribe("current_track", (track) => {
  renderTrack(track);
});
```

The shim posts a `storage.subscribe` message to the parent:

```json
{ "proto": "woofx3.widget", "v": 1, "type": "storage.subscribe", "nonce": "abc123...", "subId": "sub_1", "moduleId": "spotify_sr", "key": "current_track" }
```

`WidgetBridge.handleMessage` routes this to `onStorageSubscribe`, which calls
`SceneManager.addStorageSubscription("bridge-wp1", "spotify_sr", "current_track")`.
The scene manager records that bridge `wp1` is subscribed to `(spotify_sr, current_track)`.

If the scene manager already holds a cached value for `current_track`, it immediately
delivers it back to the widget via a `storage.changed` message. The widget renders
with the cached state before any new data arrives.

### h. P2 WebSocket connect

Simultaneously, `WebSocketEventSource` connects to `./events` (relative to the overlay
shell URL). Streamware upgrades this as an overlay WebSocket, attaching
`{ token, applicationId, sceneId }` as connection metadata. The connection is
registered in `OverlayConnectionStore` under `applicationId`.

## 6. Reactive storage update

The spotify_sr background task fires every 30 seconds. It writes the `current_track`
key to BadgerDB via db-proxy, which triggers the module storage outbox event. Barkloader
publishes `module.storage.spotify_sr.changed` on NATS.

Streamware's NATS subscription on `module.storage.*.changed` receives the message,
maps it to a P2 `storage` frame, and pushes it to all overlay WebSocket connections
for the matching `applicationId`:

```json
{
  "proto": "woofx3.overlay-events",
  "v": 1,
  "frame": {
    "kind": "storage",
    "moduleId": "spotify_sr",
    "key": "current_track",
    "value": { "title": "Some Song", "artist": "Some Artist", "albumArt": "...", "progress": 42 },
    "occurredAt": "2026-06-12T10:00:30.000Z"
  }
}
```

The scene manager's `SceneManager.handleWindowMessage` receives the frame via the
event source sink and calls `deliverStorage("spotify_sr", "current_track", value)`.

The scene manager looks up subscriptions in its index, finds bridge `wp1` subscribed
to `(spotify_sr, current_track)`, and calls `bridge.sendStorageChanged(subId, key, value, occurredAt)`.

The bridge posts to the iframe:

```json
{ "proto": "woofx3.widget", "v": 1, "type": "storage.changed", "nonce": "abc123...", "subId": "sub_1", "key": "current_track", "value": { ... }, "occurredAt": "..." }
```

The shim's message listener fires the callback registered by the widget. The widget
re-renders with the new album art and progress bar.

## 7. Revoking the token

```
POST api → revokeOverlayToken({ tokenId: "tok_..." })
```

1. Db-proxy tombstones the `overlay_tokens` row.
2. Db-proxy publishes `db.overlay_token.updated.{appId}` on NATS.
3. Streamware receives the NATS event, calls `resolver.invalidateAll()` to poison the
   token cache.
4. Streamware iterates all live overlay WebSocket connections, re-resolves each token.
   The revoked token resolves to `null`.
5. Streamware sends the P2 control frame to the affected socket:
   ```json
   { "proto": "woofx3.overlay-events", "v": 1, "frame": { "kind": "control", "action": "token.revoked" } }
   ```
   Then closes the socket with close code 1008.
6. The scene manager's `onControlFrame("token.revoked")` callback fires. The overlay
   transitions to `{ status: "revoked" }` render state: a blank
   `<div data-state="revoked">`.
7. The scene `scene-abc-123` is untouched. Mint a new token for the same scene to
   produce a new working browser-source URL.
