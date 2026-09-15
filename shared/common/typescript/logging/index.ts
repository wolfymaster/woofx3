export { SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
export { createServiceLogger, makeLogger, resolveConfig } from "./logger";
export { makeLogFileName, makeTraceFileName } from "./naming";
export {
  currentTraceContext,
  getTelemetry,
  getTracer,
  initTelemetry,
  shutdownTelemetry,
  type Telemetry,
  withSpan,
  type WithSpanOptions,
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
