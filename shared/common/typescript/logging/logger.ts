import fs from "node:fs";
import path from "node:path";
import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type Logger as PinoLogger,
  multistream,
  type StreamEntry,
} from "pino";
import { dataDir, resolveDataPath } from "../runtime/data-dir";
import { makeLogFileName } from "./naming";
import { currentTraceContext, initTelemetry, type Telemetry } from "./otel";
import { createOtelLogStream } from "./otel-log-stream";
import type { CreateServiceLoggerOptions, LoggerContext, LoggingConfig, LogMetadata, SharedLogger } from "./types";

const defaultRedactPaths = [
  "metadata.password",
  "metadata.passphrase",
  "metadata.secret",
  "metadata.token",
  "metadata.authorization",
  "metadata.cookie",
  "*.password",
  "*.secret",
  "*.token",
];

const contextKeys = new Set(["eventId", "eventType", "instanceId", "requestId", "spanId", "traceFlags", "traceId"]);

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

export function resolveConfig(configOverride?: Partial<LoggingConfig>): LoggingConfig {
  const defaults: LoggingConfig = {
    level: "info",
    logDir: "logs",
    otelEnabled: false,
    otelExporterEndpoint: "",
    otelLocalFileEnabled: true,
    otelTracingEnabled: false,
    prettyConsole: true,
    redactPaths: defaultRedactPaths,
    runtimeLevelChanges: true,
    singleLineFile: true,
  };

  // Having a collector configured is what turns OTel on by default; without
  // one the whole subsystem stays dormant and behaviour matches the
  // pre-OTel console+file logger exactly.
  const otelExporterEndpoint = process.env.WOOFX3_OTEL_EXPORTER_ENDPOINT ?? defaults.otelExporterEndpoint;
  const otelEnabled = toBool(process.env.WOOFX3_OTEL_ENABLED, otelExporterEndpoint !== "");

  const fromEnv: Partial<LoggingConfig> = {
    level: (process.env.WOOFX3_LOG_LEVEL as LevelWithSilent | undefined) ?? defaults.level,
    logDir: process.env.WOOFX3_LOG_DIR ?? defaults.logDir,
    otelEnabled,
    otelExporterEndpoint,
    otelLocalFileEnabled: toBool(process.env.WOOFX3_OTEL_LOCAL_FILE_ENABLED, defaults.otelLocalFileEnabled),
    otelTracingEnabled: toBool(process.env.WOOFX3_OTEL_TRACING_ENABLED, otelEnabled),
    prettyConsole: toBool(process.env.WOOFX3_LOG_PRETTY, defaults.prettyConsole),
    runtimeLevelChanges: toBool(process.env.WOOFX3_LOG_DYNAMIC_LEVEL, defaults.runtimeLevelChanges),
    singleLineFile: toBool(process.env.WOOFX3_LOG_FILE_ENABLED, defaults.singleLineFile),
  };

  return withDataDirLogs({
    ...defaults,
    ...fromEnv,
    ...(configOverride ?? {}),
    redactPaths: configOverride?.redactPaths ?? fromEnv.redactPaths ?? defaults.redactPaths,
  });
}

/**
 * With a data directory the logs are part of the engine's data and live in it: WOOFX3_LOG_DIR,
 * anchored in the data directory when relative, else `<data dir>/logs`. A `logDir` from the caller
 * is then ignored, because callers name a directory under the install root, which may not be
 * writable (Program Files on Windows). Without a data directory the config is returned as is.
 */
function withDataDirLogs(config: LoggingConfig): LoggingConfig {
  if (dataDir() === undefined) {
    return config;
  }
  const fromEnv = process.env.WOOFX3_LOG_DIR?.trim();
  return { ...config, logDir: resolveDataPath(fromEnv ? fromEnv : "logs") };
}

function createPrettyConsoleStream() {
  return {
    write(chunk: string) {
      try {
        const parsed = JSON.parse(chunk) as unknown;
        process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
      } catch {
        process.stdout.write(chunk);
      }
    },
  };
}

