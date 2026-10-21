# @woofx3/module-sdk

Type definitions and dev-loop helpers for authoring barkloader modules.

A module exposes some combination of:

- **Functions** — JS or Lua snippets the engine sandbox calls with a
  host-provided `ctx` object.
- **Widgets** — browser bundles loaded into a sandboxed iframe with a
  host-provided `window.widgetHost` object.

Both surfaces are injected at runtime; without this package, your editor
sees them as unstructured `any`. Install it once, get full
autocomplete + hover hints + type-checked widget code.

## Install

```bash
bun add -d @woofx3/module-sdk
```

## Widget development

### TS widget bundle

```ts
import type { WidgetHost, WidgetEvent } from "@woofx3/module-sdk";

const host: WidgetHost = window.widgetHost!;

host.onEvent((event: WidgetEvent) => {
  // event.type === "twitch_platform:trigger:follow.channel.twitch"
  // event.data.userName, etc.
});

host.reportStatus("count", 42);
```

The package augments `Window` so `window.widgetHost` is typed without a
cast — but most widgets prefer the explicit assignment for clarity.

### JS widget bundle (no build step)

JSDoc gives you the same editor support without compiling:

```js
/// <reference types="@woofx3/module-sdk" />

/** @type {import("@woofx3/module-sdk").WidgetHost} */
const host = window.widgetHost;

host.onEvent((event) => {
  // hover `event` — autocomplete works
});
```

## Function development

### JS function (QuickJS sandbox)

```js
/// <reference types="@woofx3/module-sdk/function-ctx" />

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function increment(ctx) {
  const count = Number(ctx.storage.get("count")) || 0;
  ctx.storage.set("count", count + 1);
  return { count: count + 1 };
}
```

The `ctx` surface includes built-in namespaces (`events`, `storage`,
`http`, `env`, `resources`) plus optional extension namespaces
(`twitch`, `chat`) registered per
deployment. See `src/function-ctx.d.ts` for the full reference.

### Lua function (mlua sandbox)

Lua tooling reads LuaCATS annotations from a workspace library. Two
setup options:

**Workspace-wide** — copy the stub once, point `.luarc.json` at it:

```bash
mkdir -p ~/.lib/woofx3-module-sdk/lua
cp node_modules/@woofx3/module-sdk/src/function-ctx.lua \
   ~/.lib/woofx3-module-sdk/lua/
```

```jsonc
// .luarc.json
{ "workspace": { "library": ["~/.lib/woofx3-module-sdk/lua"] } }
```

**Per-module** — keep the stub next to the code:

```bash
mkdir -p my-module/lua-stubs
cp node_modules/@woofx3/module-sdk/src/function-ctx.lua \
   my-module/lua-stubs/
```

```jsonc
// .luarc.json
{ "workspace": { "library": ["lua-stubs"] } }
```

Then annotate your function entry point:

```lua
---@param ctx Ctx
local function increment(ctx)
  local count = ctx.storage.get("count") or 0
  ctx.storage.set("count", count + 1)
end

return increment
```

## Local widget preview (no engine required)

Preview a module's widgets from its folder, against the real host an
overlay uses, with the widget-host package's dev server:

```bash
bun shared/clients/typescript/widget-host/preview/cli.ts path/to/my-module
```

It builds each widget's frame as the engine does, lets you edit settings,
set module storage and fire events, logs what the widget reports, and
reloads it when a file changes. See
`shared/clients/typescript/widget-host/README.md`. For unit tests, the mock
host in `src/preview/` stands in for the host without a browser.

## Layout

```
src/
├── widget-host.ts          public WidgetHost types (TS source)
├── function-ctx.d.ts       ctx types for JS function authors
├── function-ctx.lua        LuaCATS annotations for Lua function authors
└── preview/
    └── widget-preview.ts   mock host for unit tests
tests/
└── function-ctx-drift.test.ts  scans Rust source, fails on drift
```

## Versioning

Follows semver. The package version pins to a specific engine API
surface:

- **Patch** — docstring / comment improvements, drift-test fixes.
- **Minor** — added namespaces or methods on `ctx` / `widgetHost`. New
  optional extension types.
- **Major** — removals or breaking shape changes. Module authors will
  need to migrate.

When the SDK changes, the engine ships the matching runtime shape in
the same release window.

## Maintainer notes

To publish a new version manually:

```bash
cd shared/clients/typescript/module-sdk
bun run build
bun run test            # ensure drift guard is green
bun run publish:dry     # inspect the tarball
npm publish --access public
```

CI-driven publish is a clean follow-up.
