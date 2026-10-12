// The clock the page's schedulers run on.
//
// `performance.now()` is the clock the document timeline reads, which every
// animation the DOM renderer starts runs on, so composition times the
// scheduler plans and the animations it starts agree.

import type { SchedulerClock } from "@woofx3/scene/runtime";

export const PAGE_CLOCK: SchedulerClock<ReturnType<typeof setTimeout>> = {
  now: () => performance.now(),
  setTimer: (atMs, callback) => setTimeout(callback, Math.max(0, atMs - performance.now())),
  clearTimer: (handle) => clearTimeout(handle),
};
