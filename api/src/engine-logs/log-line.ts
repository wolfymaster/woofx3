import type { LogLevel, LogRecordItem } from "@woofx3/api";

const KNOWN_LEVELS: ReadonlySet<string> = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);

const OPTIONAL_STRING_FIELDS = ["requestId", "traceId", "spanId", "eventId", "eventType", "instanceId"] as const;

/** A record before the file position that locates it is known. */
export type ParsedLogLine = Omit<LogRecordItem, "cursor">;

function levelOf(value: unknown): LogLevel {
  const lowered = typeof value === "string" ? value.toLowerCase() : "";
  return KNOWN_LEVELS.has(lowered) ? (lowered as LogLevel) : "unknown";
}

/**
 * Reads one log line. A line that is not a JSON object (a stack trace a
 * service printed, a half-written line at the end of a file) comes back as an
 * `unknown`-level record holding the raw text, so the explorer shows it
 * instead of silently dropping it.
 */
export function parseLogLine(line: string): ParsedLogLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { timestamp: "", service: "", level: "unknown", message: line, metadata: {} };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { timestamp: "", service: "", level: "unknown", message: line, metadata: {} };
  }
  const fields = parsed as Record<string, unknown>;
  const metadata = fields.metadata;
  const record: ParsedLogLine = {
    timestamp: typeof fields.timestamp === "string" ? fields.timestamp : "",
    service: typeof fields.service === "string" ? fields.service : "",
    level: levelOf(fields.level),
    message: typeof fields.message === "string" ? fields.message : "",
    metadata:
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
  };
  for (const field of OPTIONAL_STRING_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && value !== "") {
      record[field] = value;
    }
  }
  return record;
}
