import type { SharedLogger } from "@woofx3/common/logging";

/**
 * Connect to the message bus, waiting for it to accept connections.
 *
 * The orchestrator starts every service at once, so a refused connection at
 * startup means "not yet", not "never". Without this the api spends the rest
 * of its life with no bus: no heartbeats, so `GET /ready` never sees
 * barkloader, and a provisioner waiting on a new engine waits forever.
 *
 * Returns null once the attempts are spent. A bus that never arrives is still
 * not fatal -- the api serves what it can without one -- but by then it is a
 * real failure rather than a race, and it is logged as one.
 */
export async function connectMessageBus<T>(options: {
  connect: () => Promise<T>;
  logger: SharedLogger;
  /** Total tries, including the first. */
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T | null> {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 2000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await options.connect();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (attempt === attempts) {
        options.logger.warn("Message bus never became reachable; running without it", { attempts, error });
        return null;
      }
      options.logger.info("Message bus is not accepting connections yet; retrying", { attempt, attempts, error });
      await sleep(delayMs);
    }
  }
  return null;
}