function splitContext(metadata: LogMetadata): { context: LoggerContext; metadata: LogMetadata } {
  const nextContext: LoggerContext = {};
  const nextMetadata: LogMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (contextKeys.has(key)) {
      nextContext[key] = value;
    } else {
      nextMetadata[key] = value;
    }
  }

  return {
    context: nextContext,
    metadata: nextMetadata,
  };
}

function createPinoLogger(serviceName: string, config: LoggingConfig, telemetry: Telemetry): PinoLogger {
  fs.mkdirSync(config.logDir, { recursive: true });

  const streams: StreamEntry[] = [];

  if (config.prettyConsole) {
    streams.push({
      stream: createPrettyConsoleStream() as DestinationStream,
    });
  }

  if (config.singleLineFile) {
    const filePath = path.join(config.logDir, makeLogFileName(serviceName, new Date()));
    // Ensure the boot file exists as soon as the logger is initialized.
    fs.closeSync(fs.openSync(filePath, "a"));
    streams.push({
      stream: pino.destination({
        dest: filePath,
        mkdir: true,
        sync: false,
      }),
    });
  }

  // Additive: the OTel bridge is one more sink alongside console and file,
  // never a replacement for either.
  if (telemetry.otelLogger) {
    streams.push({
      stream: createOtelLogStream(telemetry.otelLogger) as DestinationStream,
    });
  }

  return pino(
    {
      base: undefined,
      level: config.level,
      messageKey: "message",
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      redact: {
        censor: "[REDACTED]",
        paths: config.redactPaths,
      },
    },
    multistream(streams)
  );
}

class SharedPinoLogger implements SharedLogger {
  constructor(
    private readonly logger: PinoLogger,
    private readonly serviceName: string,
    private readonly runtimeLevelChanges: boolean,
    private readonly traceCorrelation: boolean,
    private readonly boundContext: LoggerContext = {}
  ) {}

  private emit(
    level: "debug" | "error" | "fatal" | "info" | "warn",
    message: string,
    metadata: LogMetadata = {}
  ): void {
    const merged = { ...this.boundContext, ...metadata };
    const split = splitContext(merged);
    // Only consulted while a span processor is installed, so console and
    // file output are unchanged when tracing is off.
    const traceContext = this.traceCorrelation ? currentTraceContext() : null;
    this.logger[level](
      {
        ...(traceContext ?? {}),
        ...split.context,
        metadata: split.metadata,
        service: this.serviceName,
      },
      message
    );
  }

  info(message: string, metadata?: LogMetadata): void {
    this.emit("info", message, metadata);
  }

  error(message: string, metadata?: LogMetadata): void {
    this.emit("error", message, metadata);
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.emit("warn", message, metadata);
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.emit("debug", message, metadata);
  }

  fatal(message: string, metadata?: LogMetadata): void {
    this.emit("fatal", message, metadata);
  }

  setLevel(level: LevelWithSilent): void {
    if (!this.runtimeLevelChanges) {
      return;
    }
    this.logger.level = level;
  }

  getLevel(): LevelWithSilent {
    return this.logger.level as LevelWithSilent;
  }

  child(context: LoggerContext): SharedLogger {
    return new SharedPinoLogger(this.logger, this.serviceName, this.runtimeLevelChanges, this.traceCorrelation, {
      ...this.boundContext,
      ...context,
    });
  }

  withContext(context: LoggerContext): SharedLogger {
    return this.child(context);
  }
}

export function createServiceLogger(options: CreateServiceLoggerOptions): SharedLogger {
  if (!options.serviceName) {
    throw new Error("createServiceLogger: serviceName is required");
  }
  const config = resolveConfig({
    ...(options.configOverride ?? {}),
    ...(options.logDir != null ? { logDir: options.logDir } : {}),
  });
  const telemetry = initTelemetry({ config, serviceName: options.serviceName });
  const logger = createPinoLogger(options.serviceName, config, telemetry);
  return new SharedPinoLogger(
    logger,
    options.serviceName,
    config.runtimeLevelChanges,
    telemetry.tracingActive,
    options.context ?? {}
  );
}

export function makeLogger(options: CreateServiceLoggerOptions): SharedLogger {
  return createServiceLogger(options);
}
