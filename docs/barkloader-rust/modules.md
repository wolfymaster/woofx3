# Module Format

A module is a ZIP archive containing a manifest file and one or more program files. Modules extend the platform with custom functions, chat commands, and workflows.

## Structure

```
my-module.zip
  |-- module.json        (or module.yaml)
  |-- greet.js           (QuickJS function)
  |-- countdown.lua      (Lua function)
```

The manifest is required. Uploads without a manifest produce an empty execution plan and no functions are registered.

## Manifest

The manifest declares the module's name, functions, commands, and workflows. Supports JSON and YAML.

### module.json

```json
{
  "name": "my-module",
  "version": "1.0.0",
  "functions": [
    {
      "functionName": "greet",
      "fileName": "greet.js"
    },
    {
      "functionName": "countdown",
      "fileName": "countdown.lua"
    }
  ],
  "commands": [
    {
      "command": "!hello",
      "type": "text"
    },
    {
      "command": "!greet",
      "type": "function"
    }
  ],
  "workflows": [],
  "storage": {
    "keys": {
      "visit_count": {
        "default_value": "0",
        "ttl_seconds": null,
        "namespace": "my-module",
        "clear_on_stream_end": false,
        "clear_on_session_end": false
      },
      "session_score": {
        "default_value": "0",
        "namespace": "my-module",
        "clear_on_stream_end": true,
        "clear_on_session_end": true
      }
    }
  }
}
```

### module.yaml

```yaml
name: my-module
version: "1.0.0"
functions:
  - functionName: greet
    fileName: greet.js
  - functionName: countdown
    fileName: countdown.lua
commands:
  - command: "!hello"
    type: text
  - command: "!greet"
    type: function
workflows: []
storage:
  keys:
    visit_count:
      default_value: "0"
      namespace: my-module
      clear_on_stream_end: false
      clear_on_session_end: false
    session_score:
      default_value: "0"
      namespace: my-module
      clear_on_stream_end: true
      clear_on_session_end: true
```

## Manifest Fields

### Top Level

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Module name. Becomes the namespace for function invocation (`name/function`). |
| `version` | string | no | Module version. Used for archive naming and rollback. Defaults to empty string. |
| `functions` | array | no | Executable functions included in the module. |
| `commands` | array | no | Chat/system commands the module registers. |
| `workflows` | array | no | Workflow definitions the module provides. |
| `storage` | object | no | Persistent key/value storage configuration. |
| `workflow_triggers` | array | no | Trigger templates the module registers with the woofx3 UI. |

### Function Entry

| Field | Type | Description |
|-------|------|-------------|
| `functionName` | string | Name used to invoke the function. Combined with the module name: `module_name/functionName`. |
| `fileName` | string | Source file within the ZIP archive. The file extension determines which runtime adapter is used. |

### Command Entry

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Command string (e.g., `!hello`). |
| `type` | string | `text` for static text responses, `function` for code-backed commands. |

### Storage Configuration

The `storage.keys` map declares named keys that the module can read and write at runtime. Storage is backed by BadgerDB (key/value) via the DB proxy.

