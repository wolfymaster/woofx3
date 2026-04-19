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
