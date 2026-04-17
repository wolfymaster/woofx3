# Shared Go Logging

`github.com/wolfymaster/woofx3/common/logging` provides a service logger with:

- terminal pretty JSON transport
- single-line file transport (`logs/<service>_YYYYMMDD_HHMM.log`)
- canonical record fields (`timestamp`, `service`, `level`, `message`, `metadata`)
- optional trace fields (`applicationId`, `instanceId`, `requestId`, `traceId`, `spanId`, `eventId`, `eventType`)
- key-based redaction for sensitive metadata
- runtime level control (`SetLevel`/`GetLevel`) when enabled
- child/context logger derivation (`Child`, `WithContext`)

## Basic usage

```go
logger, err := logging.New(logging.Config{
    ServiceName: "workflow",
})
if err != nil {
    panic(err)
}
defer logger.Close()

logger.Info("workflow started", "requestId", "req-123")
```

## Child and context loggers

```go
base := logger.WithContext(map[string]any{
    "traceId": "trace-1",
})

child := base.Child(map[string]any{
    "spanId": "span-1",
})

child.Info("step complete", "step", "load-workflow")
```

Child loggers inherit parent fields. If keys collide, child values override parent values.

## Config precedence

Defaults can be overridden in this order:

1. Explicit `Config` fields
2. Environment variables
3. Package defaults

Supported environment variables:

- `WOOFX3_LOG_SERVICE`
- `WOOFX3_LOG_LEVEL`
- `WOOFX3_LOG_DIR`
- `WOOFX3_LOG_ALLOW_RUNTIME_LEVEL`
- `WOOFX3_LOG_REDACT_KEYS` (comma-separated)
