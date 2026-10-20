// What the page's units take from the browser besides the DOM: time and
// timers, a place for warnings, and randomness. Injected so a test can run an
// overlay on a controlled clock and read what it warned about; every unit
// falls back to the browser's when given none, and the overlay
// (`OverlayEnv.host`) always passes its own.

export interface PageTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  /** Wall-clock milliseconds, as `Date.now()`. */
  now(): number;
}

export interface PageLog {
  /** Something went wrong that the page recovers from by itself: worth a line in the console, not a failure. */
  warn(message: string, ...detail: unknown[]): void;
}

export interface PageHost {
  timers: PageTimers;
  log: PageLog;
  /** `length` cryptographically random bytes. */
  randomBytes(length: number): Uint8Array;
}

export const BROWSER_HOST: PageHost = {
  timers: {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, ms) => setInterval(callback, ms),
    now: () => Date.now(),
  },
  log: {
    warn: (message, ...detail) => console.warn(message, ...detail),
  },
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
};
