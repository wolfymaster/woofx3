// When each step of an alert happened on this page, as User Timing marks, so
// where an alert's time goes can be read in the browser's performance tools
// or from `performance.getEntriesByType("mark")`, wherever the overlay runs.
//
// Every mark is named `woofx3.alert/{eventId}/{stage}`, or
// `woofx3.alert/{eventId}/{widgetId}/{stage}` for one widget's frame, and
// carries the same ids in its `detail`. The first time a widget of an alert
// paints, a measure `woofx3.alert/{eventId}/on-screen` spans from the alert's
// delivery to that paint: the latency a viewer sees, minus the server's part.
//
// An overlay can run for a whole stream, and User Timing keeps every entry
// until it is cleared, so only the most recent alerts' entries are kept.

/** The slice of `Performance` the timings write through. */
export interface PageMarks {
  mark(name: string, detail: Readonly<Record<string, string>>): void;
  /** A measure from mark `start` to mark `end`. */
  measure(name: string, start: string, end: string): void;
  /** Remove every mark and measure called `name`. */
  clear(name: string): void;
}

export const BROWSER_MARKS: PageMarks = {
  mark: (name, detail) => {
    performance.mark(name, { detail });
  },
  measure: (name, start, end) => {
    performance.measure(name, { start, end });
  },
  clear: (name) => {
    performance.clearMarks(name);
    performance.clearMeasures(name);
  },
};

/** How many alerts' entries are kept before the oldest alert's are cleared. */
export const RETAINED_ALERT_TIMINGS = 20;

/**
 * Steps of the alert as a whole: it reached the page, its turn came, it played
 * out. `prepared` is marked as it starts when it plays on a stage built
 * before its turn came (alert-widget.ts); one that plays on frames made for
 * it as it starts, such as an alert reaching an idle area, has no such mark.
 */
export type AlertStage = "delivered" | "prepared" | "started" | "finished";

/**
 * Steps of one widget's frame: it was put on the stage, its shim said hello
 * (the document has loaded), the widget subscribed (its own script has run),
 * and it painted.
 */
export type AlertFrameStage = "mounted" | "ready" | "subscribed" | "rendered";

const ON_SCREEN = "on-screen";

export class AlertTimings {
  /** The entry names of each alert, oldest alert first. */
  private readonly entries = new Map<string, Set<string>>();

  constructor(
    private readonly marks: PageMarks,
    private readonly retained: number = RETAINED_ALERT_TIMINGS
  ) {
    if (!Number.isInteger(retained) || retained < 1) {
      throw new Error("AlertTimings: retained must be a positive integer");
    }
  }

  /**
   * Mark a step of alert `eventId`. Only the first of each step is marked: a
   * delivery the server sends again is not when the alert arrived.
   */
  alert(eventId: string, stage: AlertStage): void {
    this.markOnce(eventId, `${prefixOf(eventId)}/${stage}`, { eventId, stage });
  }

  /** Mark a step of widget `widgetId`'s frame in alert `eventId`. */
  frame(eventId: string, widgetId: string, stage: AlertFrameStage): void {
    const marked = this.markOnce(eventId, `${prefixOf(eventId)}/${widgetId}/${stage}`, { eventId, widgetId, stage });
    if (marked && stage === "rendered") {
      this.measureOnScreen(eventId, `${prefixOf(eventId)}/${widgetId}/${stage}`);
    }
  }

  /** The alert's first paint, measured from its delivery (or its start, when it was delivered before this page). */
  private measureOnScreen(eventId: string, paint: string): void {
    const names = this.entries.get(eventId);
    const name = `${prefixOf(eventId)}/${ON_SCREEN}`;
    if (names === undefined || names.has(name)) {
      return;
    }
    const delivered = `${prefixOf(eventId)}/delivered`;
    const started = `${prefixOf(eventId)}/started`;
    const from = names.has(delivered) ? delivered : names.has(started) ? started : null;
    if (from === null) {
      return;
    }
    names.add(name);
    this.marks.measure(name, from, paint);
  }

  /** Mark `name` unless it is marked already; whether it was marked now. */
  private markOnce(eventId: string, name: string, detail: Record<string, string>): boolean {
    const names = this.namesOf(eventId);
    if (names.has(name)) {
      return false;
    }
    names.add(name);
    this.marks.mark(name, detail);
    return true;
  }

  private namesOf(eventId: string): Set<string> {
    const known = this.entries.get(eventId);
    if (known !== undefined) {
      return known;
    }
    const names = new Set<string>();
    this.entries.set(eventId, names);
    while (this.entries.size > this.retained) {
      const [oldest, oldestNames] = this.entries.entries().next().value as [string, Set<string>];
      this.entries.delete(oldest);
      for (const old of oldestNames) {
        this.marks.clear(old);
      }
    }
    return names;
  }
}

function prefixOf(eventId: string): string {
  return `woofx3.alert/${eventId}`;
}
