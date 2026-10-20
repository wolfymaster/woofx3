# Mock widget host

`createMockHost` is a `widgetHost` for unit-testing widget code without a
browser frame. To see a widget run in a browser against the real host (the
frame document, shim, bridge and event queue an overlay uses), preview its
module with `woofx3-widget-preview` from the widget-host package
(`shared/clients/typescript/widget-host/README.md`).

Drive it from a test:

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
