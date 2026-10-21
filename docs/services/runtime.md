# Runtime

The Runtime provides lifecycle management for WoofX3 services. It bootstraps applications, manages dependent services, handles health monitoring, and ensures graceful shutdown.

## Overview

The Runtime is a shared service available in both TypeScript and Go. It provides:

- **Bootstrap**: Initialize applications and ensure dependent services are running
- **Service Retry**: Gracefully retry failed services using exponential backoff
- **Graceful Shutdown**: Handle shutdown of both application and runtime
- **Configuration**: Load environment variables from `.woofx3.json`, `.env`, or process.env
- **Health Monitoring**: Monitor service health with liveness, heartbeat, and health checks

## Core Interfaces

### Service Interface

Both runtimes implement the `Service` interface:

::: code-group

```typescript [TypeScript]
// shared/common/typescript/runtime/service.ts
interface Service<T> {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  healthcheck: boolean;
  name: string;
  type: string;
  readonly client: T;
  readonly connected: boolean;
}
```

```go [Go]
// shared/common/golang/runtime/application.go
type Service interface {
    Connect() error
    Disconnect() error
    GetClient() interface{}
    GetName() string
    GetType() string
    IsConnected() bool
}
```

:::

### Application Interface

::: code-group

```typescript [TypeScript]
// shared/common/typescript/runtime/application.ts
interface Application<TContext extends { services: ServicesRegistry }> {
  init(): Promise<void>;
  run(): Promise<void>;
  terminate(): Promise<void>;
  register<K extends string>(type: K, service: Service<unknown>): void;
  readonly context: TContext;
}

interface ApplicationClass<TContextArgs, TContext> {
  readonly context: TContextArgs;
  run(ctx: TContext): Promise<void> | void;
  init?(ctx: TContext): Promise<void> | void;
  terminate?(ctx: TContext): Promise<void> | void;
}
```

```go [Go]
// shared/common/golang/runtime/application.go
type Application interface {
    Init() error
    Run() error
    Terminate() error
    Register(name string, service Service) error
    GetContext() interface{}
}
```

:::

## Runtime Configuration

::: code-group

```typescript [TypeScript]
// shared/common/typescript/runtime/runtime.ts
interface RuntimeConfig<TContext extends { services: ServicesRegistry }> {
  application: Application<TContext>;
  
  // Optional callbacks
  runtimeInit?: (app: Application<TContext>) => Promise<void>;
  runtimeTerminate?: (app: Application<TContext>) => Promise<void>;
  
  // Health monitoring
  healthMonitor?: HealthMonitor;
  
  // Configuration
  envSchema?: z.ZodType;
  runtimeEnv?: LoadRuntimeEnvOptions;
  rootDir?: string;
}
```

```go [Go]
// shared/common/golang/runtime/runtime.go
type RuntimeConfig struct {
    Application  Application
    EnvSchema    interface{} // *schema.Schema
    RootDir      string
    OnInit       func(Application) error
    OnTerminate  func(Application) error
    HealthMonitor HealthMonitor
}
```

:::

## Creating a Runtime

::: code-group

```typescript [TypeScript]
// woofwoofwoof/src/woofwoofwoof.ts
import { createRuntime, createApplication } from "@woofx3/common/runtime";

const app = new MyApplication({ /* initial context */ });

const runtime = createRuntime({
  application: createApplication(app),
  envSchema: MyEnvSchema,
  runtimeEnv: { injectIntoProcess: true },
  healthMonitor: createNATSHealthMonitor({...}),
  runtimeInit: async (application) => {
    // Initialize services
    const config = application.context.config;
    application.register("messageBus", new MessageBusService(...));
  },
  runtimeTerminate: async () => {
    // Cleanup
  },
});

runtime.start();
```

```go [Go]
// Example usage
import "github.com/woofx3/common/runtime"

app := &MyApplication{}

runtime := runtime.NewRuntime(runtime.RuntimeConfig{
    Application: app,
    EnvSchema:   MyEnvSchema,
    OnInit: func(app runtime.Application) error {
        // Initialize services
        return app.Register("messageBus", &MessageBusService{})
    },
    OnTerminate: func(app runtime.Application) error {
        // Cleanup
        return nil
    },
})

runtime.Start()
```

:::

## Runtime Lifecycle

The runtime follows a state machine with the following states:

```
runtime_init → health_monitor_init → health_monitor_ready → services_connect 
    → services_connected → (application running + health monitoring) 
    → runtime_terminating → terminated
```

### Lifecycle States

| State | Description |
|-------|-------------|
| `runtime_init` | Load configuration, run runtimeInit callback |
| `health_monitor_init` | Initialize health monitor |
| `health_monitor_ready` | Health monitor is ready |
| `services_connect` | Connect all registered services |
| `services_connected` | Application running, health monitoring active |
| `runtime_terminating` | Disconnect services, run runtimeTerminate |
| `terminated` | Runtime stopped |

## Health Monitoring

