import type { LogAttributes, Logger as OtelLogger } from "@opentelemetry/api-logs";
import { pinoLevelToSeverity } from "./otel";

const MAX_FLATTEN_DEPTH = 3;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenInto(target: LogAttributes, prefix: string, value: unknown, depth: number): void {
  if (value === undefined) {
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    target[prefix] = value;
    return;
  }
  if (isPlainObject(value) && depth < MAX_FLATTEN_DEPTH) {
    for (const [key, nested] of Object.entries(value)) {
      flattenInto(target, `${prefix}.${key}`, nested, depth + 1);
    }
    return;
  }
  target[prefix] = JSON.stringify(value);
}

type PinoRecord = {
  level?: string;
  message?: string;
  metadata?: unknown;
  service?: string;
  timestamp?: string;
} & Record<string, unknown>;

function toAttributes(record: PinoRecord): LogAttributes {
  const attributes: LogAttributes = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "level" || key === "message" || key === "timestamp" || key === "metadata") {
      continue;
    }
    flattenInto(attributes, key, value, 0);
  }
  if (record.metadata !== undefined) {
    flattenInto(attributes, "metadata", record.metadata, 0);
  }
  return attributes;
}

/**
 * pino multistream destination that mirrors every record into the OTel log
 * pipeline. Added only when a collector endpoint is configured, so the
 * console/file streams are byte-identical when it is absent.
 *
 * Failures here are swallowed on purpose: a broken telemetry path must never
 * take down the process that is merely trying to log.
 */
export function createOtelLogStream(otelLogger: OtelLogger): { write(chunk: string): void } {
  return {
    write(chunk: string): void {
      try {
        const record = JSON.parse(chunk) as PinoRecord;
        const level = record.level ?? "info";
        otelLogger.emit({
          attributes: toAttributes(record),
          body: record.message ?? "",
          severityNumber: pinoLevelToSeverity(level),
          severityText: level.toUpperCase(),
          timestamp: record.timestamp ? new Date(record.timestamp) : new Date(),
        });
      } catch {
        // Unparseable line or a shutting-down provider - drop it.
      }
    },
  };
}
