import type { Logger } from "./application";

export const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT", "SIGBREAK"] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export type ShutdownReason = ShutdownSignal | "uncaughtException";

/** The slice of `process` that installShutdown listens on. */
export interface SignalSource {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface ShutdownTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ShutdownOptions {
  /** The runtime's own `runtime.stop()`. */
  stop: (reason: ShutdownReason) => Promise<void>;
  logger: Pick<Logger, "info" | "error">;
  /** How long stop may take before the process is forced out with exit code 1. */
  deadlineMs: number;
  exit: (code: number) => void;
  process: SignalSource;
  timers: ShutdownTimers;
}

export interface ShutdownHandle {
  /** Removes every listener, cancels a pending deadline and suppresses the exit of a stop already in flight. */
  dispose(): void;
}

/**
 * Wires process signals to a single bounded shutdown. The first SIGTERM, SIGINT or SIGBREAK
 * (the orchestrator's stop request on Windows) calls `stop`; a second signal, or `deadlineMs`
 * elapsing, exits 1. The process exits 0 after a clean stop and 1 if `stop` throws.
 * An uncaught exception is logged and then shuts down the same way but always ends with exit
 * code 1; an unhandled rejection is only logged.
 */
export function installShutdown(options: ShutdownOptions): ShutdownHandle {
  if (!(options.deadlineMs > 0)) {
    throw new Error(`deadlineMs must be greater than 0, got ${options.deadlineMs}`);
  }

  let shuttingDown = false;
  let exited = false;
  let deadline: unknown;
  let failed = false;
  let disposed = false;

  const exitOnce = (code: number): void => {
    if (exited || disposed) {
      return;
    }
    exited = true;
    if (deadline !== undefined) {
      options.timers.clearTimeout(deadline);
      deadline = undefined;
    }
    options.exit(code);
  };

  const begin = (reason: ShutdownReason): void => {
    if (shuttingDown) {
      options.logger.error(`Received ${reason} during shutdown, exiting immediately`);
      exitOnce(1);
      return;
    }
    shuttingDown = true;
    options.logger.info(`Received ${reason}, starting graceful shutdown`);

    deadline = options.timers.setTimeout(() => {
      options.logger.error(`Shutdown did not finish within ${options.deadlineMs}ms, exiting`);
      exitOnce(1);
    }, options.deadlineMs);

    // stop is called synchronously so a first signal starts shutdown immediately; a synchronous
    // throw is folded into the same rejection path as an async failure.
    let stopped: Promise<void>;
    try {
      stopped = options.stop(reason);
    } catch (error) {
      stopped = Promise.reject(error);
    }
    stopped.then(
      () => {
        options.logger.info("Graceful shutdown completed");
        exitOnce(failed ? 1 : 0);
      },
      (error: unknown) => {
        options.logger.error("Error during graceful shutdown", error);
        exitOnce(1);
      }
    );
  };

  const listeners = SHUTDOWN_SIGNALS.map((signal) => {
    const listener = (): void => begin(signal);
    options.process.on(signal, listener);
    return { event: signal as string, listener };
  });

  const onUncaught = (error?: unknown): void => {
    options.logger.error("Uncaught exception", error);
    failed = true;
    begin("uncaughtException");
  };
  options.process.on("uncaughtException", onUncaught);
  listeners.push({ event: "uncaughtException", listener: onUncaught });

  const onRejection = (reason?: unknown): void => {
    options.logger.error("Unhandled rejection", reason);
  };
  options.process.on("unhandledRejection", onRejection);
  listeners.push({ event: "unhandledRejection", listener: onRejection });

  return {
    dispose(): void {
      disposed = true;
      for (const { event, listener } of listeners) {
        options.process.off(event, listener);
      }
      if (deadline !== undefined) {
        options.timers.clearTimeout(deadline);
        deadline = undefined;
      }
    },
  };
}
