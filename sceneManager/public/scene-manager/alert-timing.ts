// When each step of an alert happened on this page, as User Timing marks, so
// where an alert's time goes can be read in the browser's performance tools
// or from `performance.getEntriesByType("mark")`, wherever the overlay runs.
//
// One alert is delivered to every alert area on a scene, and each plays it on
// its own, so every mark is named for the area too:
// `woofx3.alert/{eventId}/{areaId}/{stage}`, or
// `woofx3.alert/{eventId}/{areaId}/{widgetId}/{stage}` for one widget's frame,
// and carries the same ids in its `detail`. The first time a widget of an
// alert paints in an area, a measure `woofx3.alert/{eventId}/{areaId}/on-screen`
// spans from the alert's delivery to that paint: the latency a viewer sees,
// minus the server's part.
//
// An overlay can run for a whole stream, and User Timing keeps every entry
// until it is cleared, so only the most recent alerts' entries are kept.

/** The slice of `Performance` the timings write through. */
export interface PageMarks {
  mark(name: string, detail: Readonly<Record<string, string>>): void;
  /** A measure from mark `start` to mark `end`. */
  measure(name: string, start: string, end: string, detail: Readonly<Record<string, string>>): void;
  /** Remove every mark and measure called `name`. */
  clear(name: string): void;
}

export const BROWSER_MARKS: PageMarks = {
  mark: (name, detail) => {
    performance.mark(name, { detail });
  },
  measure: (name, start, end, detail) => {
    performance.measure(name, { start, end, detail });
  },
  clear: (name) => {
    performance.clearMarks(name);
    performance.clearMeasures(name);
  },
};

/**
 * How many finished alerts' entries are kept before the oldest finished
 * alert's are cleared. Counting finished alerts only keeps the entries of a
 * burst's queued alerts until they have played.
 */
export const RETAINED_ALERT_TIMINGS = 20;

/**
 * How many alerts' entries are tracked at all. An alert that never finishes
 * (redelivered to another page, cleared from the queue) would otherwise stay
 * for the life of the page.
 */
export const TRACKED_ALERT_TIMINGS = 200;

/**
 * Steps of the alert as a whole in one area: it reached the page, its turn
 * came, it is off the stage (played out, skipped, or torn down with its area).
 * `prepared` is marked as it starts when it plays on a stage built before its
 * turn came (alert-widget.ts); one that plays on frames made for it as it
 * starts, such as an alert reaching an idle area, has no such mark.
 */
export type AlertStage = "delivered" | "prepared" | "started" | "finished";

/**
 * Steps of one widget's frame: it was put on the stage, the frame's shim is
 * running (its response arrived and its head was parsed up to the shim
 * script, not the whole document), the widget subscribed (its own script has
 * run), and it painted.
 */
export type AlertFrameStage = "mounted" | "ready" | "subscribed" | "rendered";

const ON_SCREEN = "on-screen";

export interface AlertTimingsLimits {
  retained: number;
  tracked: number;
}

export class AlertTimings {
  /** The entry names of each tracked alert, by its name prefix, oldest first. */
  private readonly entries = new Map<string, Set<string>>();
  /** The tracked alerts that have finished, oldest first. */
  private readonly finished = new Set<string>();

  constructor(
    private readonly marks: PageMarks,
    private readonly limits: AlertTimingsLimits = { retained: RETAINED_ALERT_TIMINGS, tracked: TRACKED_ALERT_TIMINGS }
  ) {
    if (!Number.isInteger(limits.retained) || limits.retained < 1) {
      throw new Error("AlertTimings: retained must be a positive integer");
    }
    if (!Number.isInteger(limits.tracked) || limits.tracked < limits.retained) {
      throw new Error("AlertTimings: tracked must be an integer of at least retained");
    }
  }

  /**
   * Mark a step of alert `eventId` in alert area `areaId`. Only the first of
   * each step is marked: a delivery the server sends again is not when the
   * alert arrived.
   */
  alert(eventId: string, areaId: string, stage: AlertStage): void {
    const prefix = prefixOf(eventId, areaId);
    this.markOnce(prefix, `${prefix}/${stage}`, { eventId, areaId, stage });
    if (stage === "finished") {
      this.finished.add(prefix);
      this.dropFinishedBeyondRetained();
    }
  }

  /** Mark a step of widget `widgetId`'s frame in alert `eventId` in area `areaId`. */
  frame(eventId: string, areaId: string, widgetId: string, stage: AlertFrameStage): void {
    const prefix = prefixOf(eventId, areaId);
    const name = `${prefix}/${widgetId}/${stage}`;
    const marked = this.markOnce(prefix, name, { eventId, areaId, widgetId, stage });
    if (marked && stage === "rendered") {
      this.measureOnScreen(eventId, areaId, name);
    }
  }

  /**
   * The alert's first paint in the area, measured from its delivery (or its
   * start, when it was delivered before this page; the measure's `from` says
   * which).
   */
  private measureOnScreen(eventId: string, areaId: string, paint: string): void {
    const prefix = prefixOf(eventId, areaId);
    const names = this.entries.get(prefix);
    const name = `${prefix}/${ON_SCREEN}`;
    if (names === undefined || names.has(name)) {
      return;
    }
    const delivered = `${prefix}/delivered`;
    const started = `${prefix}/started`;
    const from = names.has(delivered) ? "delivered" : names.has(started) ? "started" : null;
    if (from === null) {
      return;
    }
    names.add(name);
    this.marks.measure(name, `${prefix}/${from}`, paint, { eventId, areaId, from });
  }

  /** Mark `name` unless it is marked already; whether it was marked now. */
  private markOnce(prefix: string, name: string, detail: Record<string, string>): boolean {
    const names = this.namesOf(prefix);
    if (names.has(name)) {
      return false;
    }
    names.add(name);
    this.marks.mark(name, detail);
    return true;
  }

  private namesOf(prefix: string): Set<string> {
    const known = this.entries.get(prefix);
    if (known !== undefined) {
      return known;
    }
    const names = new Set<string>();
    this.entries.set(prefix, names);
    while (this.entries.size > this.limits.tracked) {
      this.drop(this.entries.keys().next().value as string);
    }
    return names;
  }

  private dropFinishedBeyondRetained(): void {
    while (this.finished.size > this.limits.retained) {
      this.drop(this.finished.values().next().value as string);
    }
  }

  private drop(prefix: string): void {
    const names = this.entries.get(prefix);
    this.entries.delete(prefix);
    this.finished.delete(prefix);
    for (const name of names ?? []) {
      this.marks.clear(name);
    }
  }
}

function prefixOf(eventId: string, areaId: string): string {
  return `woofx3.alert/${eventId}/${areaId}`;
}
