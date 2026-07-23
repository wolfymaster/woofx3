# Sandbox & Runtimes

The sandbox system provides isolated code execution for module functions. Each WebSocket connection gets its own `Sandbox` instance, but all sandboxes share a single `ModuleRegistry` that holds the loaded modules in memory.

## Architecture

```
SandboxFactory
    |-- Arc<ModuleRegistry>  (shared, thread-safe via RwLock)
    |
    |-- create() -> Sandbox
    |       |-- ModuleRegistry ref (shared)
    |       |-- FunctionExecutor (per-sandbox)
    |              |-- QuickJSAdapter
    |              |-- LuaAdapter
    |              |-- EchoAdapter
```

## SandboxFactory

Created once at server startup. Takes an `Arc<ModuleRegistry>` and a `HostContext`, and produces `Sandbox` instances that share them.

```rust
let registry = Arc::new(ModuleRegistry::new());
let factory = SandboxFactory::new(registry.clone(), noop_host_context());

let sandbox = factory.create();
let result = sandbox.invoke(InvokeRequest {
    function: "my-module/greet".into(),
    args: json!({ "name": "wolfy" }),
})?;
```

## Sandbox

Each sandbox owns a `FunctionExecutor` with all registered runtime adapters. The `invoke` method resolves the function path via the `ModuleRegistry`, selects the adapter by file extension, and executes.

### Invoke Flow

```
invoke(InvokeRequest)
    |
    v
ModuleRegistry.get_function("module/function")
    |-- Split path on "/"
    |-- Look up module by name (read lock)
    |-- Check module state is Active
    |-- Look up function by name
    |-- Return Function clone
    |
    v
FunctionExecutor.execute(function, args)
    |-- Get file extension
    |-- Look up adapter by extension
    |-- adapter.execute(code, args)
    |
    v
Return JSON Value
```

## Runtime Adapters

All adapters implement the `RuntimeAdapter` trait:

```rust
trait RuntimeAdapter {
    fn execute(&self, code: &str, args: Value) -> Result<Value, Error>;
    fn create_sandbox(&self) -> Result<(), Error>;
}
```

### QuickJS (.js)

In-process JavaScript execution via the `quick-js` crate.

| Property | Value |
|----------|-------|
| Extension | `.js` |
| Entry point | `main(args)` |
| Sandboxing | No filesystem, no network, no Node APIs |
| Type mapping | JSON <-> JsValue (null, bool, int, float, string, array, object) |

The adapter creates a `Context`, evaluates the source code, then calls the global `main` function with the args converted from JSON to JavaScript values. The return value is converted back to JSON.

### Lua 5.4 (.lua)

In-process Lua execution via the `mlua` crate (vendored Lua 5.4).

| Property | Value |
|----------|-------|
| Extension | `.lua` |
| Entry point | `main(args)` |
| Sandboxing | `StdLib::NONE` -- no io, os, require, dofile |
| Type mapping | JSON <-> LuaValue (nil, bool, number, string, table) |

The adapter creates a `Lua` instance with an empty standard library, loads the source code, extracts the global `main` function, converts args from JSON to Lua tables, calls `main`, and converts the result back to JSON.

### Echo (fallback)

Debug adapter for unrecognized file extensions.

| Property | Value |
|----------|-------|
| Extension | any unmatched |
| Entry point | none |
| Output | `{ "code": "<source>", "args": <args> }` |

Returns the raw source code and arguments as JSON without executing anything.

## `ctx.module`

Alongside `event`, `user`, `events`, `storage`, `http`, `env`, and `resources`, both
the QuickJS and Lua adapters build a `module` namespace on `ctx`
(`build_module_namespace` in `barkloader/lib_sandbox/src/runtime/quickjs.rs:429-456`;
mirrored in `barkloader/lib_sandbox/src/runtime/lua.rs:186-207`), giving every
invocation access to the calling module's own identity and configured settings:

```js
ctx.module = {
  id: string,        // manifest-local module id, derived from the canonical function path
  name: string,       // display name from the manifest
  version: string,    // semver string from the manifest
  settings: {          // one key per module_settings row for this module_id
    [key: string]: string | number | boolean
  }
}
```

`module_id`/`module_name`/`module_version` are populated on `InvocationContext` by
looking up the function's module in the `ModuleRegistry` metadata cache
(`ModuleRegistry::get_module_metadata`) from the canonical function path's leading
segment. `settings` comes from the host's `SettingsClient` trait — in production,
`HttpSettingsClient` fetches the module's rows from db-proxy
(`ModuleSettingService/ListModuleSettings`) and coerces each `TEXT` value to a native
`string`/`number`/`boolean` based on the setting's declared type; a `NoopSettingsClient`
(used in tests and builtin invocations without a live db-proxy) returns an empty map.

