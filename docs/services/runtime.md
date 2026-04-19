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