The runtime includes a health monitoring system that:

1. Checks liveness every 3 seconds
2. Sends heartbeat every 5 seconds  
3. Performs health checks on all registered services every 5 seconds
4. Automatically retries failed services with exponential backoff

::: code-group

```typescript [TypeScript]
// shared/common/typescript/runtime/runtime.ts
interface HealthMonitor {
  liveness(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  heartbeat(): Promise<void>;
  healthCheck(services: ServicesRegistry): Promise<boolean>;
}
```

```go [Go]
// shared/common/golang/runtime/healthMonitor.go
type HealthMonitor interface {
    Liveness() error
    Start() error
    Stop() error
    Heartbeat() error
    HealthCheck(services map[string]Service) bool
}
```

:::

### NATS Health Monitor

::: code-group

```typescript [TypeScript]
import { createNATSHealthMonitor } from "@woofx3/common/runtime";

const healthMonitor = createNATSHealthMonitor({
  natsClient: natsProxy,
  applicationName: "my-service",
  requiredServices: ["messageBus", "database"],
});
```

```go [Go]
// shared/common/golang/runtime/monitor/nats.go
monitor := nats.NewHealthMonitor(nats.HealthMonitorConfig{
    Name:            "my-service",
    NATSClient:      natsClient,
    RequiredService: []string{"messageBus", "database"},
})
```

:::

## Configuration

Configuration is loaded from (in order of precedence):

1. **`.woofx3.json`** - WoofX3 configuration file
2. **`.env`** - Environment variables
3. **Process environment** - `process.env`

### Finding the config

The TypeScript, Go and Rust runtimes, and the NATS server, find the config the
same way. A config root's config file is `.woofx3.json`, or `.woofx3.config`
when there is no `.woofx3.json`. The first match wins:

| Source | Config file | `.env` |
|---|---|---|
| An explicit root passed in code (`rootDir` / `RootDir`), or NATS's `-conf` flag | the config file in that root (the `-conf` file for NATS) | that root (the `-conf` file's directory) |
| `WOOFX3_CONFIG` | the file it names, which must exist | `WOOFX3_ROOT` if set, else the file's directory |
| `WOOFX3_ROOT` | the config file in that directory, if present | that directory |
| Neither set | the config file in the nearest directory at or above the working directory that holds one | that directory, else the working directory |

`WOOFX3_CONFIG` and `WOOFX3_ROOT` are trimmed, and blank counts as unset. The Go
loader lives in its own dependency-free module, `common/config`
(`shared/common/golang/config`), which the Go runtime and the NATS server both
use.

A `WOOFX3_CONFIG` naming a missing file stops the service at startup: a
deployment that names its config file should not start on defaults instead.
Under `WOOFX3_ROOT` a missing file is fine, as everywhere else: the service is
then configured by variables alone. When neither variable is set, NATS falls
back to the config files next to its executable if the search finds none; with
either variable set it does not.

A config file that exists but cannot be read, is not valid JSON, or does not hold
a JSON object stops the service at startup with the file's path in the error,
whether it was named or found by the search.

Rust services read no `.env` file; for them only the config file column applies.

### The data directory

`WOOFX3_DATA_DIR` names one directory for everything the engine writes. It is
read from the process environment only, never from `.woofx3.json`, so the
orchestrator and every service it starts agree on it. Unset or blank, it has no
effect: every path below resolves from its own setting alone.

When it is set:

| What | Setting | Resolves to |
|---|---|---|
| System database (SQLite) | `databaseUrl` / `WOOFX3_DATABASE_URL` | a relative `sqlite://` path under the data dir, its directory created; `sqlite:///C:/…` and `sqlite:///…` paths are used as given on every OS |
| Module storage | `storagePath` / `WOOFX3_STORAGE_PATH` | a relative path under the data dir |
| Installed modules (file provider) | `storage.file.destination`, `MODULES_DIR`, default `./modules` | a relative path under the data dir |
| Module uploads in progress | `./uploads` | `<data dir>/uploads` |
| sceneManager font cache | `<rootPath>/cache/fonts` | `<data dir>/cache/fonts` |
| Logs (every service, `migrate` and the orchestrator) | `<rootPath>/logs`, `<exe dir>/logs`, `./logs` | `WOOFX3_LOG_DIR` if set (relative under the data dir), else `<data dir>/logs` |

Absolute paths are always used as given, and Postgres URLs are untouched.
`WOOFX3_DATA_DIR` itself must be absolute: a relative value stops every service
and the orchestrator at startup, since each would otherwise resolve it against
its own working directory and write somewhere different. Rust
services also accept `logDir` from `.woofx3.json` in place of `WOOFX3_LOG_DIR`,
as they do without a data directory.

