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
  healthcheck: boolean | (() => Promise<boolean>);
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

In TypeScript, the NATS health monitor calls a function-valued `healthcheck` on every health check; the function must settle within its own bound, and a `false` result fails the check like any other, so the runtime reconnects its services. `createNATSHealthCheck` instead waits for a ready heartbeat from each service whose `healthcheck` is `true`. A service set to `false` is not checked.

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
// src/server.ts
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

1. Checks liveness every 3 seconds (a connectivity ping on `_HEALTH.<application>.ping`)
2. Sends heartbeat every 5 seconds, a `com.woofx3.heartbeat` message on `HEARTBEAT` built from and checked against the [heartbeat contract](/services/cloudevents#message-contracts); a message on that subject that does not fit is ignored
3. Performs health checks on all registered services every 5 seconds (`HEALTH_CHECK_INTERVAL_MS`)
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

### Telemetry origin and authentication

Every service in all three runtimes reads two settings that let a central
collector tell engines apart and accept their telemetry:

| Setting | Env var | Meaning |
|---|---|---|
| `otelResourceAttributes` | `WOOFX3_OTEL_RESOURCE_ATTRIBUTES` | `key=value` pairs merged into every OTel resource. `service.name` always stays the process's own name. |
| `otelExporterHeaders` | `WOOFX3_OTEL_EXPORTER_HEADERS` | `key=value` headers sent on every OTLP request. A secret: never logged. |

`WOOFX3_VERSION`, when set, is reported as `service.version`. A pair without a
key stops the service at startup instead of being skipped, so telemetry is
never sent unauthenticated or unattributed by accident. Unset, all three leave
behaviour unchanged.

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
// src/config.ts
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

Every service's message bus client reads `messagebusUrl` and
`messagebusToken` (`WOOFX3_MESSAGEBUS_TOKEN`), which the bus requires unless it
was started without authentication. A blank token sends none. See [Message bus hardening](./deployment.md#message-bus-hardening) for the
server side and which key each client reads.

### Metrics

With a collector configured, every service exports metrics over the same OTLP endpoint, resource and headers as logs and traces (`/v1/metrics`). `WOOFX3_OTEL_METRICS_ENABLED` turns metrics off on their own and `WOOFX3_OTEL_METRICS_INTERVAL_MS` sets the export interval (default 60000). With no collector there is no metrics output.

Durations are histograms in seconds with explicit bucket boundaries. Attributes stay bounded: no viewer, user, alert, workflow or run id, and no concrete message subject.

| Metric | Type | Unit | Attributes | Emitted by |
|---|---|---|---|---|
| `woofx3.events.received` | counter | `{event}` | `event.type`, `platform` | connectors: every event a platform adapter builds, counted before it is published |
| `woofx3.events.last_received_time` | observable gauge | `s` (Unix time) | `platform` | connectors: when the latest event arrived. A value that stops moving while a stream is live means events stopped arriving |
| `woofx3.event.ingest.lag` | histogram | `s` | `platform` | connectors: platform timestamp to arrival, for events whose payload carries a timestamp (Twitch follows and channel point redemptions) |
| `woofx3.event_shipper.queue.size` | observable gauge | `{event}` | `target` | api: envelopes buffered for a Convex events target |
| `woofx3.event_shipper.dropped` | counter | `{event}` | `target` | api: envelopes dropped because the buffer was full |
| `woofx3.event_shipper.post.duration` | histogram | `s` | `target` | api: each POST to the target, delivered or not |
| `woofx3.event_shipper.post.failures` | counter | `{request}` | `target` | api: POSTs that were retried or refused |
| `messaging.process.duration` | histogram | `s` | `messaging.system=nats`, `messaging.destination.name`, `error.type` | the TypeScript NATS client: each subscription handler call. The destination is the subscription's pattern, never the message's concrete subject; `error.type` is the thrown error's name |
| `rpc.client.duration` | histogram | `s` | `rpc.system=twirp`, `rpc.service`, `rpc.method`, `error.type` | the TypeScript db client (every service that builds its config with `dbProxyClientConfig`) and the Rust Twirp client: each call to db-proxy. `error.type` is the Twirp error code, `http_<status>` for a non-Twirp error response, or `request` when there was no response |
| `woofx3.barkloader.function.duration` | histogram | `s` | `module.id`, `function.name`, `outcome` (`ok`, `error`) | barkloader: each module function run in the sandbox |
| `woofx3.workflow.runs` | counter | `{run}` | `outcome` (`completed`, `failed`, `cancelled`, `timed_out`), `trigger.type` | workflow: runs that reached a final state. `timed_out` is a run failed by a wait step's timeout. `trigger.type` is the triggering event's type. Dry runs are not counted |
| `woofx3.workflow.run.duration` | histogram | `s` | `outcome` | workflow: start to final state |
| `woofx3.workflow.runs.active` | up-down counter | `{run}` | none | workflow: runs started and not yet in a final state, including queued and waiting ones |
| `woofx3.workflow.step.duration` | histogram | `s` | `step.action`, `outcome` (`success`, `failed`, `cancelled`) | workflow: each settled step. `step.action` is the registered action, or the task type for non-action steps. Skipped steps are not timed |
| `messaging.process.duration` | histogram | `s` | `messaging.system=nats`, `messaging.destination.name`, `error.type` | Go NATS client: each subscription handler. The destination is the subscription pattern, never the concrete subject. Handlers return no error, so `error.type` is only `panic` |
| `rpc.server.duration` | histogram | `s` | `rpc.system=twirp`, `rpc.service`, `rpc.method`, `error.type` | db-proxy: every Twirp call it serves, refused ones included. `error.type` is the Twirp error code |
| `rpc.client.duration` | histogram | `s` | `rpc.system=twirp`, `rpc.service`, `rpc.method`, `error.type` | Go db client (workflow): every Twirp call. `error.type` is the Twirp code, `unknown` when the body is not a Twirp error, `transport_error` when there was no response |
| `woofx3.alerts` | counter | `{alert}` | `outcome` | sceneManager: `queued` (recorded for a running scene), `played` (a page reported it finished), `skipped` (Skip ended the playing alert), `dropped` (Clear removed a waiting one), `failed` (unusable, or a widget's frame could not be built), `undelivered` (fine, but no running scene had an alert widget to receive it, as when no overlay is open; failure rates leave it out). An alert shown on several widgets is counted as `played` once per ack that closes it |
| `woofx3.alerts.queue.depth` | observable gauge | `{alert}` | none | sceneManager: alerts no page has started yet, counted once however many widgets hold them |
| `woofx3.alerts.queue.wait` | histogram | `s` | none | sceneManager: from an alert being recorded for a widget to a page reporting it started. Alerts recovered after a restart have no recorded time and are left out |
| `woofx3.event.pipeline.duration` | histogram | `s` | `stage` (`layout`, `frames`, `scenes`, `record`) | sceneManager: time an alert's dispatch spends in each stage before any page hears of it |
| `woofx3.dependency.up` | observable gauge | `1` | `dependency` (`nats`, `db`, `barkloader`, `convex_queue`) | api: 1 or 0 each collection. `nats` is the client not being closed, `db` a db-proxy call succeeding, `barkloader` a fresh heartbeat, `convex_queue` the last POST to every events target delivering. A dependency that cannot be told (messaging not configured, nothing shipped yet) is not reported |
| `woofx3.platform.connection.up` | observable gauge | `1` | `platform` | connectors: 1 while every required Twitch EventSub subscription is confirmed |
| `woofx3.platform.reconnects` | counter | `{reconnect}` | `platform` | connectors: each Twitch connection made after the first, whether the host restarted the adapter or a relink reconnected it |

`target` is the host of the events URL.

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
// src/server.ts
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

## Signal-driven shutdown helper

TypeScript entrypoints call `installShutdown` from `@woofx3/common/runtime` instead of hand-rolling signal handlers. Everything it touches is injected, so tests drive it with a fake process and fake timers.

```typescript
import { installShutdown } from "@woofx3/common/runtime";

installShutdown({
  stop: () => runtime.stop(), // the runtime's own stop()
  logger,
  deadlineMs: config.shutdownDeadlineMs,
  exit: (code) => process.exit(code),
  process,
  timers: { setTimeout, clearTimeout },
});
```

- `SIGTERM`, `SIGINT` and `SIGBREAK` (the orchestrator's stop request on Windows) are trapped. The first one calls `stop`.
- A second signal, or `deadlineMs` elapsing before `stop` settles, exits with code 1 and logs which of the two happened.
- A clean stop exits 0; a `stop` that throws exits 1.
- `uncaughtException` is logged and then shuts down like a signal, but always exits 1. `unhandledRejection` is logged and the process keeps running.
- `deadlineMs` must be greater than 0; there is no default, the caller names its own.
- `dispose()` removes the listeners, cancels a pending deadline, and stops an in-flight stop from exiting the process.

## Capped backoff helper

`createBackoff({ baseMs, maxMs }, random)` from `@woofx3/common/runtime` returns `{ next(), reset() }` for retry loops (connection re-dials, refresh retries).

- Exponential with full jitter: the nth failure waits a random time between 0 and `min(maxMs, baseMs * 2^n)`.
- At the cap the ceiling stays put, so a long outage neither overflows nor waits longer than `maxMs`.
- `reset()` starts over after a success.
- The configuration must satisfy `0 < baseMs <= maxMs < Infinity`, otherwise construction throws. The `RandomSource` must return values in `[0, 1)`; `next()` throws otherwise. There are no default values; callers pass their own named constants.
- `RandomSource` and `Clock` are small interfaces so tests use a seeded source instead of `Math.random`.

This is separate from the service-retry strategy above, which keeps its own fixed doubling schedule.
