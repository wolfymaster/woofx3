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
  on it: `crypto`, `storage`, `http`, `resources`, `module`, `log`,
  plus any extensions the engine deployment wired up (`twitch`, `chat`).
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
function increment(ctx) {
  const count = (ctx.storage.get("count") ?? 0) + 1;
  ctx.storage.set("count", count);
  return ctx.response(true, `Count is now ${count}.`);
}
```

The returned value becomes the `function` step's output. A command that
should answer in chat follows the step with a `chat.reply` step that
reads it, e.g. `${<stepId>.message}`.

A function asks the engine to act by returning a value, never by
driving the bus itself. See
[Engine integrity](../services/engine-integrity.md).

Every namespace on `ctx` is documented in
`@woofx3/module-sdk/function-ctx`. The full list (current at SDK
v0.1.0):

| Surface | Methods |
|---|---|
| `ctx.event` | the triggering CloudEvent (opaque) |
| `ctx.user` | user context (opaque) |
| `ctx.response` | `(success, message)` — see [Sandbox → `ctx.response`](./sandbox.md#ctxresponse) |
| `ctx.result` | `(value, events?)` — see [Sandbox → `ctx.result`](./sandbox.md#ctxresult) |
| `ctx.crypto` | `hmac(algorithm, key, data, encoding?)`, `verifyEd25519(publicKey, signature, message, encoding?)`, `timingSafeEqual(a, b)` — see [Sandbox → `ctx.crypto`](./sandbox.md#ctxcrypto) |
| `ctx.storage` | `get(key)`, `set(key, value, options?)` |
| `ctx.http` | `request(url, method, opts?)` — only to hosts the module declares (`net:<host>` permissions) or URLs the streamer entered in `url` settings; see [Module format → Where `ctx.http` may connect](./modules.md#where-ctx-http-may-connect) |
| `ctx.resources` | `create(kind, instanceId, displayName?, settings?)`, `get(canonicalId)`, `delete(canonicalId)`, `list(kind)`, `run(canonicalId, verb, params?)` |
| `ctx.schedule` | `at(deadlineId, key, whenMs, params?)`, `cancel(deadlineId, key)` — one-shot invocations of a function the manifest declares under `deadlines`; see below |
| `ctx.module` | `id`, `name`, `version` (invoking module's identity), `settings` (resolved `module_settings` values — see [Module-level settings](./modules.md#module-level-settings-settings)), `setSetting(key, value)`, `compareAndSetSetting(key, expected, value)` |
| `ctx.log` | `info(value)`, `warn(value)`, `error(value)` — forwards to the host's log, prefixed with the module id. No `console` global exists in this sandbox; this is the only way to emit a log line. |
| `ctx.twitch?` | `clip()`, `shoutout({ userId \| userName })`, `createMarker({ description? })`, `getUser({ userId \| userName })`, `timeout({ userId \| userName, durationSeconds, reason? })`, `updateStream({ title?, category?, categoryId?, tags? })`. Each waits for the twitch service and returns its result, or throws its message with an optional `code`. `timeout` needs the manifest permission `twitch.moderation` and `updateStream` needs `twitch.channel`; see [Twitch channel controls](../services/twitch-channel.md#modules) |
| `ctx.chat?` | `sendMessage(text)` |
| `ctx.oauth?` | `request({ integration, url, method?, headers?, query?, body? })` — a provider the manifest declares under `oauth[]`, with the streamer's token, which the engine attaches and refreshes; see [Module format → OAuth integrations](./modules.md#oauth-integrations-oauth) |

`ctx.storage.set` takes an optional third argument. Passing
`{ clearOnSessionEnd: true }` declares the key as belonging to the current
stream session, and the engine drops it when that session ends — which is not
the same as the stream going offline, since a session spans brief dropouts and a
reconnect keeps the value. Everything else persists until a module overwrites
it. A module never clears storage itself; it declares, and the engine acts. See
[Stream sessions](../services/stream-sessions.md).

`ctx.schedule` arms work for a specific moment instead of polling for it. The
manifest declares each deadline (`id`, the `function` it invokes, `maxPending`);
a function arms an entry under a key and cancels it when the state it tracks
changes:

```js
/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function timerStart(ctx) {
  const target = ctx.event.parameters.target;
  const endsAt = Date.now() + 60_000;
  // ...write { running: true, endsAt } to storage...
  ctx.schedule.at("timer_end", target, endsAt, { target });
}