See [Module format → Module-level settings](./modules.md#module-level-settings-settings) for
how a manifest declares these values and how they get registered at install time.

## `ctx.log`

Neither runtime provides a host-visible logging facility on its own — QuickJS has no
`console` (rquickjs doesn't even offer a `console` cargo feature in the version this
project pins), and the Lua sandbox's `StdLib` is `NONE` (no `io`, no `print` byte
sink). `ctx.log` is the only way a module function can emit a log line; both adapters
build it as a namespace on `ctx` (`build_log_namespace` in
`barkloader/lib_sandbox/src/runtime/quickjs.rs`, and the equivalent inline block in
`barkloader/lib_sandbox/src/runtime/lua.rs`), forwarding to the host's `log` crate:

```js
ctx.log.info(value)
ctx.log.warn(value)
ctx.log.error(value)
```

Each call is logged as `[module:{module_id}] {formatted value}` at the corresponding
`log` crate level. `value` may be a string (logged verbatim) or any other
JSON-serializable value (JSON-encoded first), so `ctx.log.warn({ code: 42 })` and
`ctx.log.info("polling failed")` both work. There is no `debug` level and no
multi-argument/variadic form (unlike `console.log(a, b, c)`) — pass one value per
call.

> **`ctx.log.info('label', data)` does not do what `console.log` does.** Each
> `ctx.log.*` function is bound as a single-parameter Rust closure
> (`JsFunction::new(ctx, move |_ctx, value: JsValue| ...)`); rquickjs's calling
> convention silently drops any JS-side arguments past the first rather than
> erroring, so a second argument is **silently discarded, not concatenated or
> ignored-with-a-warning** — only `'label'` gets logged, `data` never does.
> Combine multiple values into one before calling: `ctx.log.info({ label:
> "data", value: data })` or `ctx.log.info("data: " + JSON.stringify(data))`.
> (Confirmed empirically against rquickjs 0.8.1; see
> `quickjs_ctx_log_ignores_arguments_past_the_first` in
> `barkloader/lib_sandbox/src/runtime/quickjs.rs`.)

## `ctx.response`

The standard shape a function returns when it wants the invoking chat command to
reply. Both adapters bind it as a bare callable directly on `ctx` (`build_response_fn`
in `barkloader/lib_sandbox/src/runtime/quickjs.rs`; the equivalent inline
`response_fn` in `barkloader/lib_sandbox/src/runtime/lua.rs`) — unlike `ctx.log`,
it's not a namespace, since it's one verb, not a family of related operations. It's a
pure data constructor with no host state: calling it just builds and returns an
object, it does not itself send anything anywhere.

```js
ctx.response(success, message)
// => { proto: "woofx3.response", v: 1, success: <bool>, message: <string> }
```

```js
function my_function(ctx) {
  if (somethingWentWrong) {
    return ctx.response(false, "Could not do the thing.");
  }
  return ctx.response(true, "Done!");
}
```

- `message` is **required** — the entire point of calling this is to say something
  back. A function with nothing to say simply doesn't call it: returning
  `null`/`undefined` (or nothing at all) is exactly equivalent to never having called
  `ctx.response()`.
- `success` never gates whether the message is delivered — a `false` response's
  `message` is sent exactly the same way a `true` one's is. `success` exists purely
  so the caller can distinguish outcome (e.g. for logging) without parsing the
  message text.
- Tagged with `proto: "woofx3.response"` / `v: 1`, mirroring the same envelope
  convention `woofx3.widget` and `woofx3.overlay-events` already use elsewhere in
  this codebase (see [Widget protocol (P1)](../woofwoofwoof/streamware/widget-protocol.md)).
  This is what lets a caller reliably recognize "this is a deliberate response"
  versus any other object a function might return for its own purposes — see
  [`extractResponseMessage` in `woofwoofwoof/src/application.ts`](../../woofwoofwoof/src/application.ts),
  the only place that currently interprets this shape (a function invoked via a
  workflow's `function` action, rather than a direct chat-command invoke, gets no
  automatic "send as chat message" behavior — the returned object just becomes the
  workflow step's own result, unused unless a later step references it via
  `${taskId.message}`).

## Error Handling

Sandbox errors are categorized:

| Error | Cause |
|-------|-------|
| `ModuleNotFound(name)` | No module with this name in the registry |
| `ModuleDisabled(name)` | Module exists but is in `Disabled` state |
| `FunctionNotFound(name)` | No function matching the requested name in the module |
| `InvalidFunctionPath(path)` | Path is not in `module/function` format |
| `InvalidModuleName` | Module name is empty or invalid |
| `InvalidFunctionName` | Function name is empty or invalid |
| `UnknownFunctionType` | File has no extension |
| `UnsupportedRuntime(ext)` | No adapter registered for the file extension |
| `RuntimeError(msg)` | Function execution failed (JS/Lua error) |
| `LuaError` | Lua runtime error (syntax, type, etc.) |
| `QuickJSAdapterError` | QuickJS context error |
| `QuickJSExecutionError` | QuickJS function call error |
| `IoError` | File read/write failure |
| `JsonError` | JSON serialization/deserialization failure |

All errors implement `std::error::Error` via `thiserror` and are converted to WebSocket error messages.
