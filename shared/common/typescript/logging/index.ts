export { type Counter, type Histogram, type Meter, type Span, SpanKind, SpanStatusCode } from "@opentelemetry/api";
export { createServiceLogger, makeLogger, resolveConfig } from "./logger";
export { LONG_DURATION_BUCKETS_SECONDS, SHORT_DURATION_BUCKETS_SECONDS } from "./metric-buckets";
export { makeLogFileName, makeTraceFileName } from "./naming";
export {
  buildMeterProvider,
  buildSampler,
  currentTraceContext,
  getMeter,
  getTelemetry,
  getTracer,
  initTelemetry,
  shutdownTelemetry,
  type Telemetry,
  type WithSpanOptions,
  withSpan,
} from "./otel";
export type {
  CreateServiceLoggerOptions,
  LoggerConfigOverride,
  LoggerContext,
  LoggingConfig,
  LogMetadata,
  LogRecord,
  SharedLogger,
} from "./types";