/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function timerExpire(ctx) {
  /** @type {import("@woofx3/module-sdk/function-ctx").DeadlineFiring} */
  const firing = ctx.event.deadline;
  // Re-check storage before acting: entries are kept in memory only, and a
  // stale or repeated firing must be harmless.
}
```

Entries do not survive a restart or a module reload. A background task with
`runOnLoad: true` re-arms them from the module's storage. See
[Module format → Deadlines](./modules.md#deadlines-deadlines) for the limits and
the full contract.

The engine's runtime registration is the source of truth (see
`barkloader/lib_sandbox/src/runtime/quickjs.rs:185-517`). The SDK ships
a drift test that scans this source on every build — if a new property
appears in Rust without a matching declaration in
`function-ctx.d.ts`, the test fails.

## Webhook handlers

A function named as a `webhook` trigger's `handler` receives the inbound HTTP
request and returns what should happen. The engine checks the result,
publishes its events, and only then answers the request:

```js
/** @param {import("@woofx3/module-sdk/function-ctx").Ctx} ctx */
function handle_order(ctx) {
  /** @type {import("@woofx3/module-sdk/function-ctx").WebhookRequest} */
  const req = ctx.event.data;
  const expected = "sha256=" + ctx.crypto.hmac("sha256", ctx.module.settings.webhookSecret, req.rawBody);
  if (!ctx.crypto.timingSafeEqual(expected, req.headers["x-signature"] ?? "")) {
    return { status: 401 };
  }
  /** @type {import("@woofx3/module-sdk/function-ctx").WebhookHandlerResult} */
  const result = {
    status: 200,
    events: [{ type: "store.order.created", data: { orderId: req.body.id } }],
  };
  return result;
}
```

`webhookSecret` is a `secret` setting, entered by the streamer. See
[Module format → Webhook triggers](./modules.md#webhook-triggers) for the rules
a result must follow.

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
import type { WidgetHost } from "@woofx3/module-sdk";

const host: WidgetHost = window.widgetHost!;

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

### Live settings

A streamer edits a widget's settings in the scene editor with the widget on
screen, and every change reaches it while it runs. A widget never handles
updates itself: the host works out how to apply each change from how the
widget uses the setting.

**Bindings update in place.** The host mirrors the placement's settings into
the widget's document and mirrors them again on every change:

| Binding | Where | What it holds |
|---|---|---|
| `--setting-{id}` | custom property on `:root` | text as written, numbers, booleans as `1` / `0`, a media setting as `url("…")` |
| `data-setting-{id}` | attribute on `<html>` | booleans as `true` / `false`, short text; for selectors (names are lowercased) |
| `data-setting="{id}"` | any element | the element's text is the setting |
| `data-setting-src="{id}"` | any element (also `-href`, `-poster`) | that attribute is the setting's URL (http(s), `data:image` or relative only) |

```html
<style>
  #label {
    color: var(--setting-color, #fff);
    font-size: calc(var(--setting-fontSize, 48) * 1px);
  }
  :root[data-setting-showpanel="false"] .panel { display: none; }
</style>
<div class="panel"><span id="label" data-setting="headline">Thanks for watching!</span></div>
<img data-setting-src="image" alt="" />
```

A setting the placement has no value for leaves what the widget wrote, so an
element's own text and a `var()` fallback are its defaults.

**Settings read by script reload the widget.** `host.settings` reports each
setting the widget's script reads. A change to one of those loads a fresh copy
of the widget, invisibly, and swaps it in once it has painted, so nothing
flashes; the widget's in-memory state starts over (state in module storage
comes back through its subscription). Spreading or listing the settings counts
as reading all of them. Draw from settings in script when you must, and move
what you can into bindings to make it update in place.

A change of theme always swaps the widget, because the theme is applied
before it runs. In the preview harness, **Send to running widget** applies a
settings change through the bindings the same way.

### Fonts

Declare a font setting with `"type": "font"` and use it through its binding,
with a fallback list of your own:

```css
#label { font-family: var(--setting-fontFamily, Roboto, system-ui, sans-serif); }
```

The value is a CSS font-family list; the dashboard's picker writes a Google
Fonts family followed by a generic one (`"Lobster", cursive`). The widget does
nothing to load it. The frame is told which of its settings are fonts, and the
host links a stylesheet for each one's first family from the scene manager,
moving it whenever the setting changes. For a Google family, the scene manager
fetches the family from Google the first time any overlay asks for it, and
each font file the first time a frame draws characters from it, and keeps both
on the engine's disk (`{WOOFX3_ROOT_PATH}/cache/fonts`), so a family once shown
keeps working offline. Any other first family, such as one installed on the
streaming machine, is used by name. When a family cannot be had, the rest of
the list renders.

A frame whose widget has font settings reports itself rendered only once its
fonts have loaded, so a reload never flashes the fallback font.

The family list the picker offers is generated from the Google Fonts catalog
(`shared/clients/typescript/api/google-fonts.generated.ts`, family and
category only); refresh it with `bun run generate:google-fonts` in
`shared/clients/typescript/api`. The scene manager serves only families in
that list.

### Themes

A widget whose manifest declares a [theme contract](./modules.md#themes) is rendered with its theme already applied: each contract variable is set as `--theme-{id}` and each filled asset slot as `--theme-asset-{id}: url(...)` on `:root`, and the theme's stylesheet is linked after the widget's own. Styling with those properties is usually all a widget needs:

```css
#text { text-shadow: var(--theme-shadow, 0 2px 8px rgba(0, 0, 0, 0.7)); }
#box  { background: var(--theme-asset-backdrop, none) center / cover; }
```

For anything CSS cannot reach, `widgetHost.theme` carries the same values:

```ts
interface WidgetTheme {
  readonly id: string | null;                                   // theme canonical id, or null for the defaults
  readonly contractVersion: number;
  readonly variables: Readonly<Record<string, string>>;         // every contract variable
  readonly assets: Readonly<Record<string, string | null>>;     // slot -> URL
  readonly defaultAssets: Readonly<Record<string, string | null>>;
  readonly fallback: "missing" | "incompatible" | null;
}

const sound = new Audio(host.theme?.assets.endSound ?? undefined);
sound.addEventListener("error", () => {
  const fallback = host.theme?.defaultAssets.endSound;
  if (fallback) {
    sound.src = fallback;
  }
});
```

`host.theme` is `null` for a widget without a contract. Widget code is the same for every theme: with no theme selected, or one that is missing or no longer fits, every value is the contract default. `createMockHost({ theme })` in the preview helper lets you try a theme offline.

### Playing in an alert

A widget whose manifest `surfaces` include `"alert"` can be placed inside an alert
layout. There it boots with `host.surface === "alert"` and receives one `alert` event
per alert. If the widget has a length of its own, subscribe with
`{ autoComplete: false }` and call `event.complete()` when it is done; the alert waits
for it. Otherwise subscribe normally, and it stays up until the alert ends.

```js
host.onEvent((event) => {
  sound.addEventListener("ended", () => event.complete());
  sound.play();
}, { autoComplete: false });
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
