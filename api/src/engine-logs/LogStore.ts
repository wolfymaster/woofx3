import type { LogFileInfo, LogPage, LogQuery, LogRecordItem } from "@woofx3/api";
import { decodeLogPosition, encodeLogPosition, type LogPosition } from "./log-cursor";
import { listLogFiles, type LogFile } from "./log-files";
import { buildLogFilter, type LogFilter, matchesLogFilter } from "./log-filter";
import { type ParsedLogLine, parseLogLine } from "./log-line";
import { readLinesBackward, readLinesForward } from "./read-lines";

export interface LogStoreConfig {
  directory: string;
  /** A page never holds more than this many records. */
  maxPageSize: number;
  defaultPageSize: number;
  /**
   * Bytes of log a single query reads before it returns what it has with a
   * cursor, so a search for something rare cannot hold a request open.
   */
  scanBudgetBytes: number;
}

export const DEFAULT_LOG_STORE_CONFIG = {
  maxPageSize: 500,
  defaultPageSize: 100,
  scanBudgetBytes: 32 * 1024 * 1024,
} as const;

/** What one tail poll may read from one file, so a long gap is replayed in steps. */
const TAIL_READ_BYTES = 1024 * 1024;

export interface TailedRecord {
  record: LogRecordItem;
  /** `<file>:<end offset>`: where a reader resumes after this record. */
  resumeId: string;
}

export interface TailOptions {
  after: string | null;
  signal: AbortSignal;
  pollMs: number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** The engine's own log files: listing, searching, and following them. */
export class LogStore {
  constructor(private readonly config: LogStoreConfig) {
    if (config.directory === "") {
      throw new Error("LogStore needs a log directory");
    }
    if (config.defaultPageSize > config.maxPageSize || config.defaultPageSize < 1) {
      throw new Error("LogStore defaultPageSize must be between 1 and maxPageSize");
    }
  }

  get directory(): string {
    return this.config.directory;
  }

  async listFiles(): Promise<LogFileInfo[]> {
    const files = await listLogFiles(this.config.directory, { includeTraces: false });
    return files.map(({ path: _path, ...info }) => info);
  }

  /** Every file, trace files included, for the export. */
  async listAllFiles(): Promise<LogFile[]> {
    return listLogFiles(this.config.directory, { includeTraces: true });
  }

  async query(query: LogQuery): Promise<LogPage> {
    const limit = this.pageSize(query.limit);
    const filter = buildLogFilter(query);
    const files = await listLogFiles(this.config.directory, { includeTraces: false });
    const start = query.cursor === undefined ? null : decodeLogPosition(query.cursor);
    let firstIndex = 0;
    if (start !== null) {
      firstIndex = files.findIndex((file) => file.name === start.file);
      if (firstIndex === -1) {
        throw new Error("cursor names a log file that no longer exists");
      }
    }

    const records: LogRecordItem[] = [];
    let scanned = 0;
    let lastScanned: string | null = null;
    for (const file of files.slice(firstIndex)) {
      const endOffset =
        start !== null && file.name === start.file ? Math.min(start.offset, file.sizeBytes) : file.sizeBytes;
      for await (const line of readLinesBackward(file.path, endOffset)) {
        scanned += line.end - line.offset;
        lastScanned = encodeLogPosition({ file: file.name, offset: line.offset });
        const record = this.recordFor(file, line.text, line.offset, filter);
        if (record !== null) {
          records.push(record);
        }
        if (records.length >= limit || scanned >= this.config.scanBudgetBytes) {
          return { records, nextCursor: lastScanned };
        }
      }
    }
    return { records, nextCursor: null };
  }

  /**
   * Follows the log files: yields each record written after `after` (or after
   * now, when `after` is absent) that passes the filter, until `signal` aborts.
   * `after` is a `resumeId` from an earlier tail, so a dropped connection
   * resumes without a gap or a repeat. A bad filter or resume position rejects
   * here, before any record is awaited, so a caller can answer it as a bad request.
   */
  async tail(
    query: Pick<LogQuery, "levels" | "services" | "text">,
    options: TailOptions
  ): Promise<AsyncGenerator<TailedRecord>> {
    const filter = buildLogFilter(query);
    const resume = options.after === null ? null : decodeLogPosition(options.after);
    const positions = await this.startingPositions(resume);
    return this.follow(filter, positions, options);
  }

  private async *follow(
    filter: LogFilter,
    positions: Map<string, number>,
    options: TailOptions
  ): AsyncGenerator<TailedRecord> {
    while (!options.signal.aborted) {
      const files = await listLogFiles(this.config.directory, { includeTraces: false });
      const batch: TailedRecord[] = [];
      for (const file of files) {
        // A file that appeared since the last poll is read from its first byte.
        let from = positions.get(file.name) ?? 0;
        if (file.sizeBytes < from) {
          from = 0;
        }
        const { lines, next } = await readLinesForward(
          file.path,
          from,
          Math.min(file.sizeBytes, from + TAIL_READ_BYTES)
        );
        positions.set(file.name, next);
        for (const line of lines) {
          const record = this.recordFor(file, line.text, line.offset, filter);
          if (record !== null) {
            batch.push({ record, resumeId: encodeLogPosition({ file: file.name, offset: line.end }) });
          }
        }
      }
      batch.sort((a, b) => a.record.timestamp.localeCompare(b.record.timestamp));
      for (const item of batch) {
        yield item;
      }
      await options.sleep(options.pollMs, options.signal);
    }
  }

  /**
   * Where each existing file is read from. Without a resume position that is
   * its end, so only new lines flow. With one, the resumed file continues at
   * the given offset and any file written more recently starts at its first byte.
   */
  private async startingPositions(resume: LogPosition | null): Promise<Map<string, number>> {
    const files = await listLogFiles(this.config.directory, { includeTraces: false });
    const positions = new Map<string, number>(files.map((file) => [file.name, file.sizeBytes]));
    if (resume === null) {
      return positions;
    }
    const resumed = files.find((file) => file.name === resume.file);
    if (resumed === undefined) {
      throw new Error("resume position names a log file that no longer exists");
    }
    positions.set(resumed.name, Math.min(resume.offset, resumed.sizeBytes));
    for (const file of files) {
      if (file.modifiedAt > resumed.modifiedAt) {
        positions.set(file.name, 0);
      }
    }
    return positions;
  }

  private pageSize(requested: number | undefined): number {
    if (requested === undefined) {
      return this.config.defaultPageSize;
    }
    if (!Number.isInteger(requested) || requested < 1 || requested > this.config.maxPageSize) {
      throw new Error(`limit must be an integer from 1 to ${this.config.maxPageSize}`);
    }
    return requested;
  }

  /** The record for a line, or null when the filter rejects it. A line naming no service takes its file's. */
  private recordFor(file: LogFile, text: string, offset: number, filter: LogFilter): LogRecordItem | null {
    const parsed: ParsedLogLine = parseLogLine(text);
    if (parsed.service === "") {
      parsed.service = file.service;
    }
    if (!matchesLogFilter(filter, parsed, text)) {
      return null;
    }
    return { ...parsed, cursor: encodeLogPosition({ file: file.name, offset }) };
  }
}
