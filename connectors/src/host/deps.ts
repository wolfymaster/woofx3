import type { Clock, RandomSource } from "@woofx3/common/runtime";

export type { Clock, RandomSource };

export type LogMetadata = Record<string, unknown>;

/** The slice of the shared service logger the host uses; tests pass a recording fake. */
export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  child(context: Record<string, string>): Logger;
}

export type TimerHandle = unknown;

/** Every timer the host sets goes through this, so tests drive time by hand. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

/** Unique ids for CloudEvent replies. */
export interface IdSource {
  next(): string;
}

export const systemClock: Clock = { now: () => Date.now() };

export const systemRandom: RandomSource = { next: () => Math.random() };

export const systemIds: IdSource = { next: () => crypto.randomUUID() };

export const systemTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
