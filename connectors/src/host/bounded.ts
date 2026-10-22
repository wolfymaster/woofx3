import type { Timers } from "./deps";

export type Bounded<T> = { kind: "done"; value: T } | { kind: "failed"; error: unknown } | { kind: "timeout" };

/**
 * Settles with how `work` ended, or with `timeout` once `ms` pass. The work is
 * not cancelled: a caller that needs it to stop passes its own signal.
 */
export function bounded<T>(work: () => Promise<T>, ms: number, timers: Timers): Promise<Bounded<T>> {
  return new Promise<Bounded<T>>((resolve) => {
    const timer = timers.setTimeout(() => resolve({ kind: "timeout" }), Math.max(0, ms));
    let running: Promise<T>;
    try {
      running = work();
    } catch (error) {
      running = Promise.reject(error);
    }
    running.then(
      (value) => {
        timers.clearTimeout(timer);
        resolve({ kind: "done", value });
      },
      (error: unknown) => {
        timers.clearTimeout(timer);
        resolve({ kind: "failed", error });
      }
    );
  });
}