An engine that ran without a data directory keeps its state when one is set.
Before starting any service, the orchestrator copies `data/` (the system
database and module storage) and `modules/` (installed modules) from its
working directory into the data directory, each only when it is not there yet.
The originals stay in place, so unsetting `WOOFX3_DATA_DIR` goes back to them,
and a directory already in the data directory is never overwritten. Each copy
is renamed into place once complete, so one that is cut short is redone on the
next start. Logs, uploads in progress and caches are not copied. Services run
without the orchestrator get no copy.

The helpers are `ResolveDataPath` (Go, `common/config`, re-exported by `common/runtime`), `resolveDataPath`
(TypeScript, `@woofx3/common/runtime`) and `resolve_data_path` (Rust,
`woofx3_runtime`); the shared loggers apply the log rule themselves.

The runtime validates configuration against a Zod schema (TypeScript) or schema (Go):

::: code-group

```typescript [TypeScript]
// woofwoofwoof/src/config.ts
import { z } from "zod";

export const WoofEnvSchema = z.object({
  woofx3MessagebusUrl: z.string().min(1),
  woofx3TwitchChannelName: z.string().min(1),
  woofx3BarkloaderWsUrl: z.string().min(1),
  woofx3DatabaseProxyUrl: z.string().min(1),
  // ... other fields
});

export type WoofEnvConfig = z.infer<typeof WoofEnvSchema>;
```

```go [Go]
// shared/common/golang/runtime/envconfig.go
var EnvSchema = schema.NewSchema(map[string]*schema.Field{
    "woofx3MessagebusUrl":    {Type: schema.String, Required: true},
    "woofx3TwitchChannelName": {Type: schema.String, Required: true},
    // ... other fields
})
```

:::

Every service's message bus client reads `messagebusUrl` and, when the bus
requires one, `messagebusToken` (`WOOFX3_MESSAGEBUS_TOKEN`). A blank token sends
none. See [Message bus hardening](./deployment.md#message-bus-hardening) for the
server side and which key each client reads.

### Staying connected to the message bus

The shared message bus clients (Go and TypeScript) own one connection each,
for the life of the process, and never give up on it:

- **Reconnects are unlimited.** When the bus goes away the connection retries
  every second plus up to half a second of random jitter, so a fleet of
  services does not reconnect in lockstep. Messages published meanwhile are
  buffered, and every subscription is restored on reconnect. Messages the bus
  sent while a subscriber was away are not replayed; a TypeScript consumer that
  mirrors state uses `onReconnect` to resynchronise.
- **The first connect waits for the bus.** The Go client returns at once and
  keeps dialling in the background. The TypeScript client retries its first
  dial 30 times, a second apart, then rejects, so a service that can run
  without the bus (the scene manager, the API's offline mode) is not held back
  forever. Both paces are named defaults: `DefaultReconnectWait` and `DefaultReconnectJitter` in Go,
  `DEFAULT_RECONNECT_POLICY` (overridable per client through
  `NATSConfig.reconnect`) in TypeScript.
- **Closed is final.** A connection closes only after an explicit close (or a
  failure the library gives up on, such as a revoked credential). The client
  does not dial a replacement, which would silently carry none of the old
  subscriptions: every later call fails with "NATS connection is closed", the
  Go client's `Healthy()` reports false, and the TypeScript client's
  `isClosed()` reports true. The runtime notices a closed Go connection
  because the NATS health monitor's liveness publish then fails with the
  closed error.
- **Connection events are logged.** Connect, disconnect, reconnect and close
  are logged through the injected logger. In Go, asynchronous errors are too:
  a slow consumer that is dropping messages logs its subject, the error, and
  its pending message and byte counts and dropped total. The TypeScript client
  requires a logger; there is no console fallback.

## Graceful Shutdown

The runtime handles graceful shutdown on:

- `SIGTERM`
- `SIGINT`
- `uncaughtException` (TypeScript only)
- `unhandledRejection` (TypeScript only)

::: code-group

```typescript [TypeScript]
// woofwoofwoof/src/woofwoofwoof.ts
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, starting graceful shutdown...`);
  try {
    await runtime.stop();
    console.log("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
```

```go [Go]
// shared/common/golang/runtime/runtime.go
func (r *Runtime) Start() {
    // ... runtime start logic
    
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
    
    go func() {
        <-sigChan
        r.Stop()
    }()
}
```

:::

## Backoff Strategy

Failed services are retried using exponential backoff:

- Initial delay: 1000ms
- Maximum delay: 60000ms (1 minute)
- On failure: delay doubles, resets if exceeds maximum

::: code-group

```typescript [TypeScript]
// shared/common/typescript/runtime/runtime.ts
function calculateNextBackoffDelay(currentDelay?: number): number {
  const nextDelay = (currentDelay || 1000) * 2;
  return nextDelay > 60000 ? 1000 : nextDelay;
}
```

```go [Go]
// shared/common/golang/runtime/backoff.go
func CalculateNextBackoffDelay(currentDelay time.Duration) time.Duration {
    nextDelay := currentDelay * 2
    if nextDelay > 60*time.Second {
        return time.Second
    }
    return nextDelay
}
```

:::
