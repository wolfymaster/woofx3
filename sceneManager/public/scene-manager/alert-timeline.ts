// When an alert is over. An alert lasts as long as its longest widget: a
// widget that subscribes with `autoComplete: false` has a length of its own
// and is waited for until it calls `complete()`; one that completes when its
// handler returns (a Text or Image with no duration) has none and simply
// stays up for the rest of the alert.

/** How long an alert whose widgets have no length of their own stays up. */
export const UNTIMED_ALERT_MS = 5_000;

/** A widget that has not subscribed by now is not waited for. */
export const SUBSCRIBE_TIMEOUT_MS = 10_000;

/** No alert holds its alert widget longer than this, whatever its widgets do. */
export const MAX_ALERT_MS = 5 * 60_000;

type WidgetState = "loading" | "untimed" | "playing" | "done";

export class AlertTimeline {
  private readonly widgets = new Map<string, WidgetState>();
  private anyTimed = false;

  constructor(
    widgetIds: string[],
    private readonly startedAt: number
  ) {
    for (const id of widgetIds) {
      this.widgets.set(id, "loading");
    }
  }

  /** The widget subscribed; `timed` when it will call `complete()` itself. */
  subscribed(widgetId: string, timed: boolean): void {
    if (this.widgets.get(widgetId) !== "loading") {
      return;
    }
    this.widgets.set(widgetId, timed ? "playing" : "untimed");
    if (timed) {
      this.anyTimed = true;
    }
  }

  /** The widget completed its delivery. Meaningless for an untimed widget, which completes at once. */
  completed(widgetId: string): void {
    if (this.widgets.get(widgetId) === "playing") {
      this.widgets.set(widgetId, "done");
    }
  }

  isOver(now: number): boolean {
    const elapsed = now - this.startedAt;
    if (elapsed >= MAX_ALERT_MS) {
      return true;
    }
    for (const state of this.widgets.values()) {
      if (state === "playing") {
        return false;
      }
      if (state === "loading" && elapsed < SUBSCRIBE_TIMEOUT_MS) {
        return false;
      }
    }
    return this.anyTimed || elapsed >= UNTIMED_ALERT_MS;
  }
}
