# Widget preview harness

Two ways to use the mock widget host that ships in this directory:

## 1. Standalone HTML harness

Open `widget-preview.html` in a browser, point it at any widget bundle:

```bash
# After installing the SDK
open node_modules/@woofx3/module-sdk/src/preview/widget-preview.html?widget=file:///path/to/my-widget/index.html
```

Or paste the URL into the input at the top of the panel and click
**Load**. The page renders three regions:

- **Stage** (left) — your widget loaded inside an iframe with
  `window.widgetHost` already mocked.
- **Identity / settings** — change the moduleId, instanceId, or
  per-instance settings JSON. **Apply & reload** re-injects with the
  new values.
- **Fire event** — type a canonical trigger id (e.g.
  `twitch_platform:trigger:follow.channel.twitch`), the event payload
  JSON, and click **Fire onEvent**. The widget's `widgetHost.onEvent`
  handler runs synchronously.
- **Log panel** (bottom right) — every `host.reportStatus` /
  `host.reportComplete` call, every `console.{log,warn,error}` from the
  iframe.

The harness sandboxes the iframe with `allow-scripts allow-same-origin`
so it can hand the frame its mock host. A frame on stream is stricter:
`allow-scripts` only, so it runs with an opaque origin and a
`connect-src 'none'` policy, and talks to its host by `postMessage`.
Code that fetches or reaches into its parent can work here and fail on
stream; read files with `widgetHost.assets.load` instead.

### Cross-origin caveat

If the widget URL is on a different origin than the harness HTML,
`iframe.contentWindow.widgetHost = …` will throw. The harness logs the
failure and the widget renders without a host. Workaround: serve the
widget bundle from a local dev server on the same origin as the
harness (`bun --cwd my-widget serve`, etc.), or copy the harness next
to your bundle.

## 2. Programmatic mock

For unit tests, drive the host directly:

```ts
import { createMockHost } from "@woofx3/module-sdk";

const ctrl = createMockHost({
  moduleId: "follower_goal",
  instanceId: "test-instance",
  settings: { goal: 5, accent: "#fff" },
  storage: { count: 0 },
});

// Install onto window so widget code can read window.widgetHost.
const uninstall = ctrl.install();

// Run your widget bundle (import its main, call its bootstrap, etc.).
await import("./my-widget/main.js");

// Drive the widget by mutating storage / firing events.
ctrl.setStorage("count", 3);
ctrl.fireEvent({
  type: "twitch_platform:trigger:follow.channel.twitch",
  source: "twitch",
  time: new Date().toISOString(),
  data: { userName: "alice" },
});

// Inspect what the widget reported.
const reports: any[] = [];
ctrl.onReport((r) => reports.push(r));

// Clean up.
uninstall();
```

`MockHostController` exposes:

- `host` — the `WidgetHost` object (assign to `window.widgetHost` or
  pass into your widget directly).
- `fireEvent(event)` — an event arrives for the placement. It goes to the
  newest `onEvent` subscription only, through that subscription's queue:
  `maxInFlight` events open at once (1 by default), each completed when
  the handler returns unless `autoComplete` is `false`, and completed
  anyway if the handler throws. An event id already delivered is dropped,
  and an event with no subscription to take it is lost.
- `setStorage(key, value)` — changes the key on the engine and fires
  `storage.subscribe` callbacks for it.
- `setSettings(settings)` — replaces `host.settings`, as an edit in the
  scene editor would.
- `onReport(handler)` — taps every `reportStatus` / `reportComplete`
  call.
- `onComplete(handler)` — taps every event the widget completes, by id.
- `install()` — assigns `host` to `globalThis.window.widgetHost`,
  returns an uninstall.
- `reset()` — drops every subscriber, queued event and storage value.

Storage behaves as on stream: `storage.get` answers `null` until the
widget has subscribed to the key, and a subscriber is called back with
the key's value (`null` when it holds none) once it has been read. A
mock created without the `storage` capability gives the widget no
storage at all, like an alert frame.

The mock is held to the same behavior as the real host (the widget host
shim and the scene manager's overlay page) by a contract suite that runs
the same cases against both: `sceneManager/tests/widget-host-contract`.
A widget that runs against the mock behaves the same on stream. Left
out: reconnects and redelivery, queue timeouts (`retryTimeoutMs`), and
`priorityExpr` ordering.
