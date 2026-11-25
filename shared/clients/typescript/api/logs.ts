/** Severity of a log record. `unknown` is a line that was not a JSON record or named no known level. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

/** One log record, as every engine service writes it (one JSON object per line). */
export interface LogRecordItem {
  /**
   * Where this record's line starts: `<file>:<byte offset>`. Opaque to callers.
   * Passing it as `LogQuery.cursor` returns the records written before it.
   */
  cursor: string;
  timestamp: string;
  service: string;
  level: LogLevel;
  message: string;
  metadata: Record<string, unknown>;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  eventId?: string;
  eventType?: string;
  instanceId?: string;
}

/** A log file the engine holds. Trace files are not listed: they hold spans, not records. */
export interface LogFileInfo {
  name: string;
  service: string;
  sizeBytes: number;
  /** When the file was last written. */
  modifiedAt: string;
}

export interface LogQuery {
  /** Only these levels; empty or absent means all. */
  levels?: LogLevel[];
  /** Only these services; empty or absent means all. */
  services?: string[];
  /** Inclusive lower bound, ISO 8601. */
  from?: string;
  /** Exclusive upper bound, ISO 8601. */
  to?: string;
  /** Case-insensitive substring searched over the whole line, metadata included. */
  text?: string;
  /** `nextCursor` of a previous page: continue with older records. */
  cursor?: string;
  /** At most 500; defaults to 100. */
  limit?: number;
}

/** Newest first. */
export interface LogPage {
  records: LogRecordItem[];
  /**
   * Where to continue, or null when every file has been read. A page may hold
   * fewer records than `limit` and still carry a cursor: a query stops after
   * scanning a fixed amount of log, so a rare match does not hold a request open.
   */
  nextCursor: string | null;
}

/** What a log access token is good for. */
export type LogAccessScope = "stream" | "export";

/**
 * A short-lived credential for the engine's plain HTTP log routes. A browser
 * `EventSource` or download link cannot send headers, so the token travels in
 * the query string: `GET /logs/stream?token=...` or `GET /logs/export?token=...`.
 */
export interface LogAccess {
  token: string;
  expiresAt: string;
}
