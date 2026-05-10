# Module SDK

`@woofx3/module-sdk` is the type and dev-loop surface for module
authors. Without it, the runtime objects the engine injects into your
code (`ctx` for functions, `window.widgetHost` for widgets) are
unstructured `any` in your editor — you write blind. With it, you get
autocomplete, hover hints, type-checked widget code, and a local
preview harness for UI iteration.

## Why a package

Module code runs inside two host-managed environments:

- **Function sandbox** — Rust-hosted QuickJS (JS) or mlua (Lua). The
  host builds a `ctx` object per invocation and registers namespaces
  on it: `events`, `storage`, `http`, `env`, `resources`, plus any
  extensions the engine deployment wired up (`twitch`, `chat`,
  `platform.alerts`, `platform.chat`).
- **Widget iframe** — streamware loads your widget bundle into a
  sandboxed iframe and assigns `widgetHost` onto its `window` once the
  load event fires.

Both surfaces are invisible to your editor by default. The SDK is the
contract. The engine implements it; you import it.

## Install

```bash
bun add -d @woofx3/module-sdk
```

For modules inside this monorepo, the package resolves via the
workspace path alias — no install needed.

## Function authoring (JS)

```js
/// <reference types="@woofx3/module-sdk/function-ctx" />

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function play_alert(ctx) {
  ctx.events.publish("ui.notify.alert", {
    parameters: { widget: "MediaWidget", text: "Hi!" },
    event: ctx.event,
  });
  return { dispatched: true };
}
```

Every namespace on `ctx` is documented in
`@woofx3/module-sdk/function-ctx`. The full list (current at SDK
v0.1.0):

| Surface | Methods |
|---|---|
| `ctx.event` | the triggering CloudEvent (opaque) |
| `ctx.user` | user context (opaque) |
| `ctx.events` | `publish(subject, data)` |
| `ctx.storage` | `get(key)`, `set(key, value)` |
| `ctx.http` | `request(url, method, opts?)` |
| `ctx.env` | `get(key)` |
| `ctx.resources` | `create(kind, instanceId, displayName?)`, `delete(canonicalId)`, `list(kind)` |
| `ctx.twitch?` | `clip(args?)`, `timeout(args)`, `updateStream(args)`, `addModerator(args)` |
| `ctx.chat?` | `sendMessage(text)` |
| `ctx.platform?.alerts?` | `alert(args)`, `setTimer(args)` |
| `ctx.platform?.chat?` | `register(args)` |

The engine's runtime registration is the source of truth (see
`barkloader/lib_sandbox/src/runtime/quickjs.rs:185-417`). The SDK ships
a drift test that scans this source on every build — if a new property
appears in Rust without a matching declaration in
`function-ctx.d.ts`, the test fails.

## Function authoring (Lua)

The SDK ships LuaCATS annotations consumable by the standard Lua
language server (sumneko-lua). Two setup options — see the SDK's
`README.md` for both. The short version:

```lua
---@param ctx Ctx
local function increment(ctx)
  local count = ctx.storage.get("count") or 0
  ctx.storage.set("count", count + 1)
  return { count = count }
end

return increment
```

The Lua and JS adapters expose an identical `ctx` shape — confirmed by
the same drift test. Whichever runtime your function targets, the
contract is the same.

## Widget authoring

```ts
import type { WidgetHost, WidgetEvent } from "@woofx3/module-sdk";

const host: WidgetHost = window.widgetHost!;

// Subscribe to events the widget declared in `acceptedEvents[]`.
host.onEvent((event: WidgetEvent) => {
  if (event.type === "twitch_platform:trigger:follow.user.twitch") {
    appendFollower(event.data);
  }
});

// Read settings the scene editor populated.
const accent = host.settings.accent ?? "#ff5e3a";

// Report state changes upstream.
host.reportStatus("count", currentCount);
host.reportComplete("goal hit");
```

For plain JS without a build step, JSDoc gives you the same editor
support:

```js
/// <reference types="@woofx3/module-sdk" />

/** @type {import("@woofx3/module-sdk").WidgetHost} */
const host = window.widgetHost;
```

The full surface lives in
`shared/clients/typescript/module-sdk/src/widget-host.ts` (the SDK
package) — and is the **single source of truth** for the contract.
Streamware's runtime implementation imports these types; there's no
parallel definition.

For the runtime / wire details (event channels, persistence,
upstream NATS subjects), see [Widget event channel](../services/widget-events.md).

## Local widget preview

Iterate on a widget without running streamware:

```bash
open shared/clients/typescript/module-sdk/src/preview/widget-preview.html?widget=file:///$PWD/index.html
```

The harness loads your bundle inside a mock `widgetHost`, gives you UI
controls to fire events and mutate storage, and surfaces every
`reportStatus` call in real time. Phase B of the SDK, see
`src/preview/README.md` in the package.

## Where to look

- **Package source**: `shared/clients/typescript/module-sdk/`
- **WidgetHost contract**: `shared/clients/typescript/module-sdk/src/widget-host.ts`
- **Function ctx contract**: `shared/clients/typescript/module-sdk/src/function-ctx.d.ts`
- **Lua annotations**: `shared/clients/typescript/module-sdk/src/function-ctx.lua`
- **Runtime registration (Rust)**: `barkloader/lib_sandbox/src/runtime/quickjs.rs:185-417`
  and `barkloader/lib_sandbox/src/runtime/lua.rs`
- **Drift guard**: `shared/clients/typescript/module-sdk/tests/function-ctx-drift.test.ts`

## Versioning

The SDK pins to the engine's runtime surface. Bumping the SDK is how
the engine tells module authors "the contract changed":

- Patch — docs / drift-test fixes.
- Minor — additive (new namespace, new optional extension type, new
  method on an existing namespace).
- Major — removals or shape changes. Modules need to migrate.
