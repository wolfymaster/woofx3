# Shared TypeScript Logging and Telemetry

`@woofx3/common/logging` provides a pino-backed service logger plus an
OpenTelemetry layer for log export and tracing:

- pretty JSON console transport
- single-line file transport (`<logDir>/<service>_YYYYMMDD_HHMM.log`)
- canonical record fields (`timestamp`, `service`, `level`, `message`, `metadata`)
- context fields (`applicationId`, `instanceId`, `requestId`, `traceId`, `spanId`,
  `traceFlags`, `eventId`, `eventType`)
- key-based redaction for sensitive metadata
- runtime level control (`setLevel`/`getLevel`) when enabled
- child/context logger derivation (`child`, `withContext`)
- optional OTLP log export and tracing (see below)

## Basic usage

```ts
import { createServiceLogger } from "@woofx3/common/logging";

const logger = createServiceLogger({
  serviceName: "api",
  logDir: `${rootDir}/logs`,
});

logger.info("api started", { port: 8080 });
```

Child loggers inherit parent context; colliding keys are overridden by the child.

```ts
const scoped = logger.withContext({ applicationId: "app-1" });
scoped.child({ requestId: "req-1" }).info("handling request");
```

## Tracing

`withSpan` runs a function inside an active span, records thrown errors, and
always ends the span. It is safe to call unconditionally: when tracing is
disabled the OpenTelemetry API hands back a no-op tracer and the call is a thin
pass-through.

```ts
import { withSpan } from "@woofx3/common/logging";

await withSpan("api.request", async () => {
  return handleRequest(req);
}, { attributes: { "http.request.method": req.method } });
```

While tracing is active, every log record is automatically stamped with the
active span's `traceId`, `spanId`, and `traceFlags`, so console and file output
correlate with exported spans without call sites passing the ids by hand.

Telemetry is a per-process singleton initialised by the first
`createServiceLogger` call. `shutdownTelemetry()` flushes and stops the
exporters; call it from a service's graceful-shutdown path when you want spans
and log records drained before exit.

## Configuration

Precedence matches the rest of the repo:

1. Explicit `configOverride` / `logDir` passed to `createServiceLogger`
2. Environment variables
3. Package defaults

### Logging

| Variable | Default | Meaning |
| --- | --- | --- |
| `WOOFX3_LOG_LEVEL` | `info` | pino level |
| `WOOFX3_LOG_DIR` | `logs` | directory for log and trace files |
| `WOOFX3_LOG_PRETTY` | `true` | pretty JSON console transport |
| `WOOFX3_LOG_DYNAMIC_LEVEL` | `true` | allow `setLevel` at runtime |
| `WOOFX3_LOG_FILE_ENABLED` | `true` | single-line file transport |

### OpenTelemetry

| Variable | Default | Meaning |
| --- | --- | --- |
| `WOOFX3_OTEL_ENABLED` | `true` when `WOOFX3_OTEL_EXPORTER_ENDPOINT` is set, else `false` | master switch for logs and tracing |
| `WOOFX3_OTEL_EXPORTER_ENDPOINT` | unset | OTLP/HTTP base URL, e.g. `http://localhost:4318`. Unset means no collector is available |
| `WOOFX3_OTEL_TRACING_ENABLED` | value of `WOOFX3_OTEL_ENABLED` | independent override for tracing only |
| `WOOFX3_OTEL_LOCAL_FILE_ENABLED` | `true` | when tracing is on but no collector is configured, write spans under `logDir` instead of dropping them |

Booleans accept `1` or `true` (case-insensitive) for true; anything else is
false. An unset or empty value falls back to the default.

### Behaviour matrix

| Endpoint | `WOOFX3_OTEL_TRACING_ENABLED` | Logs | Traces |
| --- | --- | --- | --- |
| unset | unset | console + file only | disabled |
| unset | `true` | console + file only | `<logDir>/<service>_traces_YYYYMMDD_HHMM.log` (NDJSON) |
| unset | `true`, `WOOFX3_OTEL_LOCAL_FILE_ENABLED=false` | console + file only | dropped |
| set | unset | console + file + OTLP `/v1/logs` | OTLP `/v1/traces` |
| set | `false` | console + file + OTLP `/v1/logs` | disabled |

The default column is the important one: with nothing configured the logger
behaves exactly as it did before OpenTelemetry was introduced. The OTLP log
bridge is an *additional* pino stream, never a replacement for the console or
file streams.

## Testing

```bash
bun test logging/
bun run typecheck
```