Each key entry:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default_value` | string | `null` | Initial value when the key is first created |
| `ttl_seconds` | number | `null` | Time-to-live in seconds. `null` means no expiration. |
| `namespace` | string | -- | Storage namespace for grouping keys |
| `clear_on_stream_end` | bool | `false` | Reset to default when the stream goes offline |
| `clear_on_session_end` | bool | `false` | Reset to default when the user session ends |

### Workflow Triggers

`workflow_triggers` declares trigger templates -- not concrete trigger instances. Each entry describes an event the module can fire on and the configuration a user must provide when creating a workflow that uses this trigger. Conditions for the trigger are specified in the workflow itself, not in the trigger template.

When a module is uploaded, barkloader registers its `workflow_triggers` with the woofx3 database so they appear in the UI. When the module is deleted, its triggers are removed.

#### Trigger Entry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | string | yes | UI grouping label (e.g. "Chat", "Stream") |
| `name` | string | yes | Display name for the trigger |
| `description` | string | yes | Human-readable description of when it fires |
| `event` | string | yes | NATS subject this trigger fires on (e.g. `message.user.twitch`) |
| `config` | array | no | Form input fields the user fills in when creating a workflow with this trigger |
| `allowVariants` | bool | no | When true, users can create multiple workflows using this trigger with different configurations. Defaults to false. |

#### Config Field Entry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Field identifier |
| `label` | string | yes | Display label in the UI |
| `type` | string | yes | Field type: `text`, `number`, `select`, `checkbox` |
| `required` | bool | no | Whether the user must fill in this field. Defaults to false. |
| `default` | any | no | Default value |
| `options` | array | no | For `select` type: list of `{label, value}` objects |

#### Example

```json
{
  "name": "my-module",
  "version": "1.0.0",
  "workflow_triggers": [
    {
      "category": "Chat",
      "name": "Keyword Match",
      "description": "Fires when a chat message contains a keyword.",
      "event": "message.user.twitch",
      "allowVariants": true,
      "config": [
        {
          "name": "keyword",
          "label": "Keyword",
          "type": "text",
          "required": true
        }
      ]
    },
    {
      "category": "Stream",
      "name": "Custom Game Change",
      "description": "Fires when the stream category changes to a specific game.",
      "event": "my-module.game.change",
      "allowVariants": false,
      "config": [
        {
          "name": "game",
          "label": "Game Name",
          "type": "text",
          "required": true
        }
      ]
    }
  ]
}
```

A trigger template describes what the trigger is and what configuration it needs. It is not a concrete trigger and does not specify conditions. When a user (or a manifest-declared concrete workflow) creates a workflow using this trigger, the workflow definition specifies the actual conditions -- for example, "only fire if the message contains the keyword the user entered". This separation allows the same trigger template to be reused across many different workflows.

## Supported File Types

| Extension | Kind | Runtime / Purpose |
|-----------|------|-------------------|
| `.js` | Program | QuickJS -- sandboxed JavaScript engine |
| `.lua` | Program | Lua 5.4 (mlua) -- sandboxed, no standard library |
| `.json` | Manifest | Module manifest |
| `.yaml` / `.yml` | Manifest | Module manifest |

Files with unrecognized extensions are skipped with a warning during upload processing.

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

Files with unrecognized extensions fall through to the echo adapter, which returns the source code and arguments without execution:

```json
{
  "code": "<file contents>",
  "args": { "original": "args" }
}
```

Useful for debugging module uploads and verifying file contents.

## Function Trust Model

Each function has an `is_trusted` flag set during module loading. This flag is available to runtime adapters for future use in permission gating (e.g., allowing trusted functions access to additional APIs).

## Upload Processing Pipeline

When a ZIP is uploaded to `POST /functions`:

```
Multipart Upload
    |
    v
1. FileService.process_upload()
   |-- Extract "file" field from multipart
   |-- Create temp directory (UUID name)
   |-- Stream chunks to disk
   |-- Return FileMetadata
    |
    v
2. FileService.process_uploaded_file()
   |-- Detect extension
   |-- If .zip: unzip -o to temp dir
   |-- If .gz: gunzip -k
   |-- Return metadata for each extracted file
    |
    v
3. ModuleService.add_file() for each file
   |-- Parse extension to ModuleFileKind
   |-- Skip unrecognized extensions
   |-- Store as ModuleFile (name, kind, contents)
    |
    v
4. ModuleService.create_plan()
   |-- Find the manifest file
   |-- Parse as ModuleManifest
   |-- Build ModulePlan (linked list):
   |     push workflows, then commands, then functions
   |     (LIFO insertion -> FIFO iteration)
    |
    v
5. ModuleService.execute_plan()
   |-- Iterate plan nodes in order:
   |     1. Workflows -> forward to workflow engine
   |     2. Commands -> register in database
   |     3. Functions -> upload to repository at modules/{name}/{file}
    |
    v
