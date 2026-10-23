import type { Timers } from "./deps";

export type Bounded<T> = { kind: "done"; value: T } | { kind: "failed"; error: unknown } | { kind: "timeout" };

/**
 * Settles with how `work` ended, or with `timeout` once `ms` pass. The work is
 * not cancelled: a caller that needs it to stop passes its own signal.
 */
export function bounded<T>(work: () => Promise<T>, ms: number, timers: Timers): Promise<Bounded<T>> {
  return new Promise<Bounded<T>>((resolve) => {
    const timer = timers.setTimeout(() => resolve({ kind: "timeout" }), Math.max(0, ms));
    settle(work, (outcome) => {
      timers.clearTimeout(timer);
      resolve(outcome);
    });
  });
}

/**
 * Settles with how `work` ended, or with `timeout` as soon as `signal` aborts
 * (at once if it already has). Like `bounded`, the work is not cancelled; a
 * caller that needs it to stop hands it the same signal.
 */
export function boundedBySignal<T>(work: () => Promise<T>, signal: AbortSignal): Promise<Bounded<T>> {
  return new Promise<Bounded<T>>((resolve) => {
    const onAbort = () => resolve({ kind: "timeout" });
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    settle(work, (outcome) => {
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    });
  });
}

/** Runs `work` and reports how it ended; a synchronous throw counts as a failure. */
function settle<T>(work: () => Promise<T>, done: (outcome: Bounded<T>) => void): void {
  let running: Promise<T>;
  try {
    running = work();
  } catch (error) {
    running = Promise.reject(error);
  }
  running.then(
    (value) => done({ kind: "done", value }),
    (error: unknown) => done({ kind: "failed", error })
  );
}
