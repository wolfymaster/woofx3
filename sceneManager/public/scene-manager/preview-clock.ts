// A composition clock: composition time that can pause and jump. The editor's
// composition preview plays and scrubs on it, and an alert staged ahead of
// time (alert-stage.ts) holds on it at 0 ms until the alert starts.
//
// The scheduler reads every fact time from its clock and sleeps on its
// timers (see @woofx3/scene's runtime/scheduler.ts). Here that clock reads
// the composition's own time, 0 at its start, and runs on a base clock (the
// page clock, `performance.now()`) only while playing: paused, it holds; a
// seek moves it to any time, backwards included. The DOM renderer's
// animations run on the document timeline, which reads the same time as the
// page clock, so the preview pauses and seeks both together.
//
// Timers are kept here, in composition time, and only the earliest is armed
// on the base clock while playing. A timer is due when composition time has
// reached it, however it got there: a seek past one fires it once playing
// resumes, and paused, nothing fires.

import type { SchedulerClock } from "@woofx3/scene/runtime";

export interface PreviewClock extends SchedulerClock<number> {
  playing(): boolean;
  play(): void;
  pause(): void;
  /** Move to `ms` of composition time, playing or paused as before. */
  seek(ms: number): void;
  /** Drop every timer; the clock must not be used after. */
  dispose(): void;
}

interface Timer {
  atMs: number;
  callback: () => void;
}

/** A clock paused at 0 ms on `base`. */
export function createPreviewClock<THandle>(base: SchedulerClock<THandle>): PreviewClock {
  const timers = new Map<number, Timer>();
  let nextHandle = 1;
  let running = false;
  // While playing, the base time at which the composition was at 0 ms;
  // while paused, the composition time held.
  let origin = 0;
  let heldMs = 0;
  let armed: { handle: THandle } | null = null;
  let disposed = false;

  function now(): number {
    return running ? base.now() - origin : heldMs;
  }

  function disarm(): void {
    if (armed !== null) {
      base.clearTimer(armed.handle);
      armed = null;
    }
  }

  function arm(): void {
    disarm();
    if (!running || disposed || timers.size === 0) {
      return;
    }
    let earliest = Number.POSITIVE_INFINITY;
    for (const timer of timers.values()) {
      earliest = Math.min(earliest, timer.atMs);
    }
    armed = { handle: base.setTimer(origin + earliest, fire) };
  }

  function fire(): void {
    armed = null;
    const at = now();
    const due = [...timers.entries()].filter(([, timer]) => timer.atMs <= at).sort(([, a], [, b]) => a.atMs - b.atMs);
    for (const [handle, timer] of due) {
      // An earlier callback may have cleared this one, or paused the clock.
      if (!running || !timers.delete(handle)) {
        continue;
      }
      timer.callback();
    }
    arm();
  }

  function assertLive(): void {
    if (disposed) {
      throw new Error("preview clock: used after it was disposed");
    }
  }

  return {
    now,

    setTimer(atMs, callback) {
      assertLive();
      if (!Number.isFinite(atMs)) {
        throw new Error("preview clock: a timer needs a finite time");
      }
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { atMs, callback });
      arm();
      return handle;
    },

    clearTimer(handle) {
      if (timers.delete(handle)) {
        arm();
      }
    },

    playing() {
      return running;
    },

    play() {
      assertLive();
      if (running) {
        return;
      }
      origin = base.now() - heldMs;
      running = true;
      arm();
    },

    pause() {
      assertLive();
      if (!running) {
        return;
      }
      heldMs = now();
      running = false;
      disarm();
    },

    seek(ms) {
      assertLive();
      if (!(Number.isFinite(ms) && ms >= 0)) {
        throw new Error("preview clock: seek needs a non-negative finite time");
      }
      if (running) {
        origin = base.now() - ms;
      } else {
        heldMs = ms;
      }
      arm();
    },

    dispose() {
      disposed = true;
      running = false;
      disarm();
      timers.clear();
    },
  };
}
