import fs from "node:fs";
import path from "node:path";
import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type Logger as PinoLogger,
  multistream,
  type StreamEntry,
} from "pino";
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

const contextKeys = new Set([
  "applicationId",
  "eventId",
  "eventType",
  "instanceId",
  "requestId",
  "spanId",
  "traceFlags",
  "traceId",
]);

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function resolveConfig(configOverride?: Partial<LoggingConfig>): LoggingConfig {
  const defaults: LoggingConfig = {
    level: "info",
    logDir: "logs",
    prettyConsole: true,
    redactPaths: defaultRedactPaths,
    runtimeLevelChanges: true,
    singleLineFile: true,
  };

  const fromEnv: Partial<LoggingConfig> = {
    level: (process.env.WOOFX3_LOG_LEVEL as LevelWithSilent | undefined) ?? defaults.level,
    logDir: process.env.WOOFX3_LOG_DIR ?? defaults.logDir,
    prettyConsole: toBool(process.env.WOOFX3_LOG_PRETTY, defaults.prettyConsole),
    runtimeLevelChanges: toBool(process.env.WOOFX3_LOG_DYNAMIC_LEVEL, defaults.runtimeLevelChanges),
    singleLineFile: toBool(process.env.WOOFX3_LOG_FILE_ENABLED, defaults.singleLineFile),
  };

  return {
    ...defaults,
    ...fromEnv,
    ...(configOverride ?? {}),
    redactPaths: configOverride?.redactPaths ?? fromEnv.redactPaths ?? defaults.redactPaths,
  };
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

function makeLogFileName(serviceName: string, now: Date): string {
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hour = now.getHours().toString().padStart(2, "0");
  const minute = now.getMinutes().toString().padStart(2, "0");
  return `${serviceName}_${year}${month}${day}_${hour}${minute}.log`;
}

function createPinoLogger(serviceName: string, config: LoggingConfig): PinoLogger {
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
    private readonly boundContext: LoggerContext = {}
  ) {}

  private emit(level: "debug" | "error" | "fatal" | "info" | "warn", message: string, metadata: LogMetadata = {}): void {
    const merged = { ...this.boundContext, ...metadata };
    const split = splitContext(merged);
    this.logger[level](
      {
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
    return new SharedPinoLogger(this.logger, this.serviceName, this.runtimeLevelChanges, {
      ...this.boundContext,
      ...context,
    });
  }

  withContext(context: LoggerContext): SharedLogger {
    return this.child(context);
  }
}

export function createServiceLogger(options: CreateServiceLoggerOptions): SharedLogger {
  const config = resolveConfig({
    ...(options.configOverride ?? {}),
    ...(options.logDir != null ? { logDir: options.logDir } : {}),
  });
  const logger = createPinoLogger(options.serviceName, config);
  return new SharedPinoLogger(logger, options.serviceName, config.runtimeLevelChanges, options.context ?? {});
}

export function makeLogger(options: CreateServiceLoggerOptions): SharedLogger {
  return createServiceLogger(options);
}
