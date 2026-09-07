# woofx3-logging

Shared logging and tracing initialization for woofx3 Rust services. It is the Rust
counterpart to `@woofx3/common/logging` (TypeScript) and `shared/common/golang/logging`
(Go), and it uses the same `WOOFX3_OTEL_*` configuration contract as both.

One call installs the global [`tracing`](https://docs.rs/tracing) subscriber:

```rust
fn main() {
    // Hold the guard for the process lifetime; dropping it flushes every sink.
    let logging = woofx3_logging::init("barkloader").expect("initialize logging");

    tracing::info!("service started");

    drop(logging);
}
```

After `init`, every `tracing::info!` / `warn!` / `error!` / `debug!` call and every
`#[tracing::instrument]` span in the process is routed through the configured layers.
Crates that still use the `log` macros are picked up too, via `tracing-log`.

## Layers

| Layer | When it is active | Output |
| --- | --- | --- |
| Console (`fmt`) | Always | stderr, ANSI only when stderr is a TTY |
| File (`tracing-appender`) | Always | `logs/<service>_YYYYMMDD_HHMM.log` |
| OTLP logs (`opentelemetry-appender-tracing`) | `otelEnabled` **and** an endpoint | OTLP `http/protobuf` to `<endpoint>/v1/logs` |
| OTLP traces (`tracing-opentelemetry`) | `otelTracingEnabled` **and** an endpoint | OTLP `http/protobuf` to `<endpoint>/v1/traces` |
| Local traces (`FileSpanExporter`) | `otelTracingEnabled`, **no** endpoint, `otelLocalFileEnabled` | `logs/<service>_YYYYMMDD_HHMM.traces.jsonl` |

The console and file layers never depend on OpenTelemetry, so a service with no
configuration at all still logs exactly as before, with the file copy as a bonus.

The OTLP log bridge drops events whose target starts with `opentelemetry`; without
that filter the exporter's own diagnostics would feed back into itself.

## Configuration

Resolved through `woofx3_runtime::Config`, so every key can come from `.woofx3.json`
(camelCase) or from the environment (`WOOFX3_` + SCREAMING_SNAKE).

| Env var | `.woofx3.json` key | Default | Meaning |
| --- | --- | --- | --- |
| `WOOFX3_OTEL_ENABLED` | `otelEnabled` | `true` if an endpoint is set, else `false` | Master switch for OpenTelemetry |
| `WOOFX3_OTEL_EXPORTER_ENDPOINT` | `otelExporterEndpoint` | unset | OTLP base endpoint, e.g. `http://localhost:4318`. Unset means no collector |
| `WOOFX3_OTEL_TRACING_ENABLED` | `otelTracingEnabled` | value of `otelEnabled` | Independent override for tracing |
| `WOOFX3_OTEL_LOCAL_FILE_ENABLED` | `otelLocalFileEnabled` | `true` | Write trace data under `logs/` when tracing is on but no collector is configured |

Booleans accept `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off` (case-insensitive).
Anything else is a startup error rather than a silent default.

Two more knobs come from the environment only, matching the Go logger:

| Env var | Default | Meaning |
| --- | --- | --- |
| `RUST_LOG`, then `WOOFX3_LOG_LEVEL` | `info` | `EnvFilter` directive |
| `WOOFX3_LOG_DIR` | `logs` | Directory for the log and trace files |

### Configuration precedence caveat

`woofx3_runtime::Config::get` currently reads `.woofx3.json` **before** the `WOOFX3_*`
environment variable, which is the reverse of the env-first precedence documented in
`CLAUDE.md` and implemented by the Go and TypeScript loaders. In practice: if you put
`otelExporterEndpoint` in `.woofx3.json`, the matching environment variable will not
override it. Leave these keys out of `.woofx3.json` if you want to switch them per
process. Fixing the shared loader is tracked separately.

## Common setups

```bash
# Default: console + file logs, no tracing, no network.
./barkloader

# Ship logs and traces to a local collector.
WOOFX3_OTEL_EXPORTER_ENDPOINT=http://localhost:4318 ./barkloader

# Collect traces locally without a collector, for debugging.
WOOFX3_OTEL_TRACING_ENABLED=true ./barkloader

# Export logs but not traces.
WOOFX3_OTEL_EXPORTER_ENDPOINT=http://localhost:4318 \
WOOFX3_OTEL_TRACING_ENABLED=false ./barkloader
```

## Local trace file format

`FileSpanExporter` writes one JSON object per span, newline delimited:

```json
{"service":"barkloader","traceId":"...","spanId":"...","parentSpanId":null,
 "name":"GET /functions","kind":"Internal","status":"Unset",
 "startTime":"2026-09-06T23:02:13.811361Z","endTime":"...","durationMs":1.42,
 "scope":"barkloader","attributes":{},"events":[]}
```

## Instrumenting

Add spans with `#[tracing::instrument]`. Handler arguments such as
`actix_web::web::Data<T>` do not implement `Debug`, so use `skip_all` and name the
fields you actually want:

```rust
#[get("/functions/{name}")]
#[tracing::instrument(name = "GET /functions/{name}", skip_all, fields(module = %path.as_str()))]
async fn get_handler(ctx: Data<AppContext>, path: Path<String>) -> Result<HttpResponse, Error> {
    // ...
}
```

## Not included

Cross-service trace-context propagation (extracting and injecting W3C `traceparent`
between services) is deliberately out of scope. Each service currently exports only
its own spans.
