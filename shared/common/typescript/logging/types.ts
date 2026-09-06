import type { LevelWithSilent } from "pino";

export type LogMetadata = Record<string, unknown>;

export type LoggerContext = {
  applicationId?: string;
  eventId?: string;
  eventType?: string;
  instanceId?: string;
  requestId?: string;
  spanId?: string;
  traceFlags?: string;
  traceId?: string;
} & Record<string, unknown>;

export type LogRecord = {
  level: LevelWithSilent;
  message: string;
  metadata: LogMetadata;
  service: string;
  timestamp: string;
} & Partial<LoggerContext>;

export type LoggingConfig = {
  level: LevelWithSilent;
  logDir: string;
  /** Master OpenTelemetry switch. Defaults on when an exporter endpoint is set. */
  otelEnabled: boolean;
  /** OTLP/HTTP base URL, e.g. `http://localhost:4318`. Empty means no collector. */
  otelExporterEndpoint: string;
  /** Write spans under `logDir` when tracing is on but no collector is configured. */
  otelLocalFileEnabled: boolean;
  /** Independent tracing override. Defaults to the value of `otelEnabled`. */
  otelTracingEnabled: boolean;
  prettyConsole: boolean;
  redactPaths: string[];
  runtimeLevelChanges: boolean;
  singleLineFile: boolean;
};

export type LoggerConfigOverride = Partial<LoggingConfig>;

export interface SharedLogger {
  child(context: LoggerContext): SharedLogger;
  debug(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  fatal(message: string, metadata?: LogMetadata): void;
  getLevel(): LevelWithSilent;
  info(message: string, metadata?: LogMetadata): void;
  setLevel(level: LevelWithSilent): void;
  warn(message: string, metadata?: LogMetadata): void;
  withContext(context: LoggerContext): SharedLogger;
}

export type CreateServiceLoggerOptions = {
  configOverride?: LoggerConfigOverride;
  context?: LoggerContext;
  logDir?: string;
  serviceName: string;
};
