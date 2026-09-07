import path from "node:path";
import { createServiceLogger, type SharedLogger } from "@woofx3/common/logging";

/**
 * Server-only logger for streamlabs. Import this from the express entry,
 * the Remix SSR entry, and the OBS helpers - never from a browser bundle,
 * since it opens a log file on the local filesystem at import time.
 *
 * Unlike the other services streamlabs has no shared-runtime bootstrap to
 * own the logger, so the instance is a module singleton created on first
 * import.
 */
export const logger: SharedLogger = createServiceLogger({
  logDir: path.resolve(process.cwd(), "logs"),
  serviceName: "streamlabs",
});

/**
 * Adapter for the `Context.logger` shape the OBS/SLOBS managers expect
 * (`(msg: string) => void`), so those call sites keep their existing
 * signature while their output lands in the shared logger.
 */
export function contextLogger(scoped: SharedLogger = logger): (msg: string) => void {
  return (msg: string) => {
    scoped.info(msg);
  };
}
