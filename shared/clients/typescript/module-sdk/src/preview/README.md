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
  `twitch_platform:trigger:follow.user.twitch`), the event payload
  JSON, and click **Fire onEvent**. The widget's `widgetHost.onEvent`
  handler runs synchronously.
- **Log panel** (bottom right) — every `host.reportStatus` /
  `host.reportComplete` call, every `console.{log,warn,error}` from the
  iframe.

The harness makes the iframe sandboxed (`allow-scripts
allow-same-origin`) — same as the real streamware shell — so widget
code that depends on the sandboxing constraints behaves the same way
in preview.

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
  type: "twitch_platform:trigger:follow.user.twitch",
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
- `fireEvent(event)` — synchronous dispatch to every `onEvent`
  subscriber.
- `setStorage(key, value)` — fires `storage.subscribe` callbacks for
  matching keys.
- `onReport(handler)` — taps every `reportStatus` / `reportComplete`
  call.
- `install()` — assigns `host` to `globalThis.window.widgetHost`,
  returns an uninstall.
- `reset()` — drops every subscriber + clears the storage cache.

The mock contract mirrors the real `createWidgetHost` factory in
`streamware/ui/src/lib/widgetHost.ts` exactly — same fire-on-subscribe
semantics, same return shapes. A widget that runs against the mock
behaves identically against streamware.
