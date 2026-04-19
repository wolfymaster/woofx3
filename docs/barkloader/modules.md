# Module Format

A module is a ZIP archive whose root contains a **`module.json`** or **`module.yaml`** manifest. The canonical JSON field names and semantics match **`module-improvements-spec.md`** in the **woofx3-ui** repository. The archive also includes function sources, widget HTML/assets, overlay entry files, and any other paths referenced by the manifest.

## Structure (example)

```
my-module.zip
  |-- module.json
  |-- functions/
  |     +-- handler.lua
  |-- widgets/
  |     +-- alerts/
  |           +-- index.html
  |           +-- static/
  |                 +-- style.css
  |-- overlays/
        +-- main/
              +-- index.html
```

The manifest is **required**. If no `module.json` / `module.yaml` is found (after extraction), processing fails.

**Manifest selection:** if multiple JSON/YAML files exist, barkloader prefers `module.json`, then `module.yaml` / `module.yml` (including under subpaths), then falls back to the first manifest-looking file.

## Manifest (canonical shape)

The manifest uses **camelCase** JSON keys. All top-level sections are optional **except** `id` and `name`, which must be present for a valid module record.

### Example `module.json`

```json
{
  "id": "twitch-platform",
  "name": "Twitch Platform",
  "version": "1.0.0",
  "description": "Twitch eventbus triggers and platform actions",

  "triggers": [
    {
      "id": "twitch.subscription",
      "name": "Twitch Subscription",
      "description": "Fires when a viewer subscribes",
      "type": "eventbus",
      "schema": { "user": "string", "tier": "string" }
    }
  ],
  "actions": [
    {
      "id": "play.alert",
      "name": "Play Alert",
      "description": "Trigger the alert widget",
      "call": "#func play_alert",
      "params": { "alert_type": "string" }
    }
  ],
  "functions": [
    {
      "id": "play_alert",
      "name": "Play Alert Handler",
      "runtime": "lua",
      "path": "functions/play_alert.lua"
    }
  ],
  "commands": [
    {
      "id": "cmd.clip",
      "name": "!clip",
      "pattern": "!clip",
      "type": "prefix",
      "workflow": "create_clip_workflow",
      "requiredRole": "public"
    }
  ],
  "workflows": [
    {
      "id": "on_subscription",
      "name": "New Subscription Alert",
      "trigger": "twitch.subscription",
      "steps": [
        { "action": "play.alert", "params": { "alert_type": "subscription" } }
      ]
    }
  ],
  "widgets": [
    {
      "id": "alerts-widget",
      "name": "Alerts Widget",
      "description": "Stream alert animations",
      "entry": "widgets/alerts/index.html",
      "assets": "widgets/alerts/",
      "settingsSchema": { "theme": { "type": "string", "default": "default" } },
      "acceptedEvents": ["twitch.subscription", "twitch.cheer"]
    }
  ],
  "overlays": [
    {
      "id": "main-overlay",
      "name": "Main Stream Overlay",
      "description": "Default full-screen overlay",
      "entry": "overlays/main/index.html"
    }
  ]
}
```

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Stable module identifier; used as the storage namespace (`modules/{id}/…`) and as `CreateModule.name` until the DB API adds a dedicated `module_id`. |
| `name` | string | yes | Human-readable name. |
| `version` | string | no | Semver (recommended). Used for archive naming (`archives/{id}/{version}.zip`). Defaults to empty. |
| `description` | string | no | Short description. |
| `triggers` | array | no | Event sources; see below. |
| `actions` | array | no | Workflow-step actions (`#func` references, etc.). |
| `functions` | array | no | Callable assets (`id`, `runtime`, `path` relative to ZIP root). |
| `commands` | array | no | Chat/bot commands (`pattern`, `type`: `prefix` \| `exact` \| `regex`, optional `workflow`, `requiredRole`). |
| `workflows` | array | no | Bundled workflows (`trigger` id string, `steps`). |
| `widgets` | array | no | Scene widgets (`entry`, optional `assets` directory, `settingsSchema`, `acceptedEvents`). |
| `overlays` | array | no | Overlay browser sources (`entry`). |

### Trigger entry (`triggers[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Globally meaningful trigger id (e.g. `twitch.subscription`). |
| `name` | string | yes | Display name. |
| `description` | string | no | Human-readable summary. |
| `type` | string | yes | e.g. `eventbus`, `webhook`, `command`, `schedule` (see spec). |
| `schema` | object | no | Payload / config shape (JSON). |

On install, when `DB_PROXY_ADDR` is set, each trigger is registered via Twirp `module.ModuleService/RegisterTrigger`. Until the DB schema exposes `trigger_id` / `trigger_type` directly, barkloader maps: **`event` ← `id`**, **`category` ← `type`**, **`config_schema` ← JSON string of `schema`**.

### Function entry (`functions[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Logical function id (matches `#func` references). |
| `name` | string | yes | Display name. |
| `runtime` | string | yes | e.g. `lua`, `js`. |
| `path` | string | yes | Path inside the ZIP to the source file. |
| `entryPoint` | string | no | Entry symbol if not the default. |

Uploaded bytes are stored at **`modules/{id}/functions/{path}`** (path as in the manifest, normalized).

### Widget entry (`widgets[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Widget type id. |
| `name` | string | yes | Display name. |
| `description` | string | no | |
| `entry` | string | no | HTML entry path in the ZIP. |
| `assets` | string | no | Directory prefix in the ZIP for static assets (all files under this prefix are uploaded). |
| `settingsSchema` | object | no | JSON Schema–style settings for the UI. |
| `acceptedEvents` | string[] | no | Trigger ids this widget cares about. |

