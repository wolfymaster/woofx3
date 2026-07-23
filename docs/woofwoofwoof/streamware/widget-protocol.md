# Widget Protocol (P1) — `woofx3.widget` v1

P1 is the postMessage protocol between a sandboxed widget iframe and its parent scene
manager. The wire types are the single source of truth for both sides and live in
`shared/clients/typescript/module-sdk/src/widget-protocol.ts`.

## Why postMessage

Widget bundles are served from barkloader's asset origin, which is different from the
streamware SPA origin. Same-origin property injection into `iframe.contentWindow` does
not work across origins. Every message flows through `postMessage` and is authenticated
by the per-frame nonce, making widget serving origin-agnostic.

## Protocol identifier and version

```typescript
WIDGET_PROTOCOL = "woofx3.widget"
PROTOCOL_VERSION = 1
```

Every message carries both. The parent drops messages with the wrong `proto` or an
unexpected `v` (after issuing `init.reject` on version mismatch).

## Boot payload

Before any postMessage exchange, the frame assembler inlines the boot payload into the
assembled HTML document as:

```html
<script>window.__WOOFX3_WIDGET_BOOT__ = { ... };</script>
```

The global name is `__WOOFX3_WIDGET_BOOT__` (`WIDGET_BOOT_GLOBAL` in the protocol module).

```typescript
interface WidgetBootPayload {
  v: 1;
  nonce: string;           // per-frame CSPRNG value; every P1 message must echo it
  instanceId: string;      // stable per-placement id, e.g. "wp1"
  moduleId: string;        // module key, e.g. "spotify_sr"
  widgetCanonicalId?: string; // "{moduleId}:widget:{manifestId}"
  settings: Record<string, unknown>;  // from widgetsJson entry
  capabilities: string[];  // ["storage", "events", "status"]
}
```

`settings` is populated from the widget instance's `widgetsJson` entry so
`window.widgetHost.settings` is readable synchronously at IIFE time — preserving
source compatibility with existing widgets that access settings before any async code
runs.

## Widget canonical id parsing and version stripping

A scene instance's `widgetCanonicalId` (e.g. `spotify:1.0.0:df18e02:widget:now_playing`)
is parsed and normalized before it ever reaches the boot payload, in
`streamware/src/overlay/scene-host.ts`:

- `parseWidgetCanonicalId()` splits on the **last** `:widget:` marker rather than
  doing a naive 3-part split — `moduleKey` itself can contain colons for versioned
  modules, and an earlier split-on-every-colon implementation silently dropped such
  widgets (fixed by `b7176cc`).
- `stableModuleKeyFrom()` then strips any version/hash suffix from the module key —
  `spotify:1.0.0:df18e02` normalizes to `spotify` — so a scene placement survives
  module upgrades instead of pointing at a specific installed version. A `builtin`
  key (no colons) passes through unchanged.

The **normalized, version-stripped** module key is what lands in the boot payload's
`moduleId` and in the derived `<base>` href — not necessarily the versioned string
that may be stored in the scene's `widgetsJson`. If you're debugging why a widget's
`moduleId` looks different from what you stored, this normalization is why; check
the streamware logs for `normalizeInstance: stripping version from moduleKey`.

## Nonce flow

1. `WidgetFrame` generates a per-mount CSPRNG nonce (`generateNonce()`) and stores it
   in a ref that is stable for the component's lifetime.
2. The iframe `src` is set to `./frame/{instanceId}?nonce={nonce}`.
3. The frame assembler reads `?nonce` from the query string, validates it against
   `NONCE_PATTERN` (`/^[A-Za-z0-9_-]{1,256}$/`), and embeds it in the boot payload.
4. The shim reads the nonce from the boot payload and includes it in every outbound
   postMessage.
5. `WidgetBridge.handleMessage` drops any message whose nonce does not match the one
   the bridge was constructed with.

If the frame is loaded directly in a browser without a parent (e.g. for debugging),
the server generates a fresh nonce and embeds it in the boot payload. The frame renders
but cannot bind to a parent bridge.

## The `widget-host-shim.js` IIFE

The shim is a classic script (no `async`/`defer`) injected by the frame assembler
ahead of the widget's `<base>` tag:

```html
<script>window.__WOOFX3_WIDGET_BOOT__ = { ... };</script>
<script src="../assets/widget-host-shim.js"></script>
<base href="../widget-assets/spotify_sr/now_playing/">
```

