import type { LogLevel, LogQuery } from "@woofx3/api";
import type { ParsedLogLine } from "./log-line";

/** A query with its inputs validated and parsed once, not per line. */
export interface LogFilter {
  levels: ReadonlySet<LogLevel>;
  services: ReadonlySet<string>;
  fromMs: number | null;
  toMs: number | null;
  /** Lowercased, or empty for no text filter. */
  text: string;
}

const LEVELS: ReadonlySet<string> = new Set(["trace", "debug", "info", "warn", "error", "fatal", "unknown"]);

function parseTime(name: string, value: string | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`${name} must be an ISO 8601 time`);
  }
  return ms;
}

export function buildLogFilter(query: Pick<LogQuery, "levels" | "services" | "from" | "to" | "text">): LogFilter {
  for (const level of query.levels ?? []) {
    if (!LEVELS.has(level)) {
      throw new Error(`unknown log level ${JSON.stringify(level)}`);
    }
  }
  return {
    levels: new Set(query.levels ?? []),
    services: new Set(query.services ?? []),
    fromMs: parseTime("from", query.from),
    toMs: parseTime("to", query.to),
    text: (query.text ?? "").toLowerCase(),
  };
}

/**
 * Whether a line passes. A record with no readable timestamp passes a time
 * range, because dropping it would hide exactly the lines (stack traces,
 * crashes) a person is searching for.
 */
export function matchesLogFilter(filter: LogFilter, record: ParsedLogLine, rawLine: string): boolean {
  if (filter.levels.size > 0 && !filter.levels.has(record.level)) {
    return false;
  }
  if (filter.services.size > 0 && !filter.services.has(record.service)) {
    return false;
  }
  if (filter.fromMs !== null || filter.toMs !== null) {
    const ms = Date.parse(record.timestamp);
    if (!Number.isNaN(ms)) {
      if (filter.fromMs !== null && ms < filter.fromMs) {
        return false;
      }
      if (filter.toMs !== null && ms >= filter.toMs) {
        return false;
      }
    }
  }
  return filter.text === "" || rawLine.toLowerCase().includes(filter.text);
}