Files are stored under **`modules/{moduleId}/widgets/{widgetId}/…`**.

### Overlay entry (`overlays[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | |
| `name` | string | yes | |
| `description` | string | no | |
| `entry` | string | yes | HTML entry path in the ZIP. |

Stored under **`modules/{moduleId}/overlays/{overlayId}/…`**.

### Stubs

`actions`, `commands`, and `workflows` are parsed and logged; persistence to the command service / workflow engine is not wired in barkloader yet.

## Supported file types (upload)

| Extension | `ModuleFileKind` | Notes |
|-----------|------------------|--------|
| `.js` | Program (QuickJS) | Sandbox function source. |
| `.lua` | Program (Lua) | Sandbox function source. |
| `.json` | Manifest | Prefer `module.json` at ZIP root. |
| `.yaml`, `.yml` | Manifest | |
| *other* | Asset | Stored as-is (HTML, CSS, images, fonts, etc.); used for widgets/overlays and any referenced path. |

ZIP members are read as **raw bytes** (not UTF-8–only), so binary assets are supported.

## Writing Functions

Every program file must define a `main` function. This is the entry point called during invocation. The `args` value from the WebSocket invoke request is passed directly to `main`.

### JavaScript (QuickJS)

```javascript
function main(args) {
  return "Hello, " + args.name;
}
```

Type conversion between JSON and JavaScript is handled automatically. Return values are serialized back to JSON. Supported types: null, boolean, integer, float, string, array, object.

QuickJS is a lightweight, embeddable JavaScript engine. It runs in-process with no access to Node/Bun APIs, the filesystem, or the network.

### Lua 5.4

```lua
function main(args)
  return "Hello, " .. args.name
end
```

Lua runs with `StdLib::NONE` -- no standard library is loaded. There is no `io`, `os`, `require`, `dofile`, or any other I/O capability. Only the core language is available (tables, strings, math, coroutines).

JSON-to-Lua type conversion maps objects to tables, arrays to integer-indexed tables, and primitives directly.

### Echo Adapter (Debug)

Non-program files are not executed through the sandbox adapters. For debugging execution paths, the echo adapter may still be used where configured in the sandbox layer.

## Function Trust Model

Each function has an `is_trusted` flag set during module loading. This flag is available to runtime adapters for future use in permission gating (e.g., allowing trusted functions access to additional APIs).

## Upload processing pipeline

When a ZIP is uploaded to `POST /functions`:

```
Multipart upload → temp dir
    → extract ZIP
    → classify each file by extension (program / manifest / asset)
    → ModuleService.create_plan()
         → pick manifest file
         → parse ModuleManifest
    → ModuleService.execute_plan(archive_key, db_proxy_url?)
         → run_install():
              → upload each function path to modules/{id}/functions/…
              → upload widget entry + assets
              → upload overlay entries
              → if DB_PROXY_ADDR: Twirp CreateModule + RegisterTrigger per trigger
              → action/command/workflow stubs (log only)
    → archive original ZIP to archives/{id}/{version}.zip
    → temp dir cleanup (SafeTempDir)
```

The HTTP **200** response is returned when the upload is accepted; install runs in a **background task**. If install fails, the error is logged (check server logs).

### SafeTempDir

Temp directories are wrapped in `SafeTempDir`, which cleans up on drop with safety guards:

- Path must be within the allowed parent directory
- Path must not be a dangerous system path (`/`, `/home`, `/usr`, `/var`, `/etc`, `C:\Windows`, etc.)
- Maximum 10,000 files per directory (prevents runaway cleanup)
- Iteration limits to prevent infinite loops

## Repository backends

Module files are stored via the `Repository` trait (filesystem or S3). See [API -- Storage](./api.md#storage-api).

### Repository layout (after install)

```
modules/
  {module-id}/
    functions/
      ...                    # paths from manifest function.path
    widgets/
      {widget-id}/...
    overlays/
      {overlay-id}/...
archives/
  {module-id}/
    {version}.zip
```

**Registration** (`POST /functions/{name}/register`) loads **`.lua` and `.js`** files found under `modules/{name}/` into the in-memory `ModuleRegistry` for WebSocket invocation. Other extensions in the tree (HTML, CSS, etc.) are ignored by the registry but remain in storage for browser sources / future loaders.

At **startup**, the same rule applies: only `*.lua` / `*.js` under each module prefix are loaded into the sandbox registry.

### File repository (default)

- Destination: `MODULES_DIR`
- Nested keys create nested directories automatically

### S3 repository

See deployment configuration for bucket and endpoint settings.

## Module registry

The `ModuleRegistry` (`lib_sandbox`) holds registered modules for **invocation**. See the previous sections for which files are loaded.

### Invocation

WebSocket invoke uses `module_id/function_id`-style paths (see [API](./api.md#websocket-invoke)); resolution uses the registry built from stored `.lua` / `.js` files.

### Registry API

| Method | Description |
|--------|-------------|
| `get_function(path)` | Resolve `module/function` path, return `Function` clone. Rejects disabled modules. |
| `register_module(name, module)` | Insert or replace a module in the registry. |
| `unregister_module(name)` | Remove a module from the registry. |
| `update_module(name, module)` | Replace an existing module. |
| `set_module_state(name, state)` | Toggle `Active`/`Disabled`. |
| `list_modules()` | Return metadata for all registered modules. |
| `has_module(name)` | Check if a module exists. |