Ordering is normative: the boot payload global must be set before the shim runs; the
shim script must resolve against the frame URL (not the `<base>`), so it precedes
`<base>`. The shim IIFE reads `window.__WOOFX3_WIDGET_BOOT__` synchronously, validates
it via `isWidgetBootPayload()`, installs `window.widgetHost`, and posts the first
`hello` message.

`window.widgetHost` after shim install has the same `WidgetHost` interface that widget
authors target:

```typescript
interface WidgetHost {
  readonly moduleId: string;
  readonly instanceId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly storage: WidgetHostStorage;   // get / subscribe
  onEvent(handler: (event: WidgetEvent) => void): () => void;  // wraps events.subscribe / event.deliver
  reportStatus(key: string, value: unknown): void;
  reportComplete(reason?: string): void;
}
```

Full contract and field-level documentation: `shared/clients/typescript/module-sdk/src/widget-host.ts`.

## iframe sandbox

```html
<iframe
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  ...
/>
```

`allow-scripts` is the only sandbox flag. `allow-same-origin` is deliberately absent:
granting it would allow the frame to escape the sandbox by accessing the parent DOM.
`referrerPolicy="no-referrer"` prevents the frame URL (which contains the overlay
token) from leaking in the `Referer` header of outbound requests made by the widget.

## Message table

All messages share the common envelope fields: `proto`, `v`, `type`, `nonce`.

### Widget → scene manager

| `type` | Description |
|---|---|
| `hello` | First message posted by the shim: `{ instanceId, sdkVersion, wants }`. `sdkVersion` is the `@woofx3/module-sdk` version the shim was built from; `wants` is the widget's declared capability list (`"storage"`, `"events"`, `"status"`) — informational only, the host does not gate on it today. Retried every 250 ms until `init` arrives. |
| `storage.get` | One-shot read: `{ id, moduleId, key }`. Replied with `storage.value`. |
| `storage.subscribe` | Open subscription: `{ subId, moduleId, key }`. Host delivers `storage.changed` on each change. |
| `storage.unsubscribe` | Cancel subscription: `{ subId, moduleId, key }`. |
| `events.subscribe` | Subscribe to accepted events: `{ subId, eventType }`. |
| `events.unsubscribe` | Cancel event subscription: `{ subId, eventType }`. |
| `status.report` | Widget calling `reportStatus(key, value)`: `{ key, value, ts }`. |
| `ping` | Liveness probe: `{ ts }`. Echoed as `pong`. |
| `pong` | Reply to a parent-initiated `ping`. |

### Scene manager → widget

| `type` | Description |
|---|---|
| `init` | Handshake acceptance: `{ settings, capabilities, acceptedEvents }`. In current code (`WidgetBridge.sendInit`, `streamware/ui/src/lib/widgetBridge.ts:206-213`) `capabilities` is always the hardcoded `["storage","events","status"]` and `acceptedEvents` is always `[]` — the instance's real `settings`/`acceptedEvents` (which `SceneManager` does resolve from scene config) are not threaded through to this message today. This is harmless in practice because event routing happens scene-manager-side via its own event index, not from the widget reading `init.acceptedEvents`, but don't rely on this field being populated. |
| `init.reject` | Handshake refusal (e.g. unsupported version): `{ reason, supportedVersions }`. Terminal — shim goes inert. |
| `storage.value` | Reply to `storage.get`: `{ id, key, value }`. |
| `storage.changed` | Storage subscription delivery: `{ subId, key, value, occurredAt }`. Also fired immediately after `storage.subscribe` when the host holds a cached value. |
| `event.deliver` | Event subscription delivery: `{ subId, event }`. `event` is a typed `WidgetEvent`. |
| `dispose` | Teardown: `{ reason }`. Shim drops all subscriptions and goes inert. |
| `ping` | Liveness probe. |
| `pong` | Reply to widget-initiated `ping`. |

## Handshake flow

```
Widget iframe                          Scene manager (WidgetBridge)
     |                                          |
     | hello (moduleId, nonce, v)               |
     |---------------------------------------->|
     |                                          | validates nonce + v
     |          init (settings, capabilities)   |
     |<-----------------------------------------|
     |                                          |
     | storage.subscribe (subId, moduleId, key) |
     |---------------------------------------->|
     |                                          | manager.addStorageSubscription(...)
     |    storage.changed (subId, key, value)   |
     |<-----------------------------------------| (if cached value exists)
     |                                          |
```

If the protocol version in `hello` does not match `PROTOCOL_VERSION`, the bridge
replies with `init.reject` carrying `supportedVersions: [1]`. The shim stops retrying
and the widget does not load.

Unknown `type` values are ignored by both sides (forward compatibility).
