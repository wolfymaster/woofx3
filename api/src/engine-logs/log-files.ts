import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { LogFileInfo } from "@woofx3/api";

/**
 * `<service>_YYYYMMDD_HHMM.log`, the shape every logger in the repository
 * writes (see `makeLogFileName`). The service part is greedy so a service
 * name with underscores still splits at the timestamp.
 */
const LOG_FILE_NAME = /^(?<service>.+)_\d{8}_\d{4}\.log$/;

/** Span files share the directory and the `.log` suffix but hold spans, not records. */
const TRACE_FILE_MARKER = "_traces_";

export interface LogFile extends LogFileInfo {
  /** Absolute path, always inside the log directory. */
  path: string;
}

/**
 * Lists the log files in `directory`, newest write first. Callers name a file
 * only through this listing, never by joining a name they were given onto the
 * directory, so a cursor or request cannot point outside it.
 */
export async function listLogFiles(directory: string, options: { includeTraces: boolean }): Promise<LogFile[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(`reading log directory ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const files: LogFile[] = [];
  for (const name of names) {
    const match = LOG_FILE_NAME.exec(name);
    if (!match?.groups) {
      continue;
    }
    if (!options.includeTraces && name.includes(TRACE_FILE_MARKER)) {
      continue;
    }
    const filePath = path.join(directory, name);
    const info = await stat(filePath).catch(() => null);
    if (info === null || !info.isFile()) {
      continue;
    }
    files.push({
      name,
      service: match.groups.service as string,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      path: filePath,
    });
  }
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || b.name.localeCompare(a.name));
}
