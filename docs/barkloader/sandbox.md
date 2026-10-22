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

Created once at server startup. Takes an `Arc<ModuleRegistry>`, a `HostContext` and the `SandboxLimits`, and produces `Sandbox` instances that share them. Async callers go through `invoke_blocking`, which caps how many invocations run at once (see [Time, instruction and concurrency limits](#time-instruction-and-concurrency-limits)).

```rust
let registry = Arc::new(ModuleRegistry::new());
let factory = SandboxFactory::new(registry.clone(), noop_host_context(), SandboxLimits::default());

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
| Sandboxing | Allow-listed globals only; text chunks only |
| Type mapping | JSON <-> LuaValue (nil, bool, number, string, table) |

The adapter creates a `Lua` instance with `StdLib::NONE`, strips the global environment down to an allow-list, loads the source code, extracts the global `main` function, converts args from JSON to Lua tables, calls `main`, and converts the result back to JSON.

#### Globals and isolation

`StdLib::NONE` leaves out `io`, `os`, `string`, `table`, `math`, `coroutine`, `debug` and `package`, but mlua always opens the base library. Before any host binding is installed, the adapter removes every global except these (`LUA_ALLOWED_GLOBALS` in `barkloader/lib_sandbox/src/runtime/lua.rs`):

`assert`, `error`, `ipairs`, `next`, `pairs`, `pcall`, `rawequal`, `rawget`, `rawlen`, `rawset`, `select`, `setmetatable`, `getmetatable`, `tonumber`, `tostring`, `type`, `xpcall`, `_G`, `_VERSION`

`ctx` is the only other value a module function receives. In particular `dofile`, `loadfile`, `load`, `loadstring`, `print`, `collectgarbage` and `require` are absent; the adapter checks that after the strip and fails the invocation if any survived.

Module source is loaded in text mode: a source starting with the Lua bytecode signature (`\27Lua`) is refused with a syntax error, because the VM does not verify precompiled chunks.

Two allowed globals are replaced, because their stock versions run module code with Lua's debug hooks switched off, where the instruction and deadline checks cannot stop it (`LUA_HOOK_SAFE_GLOBALS` in `lua.rs`):

- `xpcall` calls its message handler after the failed call has unwound, not at the point of the error. If the handler itself fails, `xpcall` returns `false` and the handler's error.
- `setmetatable` refuses a metatable with a `__gc` field, since Lua runs finalizers with hooks off.

### Echo (fallback)

Debug adapter for unrecognized file extensions.

| Property | Value |
|----------|-------|
| Extension | any unmatched |
| Entry point | none |
| Output | `{ "code": "<source>", "args": <args> }` |

Returns the raw source code and arguments as JSON without executing anything.

### Value conversion

Every value that crosses between a runtime and the engine is converted to or from JSON: a function's return value, the arguments a module passes to a `ctx` function, a thrown value, and the event and host answers handed to the script. Each conversion is bounded (`SandboxLimits` in `barkloader/lib_sandbox/src/runtime/limits.rs`):

| Limit | Default | Error |
|-------|---------|-------|
| Nesting depth (arrays and objects) | 64 | `ValueTooDeep` |
| Values in one conversion | 100,000 | `ValueTooLarge` |
| Text in one conversion (strings and keys) | 4 MiB | `ValueTooLarge` |

A value that refers to itself exceeds the depth limit, so a cyclic return value fails the invocation with a clear error. A refused `ctx` argument is raised inside the script, where a `try`/`catch` or `pcall` can handle it; a value `ctx.log.*` cannot convert is logged as unloggable instead.

A Lua table whose keys are exactly `1..n` becomes an array; any other table becomes an object keyed by its string and integer keys. An empty table is an object, except an empty array from the event, which round-trips as `[]`. A table holding both `[1]` and `['1']` is refused rather than silently keeping one. Functions, coroutines and userdata (in JavaScript: functions, promises, symbols and BigInts) have no JSON form and are refused with `UnsupportedValue`.

A JavaScript entry point must return its result directly. The adapter does not run the promise job queue, so an `async` function (or any function returning a Promise) is refused with `AsyncEntryUnsupported`.

### Time, instruction and concurrency limits

Every invocation has a deadline: the caller's `timeoutMs`, capped at and defaulting to 30 seconds. Module code also has a CPU budget. Both runtimes check the two as the code runs (the rest of `SandboxLimits`):

| Limit | Default | Error |
|-------|---------|-------|
| Invocation deadline | `timeoutMs`, at most 30 s | `DeadlineExceeded` |
| Lua VM instructions, checked every 10,000 | 10,000,000 | `InstructionLimitExceeded` |
| QuickJS interrupt-handler calls (about 1e7 bytecode ops) | 200 | `InstructionLimitExceeded` |
| Heap per runtime | 16 MiB | runtime error |

Neither stop can be caught by module code. QuickJS raises an uncatchable error, and it checks both limits inside regular expression matching too, so a pattern that backtracks without end stops at the deadline like a loop does. In Lua, the first trip switches the hook to fail every instruction, so a `pcall` handler cannot run a single instruction and the error unwinds to the entry point. The error reported is the limit that tripped, whatever error module code turned it into on the way out.

`SandboxFactory::invoke_blocking` runs at most `max_concurrent_invocations` invocations at once (32, set with `WOOFX3_SANDBOX_MAX_CONCURRENT_INVOCATIONS`, 1 to 512). Each running invocation holds one of Tokio's blocking threads, so the cap keeps a burst of calls or a few runaway modules from starving everything else. A call waits for a free slot for up to 5 seconds, or until its deadline if that is sooner, and the wait counts against the deadline. When no slot frees up in time it fails with `InvokeBlockingError::Busy`, which the WebSocket invoke, the scheduler and the field-options responder report like any other failed invocation. A slot is held until the invocation ends, even when its caller has stopped waiting. A nested `ctx.resources.run` runs on its caller's thread and takes no slot of its own. Every limit is checked when the sandbox is built: a zero budget or a slot count outside 1 to 512 stops barkloader at startup.

## Modules request, the engine acts

Module functions never drive the engine. A function returns a value in a platform-defined shape and the engine decides what to do with it; [`ctx.response`](#ctxresponse) is the model. Read [Engine integrity](../services/engine-integrity.md) before adding any host binding.

## `ctx.crypto`

Signature primitives for verifying inbound webhook requests. Pure computation over the arguments: nothing here reaches the engine. Implemented once in `barkloader/lib_sandbox/src/runtime/crypto.rs` and bound identically by both adapters.

| Method | Returns | Notes |
|---|---|---|
| `hmac(algorithm, key, data, encoding?)` | digest string | `algorithm` is `"sha1"`, `"sha256"` or `"sha512"`; `key` and `data` are UTF-8; `encoding` is `"hex"` (default) or `"base64"`. Throws for an unknown algorithm or encoding. |
| `verifyEd25519(publicKey, signature, message, encoding?)` | boolean | `publicKey` and `signature` are in `encoding` (default `"hex"`); `message` is UTF-8. Throws for a malformed public key, which is the author's mistake. A malformed or non-matching signature is `false`, since it is whatever the caller sent. |
| `timingSafeEqual(a, b)` | boolean | Constant-time comparison; different lengths compare unequal. Use it to compare a computed signature with the one a request carries. |

## `ctx.module`

Alongside `event`, `user`, `crypto`, `storage`, `http`, and `resources`, both
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
    [key: string]: string | number | boolean | object[]
  },
  setSetting(key, value),
  compareAndSetSetting(key, expected, value)
}
```

`module_id`/`module_name`/`module_version` are populated on `InvocationContext` by
looking up the function's module in the `ModuleRegistry` metadata cache
(`ModuleRegistry::get_module_metadata`) from the canonical function path's leading
segment. `settings` comes from the host's `SettingsClient` trait — in production,
`HttpSettingsClient` fetches the module's rows from db-proxy
(`ModuleSettingService/ListModuleSettings`) and coerces each `TEXT` value to a native
`string`/`number`/`boolean`, or a `list` setting's array of rows, based on the setting's
declared type; a `NoopSettingsClient` (used in tests and builtin invocations without a
live db-proxy) returns an empty map.

`compareAndSetSetting(key, expected, value)` writes only while the setting still
holds `expected` and answers `{ swapped, current }`. `HttpSettingsClient` compares
`expected` with the stored value as the module reads it, then has db-proxy
(`ModuleSettingService/CompareAndSetModuleSetting`) write only while the stored text
is still the text it compared, so the check is by meaning and the write is atomic.
`value` is stored as is when it is a string and as JSON otherwise; a `list` setting
takes only an array. It refuses the same keys `setSetting` does, and secrets.

See [Module format → Module-level settings](./modules.md#module-level-settings-settings) for
how a manifest declares these values and how they get registered at install time.

## `ctx.log`

Neither runtime provides a host-visible logging facility on its own — QuickJS has no
`console` (rquickjs doesn't even offer a `console` cargo feature in the version this
project pins), and the Lua sandbox strips `print` and has no `io`
([Globals and isolation](#globals-and-isolation)). `ctx.log` is the only way a module
function can emit a log line; both adapters build it as a namespace on `ctx` (`build_log_namespace` in
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

The standard shape a function returns to report an outcome and a message. Both
adapters bind it as a bare callable directly on `ctx` (`build_response_fn` in
`barkloader/lib_sandbox/src/runtime/quickjs.rs`; the equivalent inline `response_fn`
in `barkloader/lib_sandbox/src/runtime/lua.rs`) — unlike `ctx.log`, it's not a
namespace, since it's one verb, not a family of related operations. It's a pure data
constructor with no host state: calling it just builds and returns an object, it does
not itself send anything anywhere.

```js
ctx.response(success, message)
// => { proto: "woofx3.response", v: 1, success: <bool>, message: <string> }
```

```js
function my_function(ctx) {
  if (somethingWentWrong) {
    return ctx.response(false, "Could not do the thing.");
  }
  var reply = ctx.response(true, "Done!");
  reply.detail = "anything else later actions should see";
  return reply;
}
```

The returned object becomes the output of the `function` step that called the
function, and nothing more: the engine does not send `message` anywhere. Later steps
in the same workflow or command action list read it with `${<stepId>.<field>}`. To
answer a chat command, follow the `function` step with a `chat.reply` step:

```json
[
  { "id": "queue_song", "action": "function", "function": "spotify_sr:function:song_request" },
  { "action": "chat.reply", "parameters": { "message": "${queue_song.message}" } }
]
```

A step with no `id` in a command's action list is named by its position
(`action-1`, `action-2`, ...), so give the `function` step an `id` whenever a later
step refers to it; inserting a step otherwise changes what the reference points at.

- `message` is **required**. A function with nothing to report returns
  `null`/`undefined` (or nothing at all) instead.
- `success` reports the outcome; it does not stop the steps after it. A
  `false` response's `message` reaches a following `chat.reply` the same way a
  `true` one's does, which is usually what a command wants ("couldn't find that
  song"). To act only on success, guard the later step with a [condition](../workflow/tasks.md#condition)
  on `${<stepId>.success}`.
- Extra fields set on the returned object are part of the step output too
  (`${queue_song.song}` above).
- Tagged with `proto: "woofx3.response"` / `v: 1`, mirroring the same envelope
  convention `woofx3.widget` and `woofx3.overlay-events` already use elsewhere in
  this codebase, so a reader of the step output can tell a deliberate response from
  any other object a function might return.

## `ctx.success` and `ctx.failure`

Shorthand for `ctx.response` that also takes extra fields. Same bare-callable, pure
data constructor shape; the builder is `build_outcome_value` in
`barkloader/lib_sandbox/src/runtime/host_bindings.rs`, shared by both adapters.

```js
ctx.success(message, fields?)  // => { proto: "woofx3.response", v: 1, success: true,  message, ...fields }
ctx.failure(message, fields?)  // => { proto: "woofx3.response", v: 1, success: false, message, ...fields }
```

```js
function song_request(ctx) {
  var song = findSong(ctx.event.data.query);
  if (!song) {
    return ctx.failure("Couldn't find that song.");
  }
  return ctx.success("Queued " + song.title, { song: song });
}
```

The function returns a message; it never posts to chat. A "Send chat message" step
(`chat.reply`) posts `${<stepId>.message}`, so the streamer decides whether, where and
how the reply is worded. Extra fields are part of the step output: if the function
step's id is `queue_song`, the example's song is `${queue_song.song}`.

To keep a failure out of chat, put a condition on the chat step so it runs only when
`${queue_song.success}` is true. A failed step
output still carries its `message`, so a second chat step conditioned on
`${queue_song.success}` being false can answer the failure on purpose.

Engines older than the release that added these functions have no `ctx.success` or
`ctx.failure`; calling them throws `not a function`. A module that must run on both
can use `ctx.success ? ctx.success(m, f) : Object.assign(ctx.response(true, m), f)`.

- `fields` must be an object (or omitted). It may not set `proto`, `v`, `success` or
  `message`: the call throws a sandbox error naming the reserved field, so a module
  cannot forge the tag or the outcome.
- `ctx.response(success, message)` stays available and behaves as before.

## `ctx.result`

The shape a function returns when what it did is something workflows should be able
to act on: a counter changed, a timer ended, a viewer joined a queue. Like
`ctx.response`, it is a bare callable and a pure data constructor — the function
itself publishes nothing.

```js
ctx.result(value, events?)
// => { proto: "woofx3.result", v: 1, value, events }
```

```js
function counterIncrement(ctx) {
  // ...update storage...
  const outcome = { target, previous, next };
  return ctx.result(outcome, [{ type: "counter.changed", data: outcome }]);
}
```

When the function returns it, barkloader (`Sandbox::invoke`, with the rules in
`barkloader/lib_sandbox/src/function_result.rs`) checks every event before publishing
any:

- `type` must be the `event` of an **eventbus trigger the same module declares**. A
  module cannot announce another module's events, a platform event or a `db.*` outbox
  event.
- At most 16 events, each `data` an object of at most 64 KiB serialized, and no
  fields beyond `type` and `data` on an event or beyond `proto`, `v`, `value` and
  `events` on the envelope.

A result that breaks a rule fails the invocation and publishes nothing. Otherwise each
event is published as a CloudEvent with source `module/<moduleId>`, on the subject
named by its type, and the caller — a workflow step, a background task, a chat
command — receives only `value`. A publish that fails is logged rather than failing
the call, because the function's own effects have already happened and a retry would
apply them twice. These are the same rules a webhook handler's `events` follow (see
[Engine integrity](../services/engine-integrity.md)).

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
| `ValueTooDeep` | A converted value nests deeper than the depth limit, or refers to itself |
| `ValueTooLarge` | A converted value has too many values or too much text |
| `UnsupportedValue` | A value with no JSON form, such as a Lua function |
| `AsyncEntryUnsupported` | A JavaScript entry point returned a Promise |
| `InstructionLimitExceeded` | Module code used up its instruction budget |
| `DeadlineExceeded` | Module code was still running at the invocation's deadline |
| `InvokeBlockingError::Busy` | Every invocation slot stayed taken for the whole wait |

All errors implement `std::error::Error` via `thiserror` and are converted to WebSocket error messages.
