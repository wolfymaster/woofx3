import { appendFile, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function makeLogDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "woofx3-logs-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function record(fields: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: "2026-11-23T10:00:00.000Z",
    service: "api",
    level: "info",
    message: "hello",
    metadata: {},
    ...fields,
  });
}

/** Writes `lines` as one file; `mtime` orders files, as it does for the real listing. */
export async function writeLog(dir: string, name: string, lines: string[], mtime: Date): Promise<void> {
  const file = path.join(dir, name);
  await writeFile(file, `${lines.join("\n")}\n`);
  await utimes(file, mtime, mtime);
}

/** Adds lines to a file the way a running service does, leaving its mtime at now. */
export async function appendLog(dir: string, name: string, lines: string[]): Promise<void> {
  await appendFile(path.join(dir, name), `${lines.join("\n")}\n`);
}
