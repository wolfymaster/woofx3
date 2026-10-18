import path from "node:path";

/**
 * Names the directory that holds everything an engine writes: databases, module storage, uploaded
 * modules, caches and logs. Read from the process environment only, never from .woofx3.json, so
 * every service and the orchestrator that starts them agree on it.
 * Must match DataDirEnv in shared/common/golang/config/datadir.go and DATA_DIR_ENV in
 * shared/common/rust/runtime/src/lib.rs.
 */
export const DATA_DIR_ENV = "WOOFX3_DATA_DIR";

/** The absolute data directory, or undefined when WOOFX3_DATA_DIR is unset or blank. */
export function dataDir(env: Record<string, string | undefined> = process.env): string | undefined {
  const value = env[DATA_DIR_ENV]?.trim();
  return value ? path.resolve(value) : undefined;
}

/**
 * Anchor a relative path in the data directory. Without a data directory, or for an absolute path,
 * the path comes back unchanged, and a relative one is then resolved against the working directory.
 */
export function resolveDataPath(target: string, env: Record<string, string | undefined> = process.env): string {
  const dir = dataDir(env);
  if (dir === undefined || target === "" || path.isAbsolute(target)) {
    return target;
  }
  return path.join(dir, target);
}