6. Archive original zip to archives/{name}/{version}.zip
    |
    v
7. SafeTempDir drops -> cleanup
```

The HTTP response returns at step 1. Steps 2-7 run as a background `tokio::spawn` task. Code files are stored under `modules/{module_name}/` in the repository. The original ZIP archive is stored under `archives/{module_name}/{version}.zip` for rollback support.

### File Classification

Files are classified by extension into `ModuleFileKind`:

```
.js   -> PROGRAM(JS)
.lua  -> PROGRAM(LUA)
.json -> MANIFEST(JSON)
.yaml -> MANIFEST(YAML)
.yml  -> MANIFEST(YAML)
*     -> skipped with warning
```

### SafeTempDir

Temp directories are wrapped in `SafeTempDir`, which cleans up on drop with safety guards:

- Path must be within the allowed parent directory
- Path must not be a dangerous system path (`/`, `/home`, `/usr`, `/var`, `/etc`, `C:\Windows`, etc.)
- Maximum 10,000 files per directory (prevents runaway cleanup)
- Iteration limits to prevent infinite loops

## Repository Backends

Module files are stored via a pluggable repository system using the `Repository` trait.

### Repository Trait

```rust
trait Repository {
    fn setup(&self) -> Result<()>;
    fn read_file(&self, key: &str) -> Result<Vec<u8>>;
    fn delete_prefix(&self, prefix: &str) -> Result<()>;
    fn list_prefix(&self, prefix: &str) -> Result<Vec<String>>;
    async fn list(path) -> Result<()>;
    async fn create(requests, failed) -> Result<()>;
}
```

The active backend is selected by `REPOSITORY_TYPE` environment variable and constructed via `RepositoryFactory`. Runtime dispatch uses `enum_dispatch` for zero-cost polymorphism.

### Repository Layout

```
modules/
  my-module/
    greet.js
    countdown.lua
  another-module/
    process.js
archives/
  my-module/
    1.0.0.zip
    1.1.0.zip
```

Code files under `modules/` are what gets loaded into the `ModuleRegistry`. Archives under `archives/` store the original upload ZIPs for rollback.

### File Repository (default)

Stores module files on the local filesystem under the configured `MODULES_DIR` directory.

- Creates the destination directory on `setup()` if it does not exist
- Creates parent directories automatically for nested paths (`modules/{name}/`)
- Writes files directly, tracking any failures in the `failed` vector
- `list_prefix` recursively collects all files under the given prefix

### S3 Repository

Stores module files in an AWS S3 bucket. Supports custom endpoints for local development with MinIO or LocalStack.

- Verifies bucket access on creation
- Supports presigned URLs (max 7 days expiry)
- Parallel uploads via `tokio::spawn`

## Module Registry

The `ModuleRegistry` (`lib_sandbox`) is a thread-safe in-memory store of all registered modules. It uses `RwLock<HashMap<String, RegisteredModule>>` for concurrent read access during invocation and exclusive write access during registration.

Each registered module contains:

- `ModuleMetadata` -- name, version, timestamps
- `HashMap<String, Function>` -- the module's functions with code loaded in memory
- `ModuleState` -- `Active` or `Disabled`

### Startup

At startup, barkloader scans the repository for previously stored modules:

1. `list_prefix("modules/")` to discover all stored module files
2. Group files by module name (second path segment)
3. Read each code file from the repository into a `Function`
4. Build a `RegisteredModule` and register it in the `ModuleRegistry`

### Invocation

When a WebSocket invoke request arrives for `"my-module/greet"`:

1. Split on `/` -- must produce exactly 2 parts
2. `ModuleRegistry.get_function("my-module/greet")` acquires a read lock
3. Look up the module, check it is `Active` (not `Disabled`)
4. Look up the function within the module
5. Read the file extension to select the runtime adapter
6. Call the adapter's `execute(code, args)`
7. Return the result

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
