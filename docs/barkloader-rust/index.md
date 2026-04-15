# Barkloader (Rust)

Module and plugin system for woofx3. Users upload modules as ZIP archives containing a manifest, executable code, commands, workflows, and assets that extend the platform.

Barkloader is a Rust service built on Actix-web. It manages the full module lifecycle: upload, extraction, manifest parsing, storage, and sandboxed code execution. Other services invoke module functions over WebSocket.

::: info
This is the primary barkloader implementation, replacing the [TypeScript barkloader](../barkloader/) which is deprecated.
:::

## Architecture

```
Upload Flow:                    Execution Flow:

POST /functions                 WebSocket invoke
  |                               |
  v                               v
FileService (extract zip)       ModuleRegistry.get_function()
  |                               |  (RwLock<HashMap> read)
  v                               v
ModuleService (parse manifest)  FunctionExecutor.execute()
  |                               |
  v                               v
Repository.create()             QuickJS/Lua runtime
  |                               |
  v                               v
Store under modules/{id}/       Return result
Archive to archives/{id}/
  |
  v                             Startup Flow:
(Upload complete)
                                Repository.list_prefix("modules/")
Registration Flow:                |
                                  v
POST /functions/{name}/register Read code files from repository
  |                               |
  v                               v
Repository.read() -> code       ModuleRegistry.register()
  |                               |
  v                               v
ModuleRegistry.register()       Ready to serve
  |
  v
Available for execution
```

Upload and registration are separate processes. Upload stores artifacts to the repository. Registration loads code into the in-memory `ModuleRegistry` so it is available for execution. At startup, barkloader scans the repository for previously stored modules and loads them automatically.

## Crate Structure

The project is a Cargo workspace with three crates:

| Crate | Path | Purpose |
|-------|------|---------|
| **app** | `barkloader-rust/app/` | HTTP server, routes, file processing, module service |
| **lib_sandbox** | `barkloader-rust/lib_sandbox/` | Sandboxed execution engine, runtime adapters, module registry |
| **lib_repository** | `barkloader-rust/lib_repository/` | Storage abstraction (filesystem, S3) |

## Configuration

All configuration is via environment variables with sensible defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| `BARKLOADER_PORT` | `9653` | HTTP/WebSocket server port |
| `MODULES_DIR` | `modules` | Directory for stored module files |
| `REPOSITORY_TYPE` | `file` | Storage backend (`file` or `s3`) |
| `RUST_LOG` | `info` | Log level filter |

### S3 Configuration

Required only when `REPOSITORY_TYPE=s3`.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET` | `barkloader-assets` | S3 bucket name |
| `S3_PREFIX` | -- | Key prefix for all objects |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | -- | AWS region |
| `AWS_ACCESS_KEY_ID` / `AWS_ACCESS_KEY` | -- | AWS access key |
| `AWS_SECRET_ACCESS_KEY` / `AWS_SECRET_KEY` | -- | AWS secret key |
| `S3_ENDPOINT` | -- | Custom endpoint (for MinIO/LocalStack) |
| `S3_FORCE_PATH_STYLE` | `false` | Enable path-style bucket access |

A `.env` file is loaded automatically if present.

## Server Binding

The server binds to `127.0.0.1` only -- it is not exposed externally by default. This is intentional since barkloader is an internal service accessed by other woofx3 services over the local network.

## Client Library

Other services connect via the shared `BarkloaderClient` (`@woofx3/barkloader`):

```typescript
import BarkloaderClient from "@woofx3/barkloader";

const client = new BarkloaderClient({
  wsUrl: "ws://localhost:9653/ws",
  onOpen: () => console.log("connected"),
  onClose: () => console.log("disconnected"),
  onError: (err) => console.error(err),
  reconnectTimeout: 5000,
  maxRetries: Infinity,
});

client.connect();

client.registerHandler("onMessage", (msg) => {
  console.log(msg.command, msg.args);
});

client.send(JSON.stringify({
  type: "invoke",
  data: { function: "mymodule/greet", args: { name: "wolfy" } }
}));
```

### BarkloaderClientConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `wsUrl` | string | -- | WebSocket URL to connect to |
| `onOpen` | EventListener | -- | Connection opened callback |
| `onClose` | EventListener | -- | Connection closed callback |
| `onError` | EventListener | -- | Error callback |
| `reconnectTimeout` | number | `5000` | Milliseconds between reconnect attempts |
| `maxRetries` | number | `Infinity` | Maximum reconnection attempts |
| `onReconnectAttempt` | function | -- | Called on each reconnect attempt with `(attempt, maxRetries)` |

### BarkloaderMessageResponse

```typescript
interface BarkloaderMessageResponse {
  args: Record<string, any>;
  command: string;
  error: string;
  message: string;
}
```
