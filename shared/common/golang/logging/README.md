# Shared Go Logging

`github.com/wolfymaster/woofx3/common/logging` provides a service logger with:

- terminal pretty JSON transport
- single-line file transport (`logs/<service>_YYYYMMDD_HHMM.log`)
- OTLP transport that ships records to an OpenTelemetry collector when one is configured
- OpenTelemetry tracing (`StartSpan`) with automatic `traceId`/`spanId` on log records
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

## OpenTelemetry

Telemetry is opt-in. With none of the variables below set the logger behaves
exactly as it always has -- terminal plus file transports, tracing disabled,
and the global no-op `TracerProvider` left in place.

- `WOOFX3_OTEL_ENABLED` (bool) -- master switch. Defaults to `true` when
  `WOOFX3_OTEL_EXPORTER_ENDPOINT` is set, otherwise `false`.
- `WOOFX3_OTEL_EXPORTER_ENDPOINT` -- OTLP/HTTP collector base URL, for example
  `http://localhost:4318`. The signal paths (`/v1/logs`, `/v1/traces`) are
  appended automatically. Unset means no collector is available.
- `WOOFX3_OTEL_TRACING_ENABLED` (bool) -- independent override for tracing.
  Defaults to the value of `WOOFX3_OTEL_ENABLED`.
- `WOOFX3_OTEL_LOCAL_FILE_ENABLED` (bool, default `true`) -- when tracing is
  enabled but no collector is configured, spans are written to
  `logs/<service>_traces_YYYYMMDD_HHMM.log` instead of being dropped.

These follow the same precedence as the `WOOFX3_LOG_*` variables. The
equivalent `Config` fields are `*bool` so that `nil` means "resolve from the
environment" and a non-nil value overrides it:

```go
enabled := false
logger, err := logging.New(logging.Config{
    ServiceName: "workflow",
    OTelEnabled: &enabled,
})
```

## Tracing

`StartSpan` uses the globally registered tracer provider, which is the OTel
no-op implementation unless tracing is enabled, so call sites need no feature
flag of their own:

```go
ctx, span := logging.StartSpan(ctx, "GET /twirp/Ping",
    attribute.String("url.path", r.URL.Path),
)
defer span.End()

logger.InfoContext(ctx, "handling request")
```

Records logged with a context carrying an active span are stamped with
`traceId` and `spanId`. `logging.ContextWithRequestID(ctx, id)` does the same
for the reserved `requestId` field. Attributes passed explicitly at the call
site always win over the context-derived values.

Cross-service trace context propagation (api to db-proxy to barkloader over
gRPC/Twirp/NATS) is not wired up yet.
