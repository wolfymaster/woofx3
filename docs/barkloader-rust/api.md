# API

## HTTP Endpoints

**Base URL:** `http://localhost:9653`

### Upload Module

Upload a module as a ZIP archive. The file is processed asynchronously -- the response returns immediately after the upload is accepted.

```
POST /functions
Content-Type: multipart/form-data
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | yes | ZIP archive containing manifest and code |

**Response (200):**

```json
{
  "success": true,
  "original_filename": "my-module.zip",
  "extension": "zip",
  "message": "File uploaded and processing started"
}
```

**Processing pipeline (background):**

1. Stream multipart upload to a temp directory (UUID-named)
2. Detect file extension, decompress if ZIP or gzip
3. Classify each extracted file: `.js`/`.lua` programs, `.json`/`.yaml` manifests, or **asset** (any other extension, stored as bytes)
4. Select and parse the manifest (`module.json` / `module.yaml` preferred; see [Module format](./modules.md))
5. Run **install**: upload functions to `modules/{id}/functions/…`, widget/overlay assets, then (if `DB_PROXY_ADDR` is set) Twirp `CreateModule` and `RegisterTrigger` per manifest `triggers`
6. Log-only stubs for manifest `actions`, `commands`, and `workflows` until those services are wired
7. Archive the original ZIP to `archives/{id}/{version}.zip`
8. Clean up the temp directory via `SafeTempDir` (RAII drop)

Install failures after the HTTP response are **logged**; the client does not receive a second callback today.

**Error responses:**

| Code | Condition |
|------|-----------|
| 400 | Missing `file` field, invalid file, or unrecognized format |
| 500 | Storage or processing failure |

Error body:

```json
{
  "code": "INVALID_FILE",
  "message": "No file field found in upload"
}
```

### Register Module

Register an uploaded module for execution. Reads code files from the repository at `modules/{name}/` and loads them into the in-memory `ModuleRegistry`.

```
POST /functions/{name}/register
```

**Response (200):**

```json
{
  "success": true,
  "module": "my-module",
  "message": "Module registered successfully"
}
```

**Error responses:**

| Code | Condition |
|------|-----------|
| 404 | No files found in repository for the given module name |
| 500 | Repository read failure |

### List Modules

List all registered modules.

```
GET /functions
```

**Response (200):**

```json
{
  "modules": [
    { "name": "my-module", "version": "1.0.0" },
    { "name": "another-module", "version": "unknown" }
  ]
}
```

### Get Module

Get metadata for a specific registered module.

```
GET /functions/{name}
```

**Response (200):**

```json
{
  "name": "my-module",
  "version": "1.0.0"
}
```

**Error responses:**

| Code | Condition |
|------|-----------|
| 404 | Module not found in registry |

### Delete Module

Unregister a module and delete its files from the repository. Archives are preserved for rollback.

```
DELETE /functions/{name}
```

**Response (200):**

```json
{
  "success": true,
  "module": "my-module",
  "message": "Module deleted successfully"
}
```

**Error responses:**

| Code | Condition |
|------|-----------|
| 404 | Module not found in registry |

### Set Module State

Enable or disable a module. Disabled modules remain in memory but reject invocations.

```
PATCH /functions/{name}/state
Content-Type: application/json
```

**Request body:**

```json
{
  "state": "active"
}
```

Valid states: `active`, `disabled`.

**Response (200):**

```json
{
  "success": true,
  "module": "my-module",
  "state": "active"
}
```

**Error responses:**

| Code | Condition |
|------|-----------|
| 400 | Invalid state value |
| 404 | Module not found in registry |

### List Versions

List all archived versions available for a module.

```
GET /functions/{name}/versions
```

**Response (200):**

```json
{
  "module": "my-module",
  "versions": ["1.0.0", "1.1.0"]
}
```

### Rollback Module

Rollback a module to a previously archived version. Extracts the archived ZIP, replaces files in the repository, and re-registers the module.

```
POST /functions/{name}/rollback?version=1.0.0
```

**Response (200):**

```json
{
  "success": true,
  "module": "my-module",
  "version": "1.0.0",
  "message": "Module rolled back to version 1.0.0"
}
```

**Error responses:**

| Code | Condition |
|------|-----------|
| 404 | Archive not found for the given module/version |
| 500 | Extraction or registration failure |

### Reload Modules

Force reload of all modules from the repository.

```
PATCH /functions/reload
```

**Response (200):**

```json
{
  "success": true,
  "message": "Modules reloaded"
}
```

### Health Check

```
GET /echo
```

**Response (200):** `"Hello, Wolfy!"`

## WebSocket Protocol

**Endpoint:** `ws://localhost:9653/ws`

Each WebSocket connection creates its own `Sandbox` instance backed by a shared `ModuleRegistry`. This means all connections see the same set of loaded modules, but execution is isolated per connection.

Max continuation frame size: 1 MB (2^20 bytes).

### Message Format

All messages are JSON with a `type` field and a `data` field.

```typescript
{
  type: string;   // message type
  data: any;      // type-specific payload
}
```

### Invoke a Function

**Client -> Server:**

```json
{
  "type": "invoke",
  "data": {
    "function": "module_name/function_name",
    "args": { "key": "value" }
  }
}
```

The `function` field uses the format `module_name/function_name`:
- `module_name` maps to a subdirectory under `modules/`
- `function_name` maps to a file within that directory (extension is resolved automatically)

The `args` value is forwarded as-is to the function's `main()` entry point.

**Server -> Client (success):**

```json
{
  "type": "result",
  "data": {
    "response": "ok",
    "result": "return value from main()"
  }
}
```

The `result` field contains whatever JSON-serializable value the function returned.

**Server -> Client (error):**

```json
{
  "type": "error",
  "data": "Function not found: mymodule/missing"
}
```

### Error Conditions

| Error | Cause |
|-------|-------|
| `Module not found: {name}` | No module with this name in the registry |
| `Module disabled: {name}` | Module exists but is in `Disabled` state |
| `Function not found: {name}` | No function matching the requested name in the module |
| `Invalid function path: {path}` | Path is not in `module/function` format (must have exactly one `/`) |
| `Unsupported runtime: {ext}` | File extension has no registered runtime adapter |
| `Runtime execution error: {msg}` | The function threw or failed during execution |

## Storage API

Module file storage is handled through the `Repository` trait, which abstracts the underlying backend (filesystem or S3). Both upload and registration use the same repository operations. See [Module Format -- Repository Backends](./modules.md#repository-backends) for details.

### Module manifest and KV storage

The **module manifest** processed by barkloader follows the woofx3-ui **module-improvements-spec** (see [Module format](./modules.md)). It does **not** include a `storage` / manifest-declared Badger key map; module file assets use the `Repository` layout only.

A separate in-process **StorageClient** (gRPC to the DB proxy) may exist for other features; it is **not** driven by the current manifest schema.
