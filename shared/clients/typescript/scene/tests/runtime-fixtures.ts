// Documents and fakes shared by the runtime tests.

import type { BehaviorDocument, CompositionDocument, PlacementDocument, Timing } from "../model";

export function placement(overrides: Partial<PlacementDocument> = {}): PlacementDocument {
  return {
    widget: "woofx3:widget:text",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    z: "a0",
    settings: {},
    name: "Widget",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
    ...overrides,
  };
}

export function timing(overrides: Partial<Timing> = {}): Timing {
  return { anchor: "enter", offsetMs: 0, durationMs: 500, easing: "ease-out", ...overrides };
}

export function behavior(overrides: Partial<BehaviorDocument> = {}): BehaviorDocument {
  return {
    type: "transition",
    kind: "fade",
    target: "w1",
    order: "a0",
    timing: timing(),
    params: { phase: "in" },
    ...overrides,
  };
}

export function composition(
  widgets: Record<string, PlacementDocument>,
  behaviors: Record<string, BehaviorDocument> = {}
): CompositionDocument {
  return { layout: { width: 1920, height: 1080 }, widgets, behaviors };
}

/** A clock whose time only moves when a test advances it, firing due timers in order. */
export class FakeClock {
  private time: number;
  private nextHandle = 1;
  private readonly timers = new Map<number, { atMs: number; callback: () => void }>();

  constructor(start = 1_000_000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimer(atMs: number, callback: () => void): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { atMs, callback });
    return handle;
  }

  clearTimer(handle: number): void {
    this.timers.delete(handle);
  }

  /** Pending timer times, earliest first. */
  pending(): number[] {
    return [...this.timers.values()].map((timer) => timer.atMs).sort((a, b) => a - b);
  }

  /** Move to `atMs`, firing every timer due by then at its own time. */
  advanceTo(atMs: number): void {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.atMs <= atMs)
        .sort(([, a], [, b]) => a.atMs - b.atMs);
      if (due.length === 0) {
        break;
      }
      const [handle, timer] = due[0];
      this.timers.delete(handle);
      this.time = Math.max(this.time, timer.atMs);
      timer.callback();
    }
    this.time = Math.max(this.time, atMs);
  }

  advanceBy(ms: number): void {
    this.advanceTo(this.time + ms);
  }

  /** Move to `atMs`, either way, firing nothing: a clock that was seeked. */
  jumpTo(atMs: number): void {
    this.time = atMs;
  }
}
