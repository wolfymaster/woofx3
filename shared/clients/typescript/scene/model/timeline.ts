// When each widget of a composition is active and when each behavior runs.
//
// Timing in a composition is anchored (see `Timing`): a behavior runs some
// milliseconds after an anchor (the composition starts or ends, a widget
// enters, exits or completes), and how long an alert lasts is only known as
// it plays. `resolveTimeline` turns a document plus what has been observed so
// far into concrete times, in milliseconds since the composition started.
//
// It is pure and deterministic, and holds no clock: the caller says what time
// it is (`TimelineFacts.nowMs`). Two callers share it:
//
// - The overlay calls it again each time a fact arrives (a widget subscribed,
//   rendered, completed, was shown or hidden) and schedules what it returns.
//   A time it cannot know yet is `null`, and `revisitAtMs` says when the
//   answer can change without a new fact (a subscription times out, the cap).
// - The editor calls it with `estimate`, which fills in everything not
//   observed (a widget's length from its `settings.duration`), to draw tracks
//   and scrub.
//
// Facts only ever add to what is known: a time this returns never changes
// when later facts arrive, it only stops being `null`.
//
// The alert rules are the overlay's long-standing ones: an alert ends once
// every timed widget (one that subscribes with `autoComplete: false` and
// calls `complete()`) has completed; a widget that has not subscribed within
// SUBSCRIBE_TIMEOUT_MS of entering is not waited for; an alert with nothing
// timed holds UNTIMED_ALERT_MS; nothing holds it past MAX_ALERT_MS. A timed
// widget leaves when it completes, every other widget when the alert ends,
// and the alert is finished once every widget has exited, exit animations
// included, so the next alert never starts under this one's exits. A widget
// whose placement is not `visible` never enters an alert.

import {
  type BehaviorDocument,
  type BehaviorId,
  CANVAS_TARGET,
  type CompositionDocument,
  type CompositionProfile,
  type NodeId,
} from "./types";

/** How long an alert whose widgets have no length of their own stays up. */
export const UNTIMED_ALERT_MS = 5_000;

/** A widget that has not subscribed this long after entering is not waited for. */
export const SUBSCRIBE_TIMEOUT_MS = 10_000;

/** No alert holds its end past this, whatever its widgets do. */
export const MAX_ALERT_MS = 5 * 60_000;

/**
 * A widget is shown once its frame has painted, so an entrance never plays
 * over an empty frame, but not later than this after it was due.
 */
export const RENDER_WAIT_MS = 2_000;

/** A widget was shown (`true`) or hidden (`false`) in a scene. */
export interface VisibilityChange {
  atMs: number;
  visible: boolean;
}

/**
 * What the overlay has seen of one widget. Every time is a reading of the
 * same clock as `TimelineFacts.startedAtMs`; absent means not seen yet.
 */
export interface WidgetFacts {
  /** The widget subscribed to its events. */
  subscribedAtMs?: number;
  /** Required with `subscribedAtMs`: the widget calls `complete()` itself (`autoComplete: false`). */
  timed?: boolean;
  /** The widget's frame first painted. */
  renderedAtMs?: number;
  /** A timed widget called `complete()`. */
  completedAtMs?: number;
  /** Scene only: each time the widget was shown or hidden after the scene started. */
  visibility?: readonly VisibilityChange[];
}

export interface TimelineFacts {
  /** The clock reading when the composition started (an alert began, a scene loaded). */
  startedAtMs: number;
  /**
   * The clock reading now. Anything not observed by then has not happened,
   * which is what lets a widget time out. Absent: nothing absent is final.
   */
  nowMs?: number;
  widgets?: Readonly<Record<NodeId, WidgetFacts>>;
}

export interface TimelineEstimates {
  /**
   * A widget's length in ms, or `null` for none (untimed). A widget not in
   * the map takes its `settings.duration` (seconds) when that is a positive
   * number, and is untimed otherwise.
   */
  durationsMs?: Readonly<Record<NodeId, number | null>>;
}

/** The widgets that play media of a length of their own: video, audio and Lottie. */
const MEDIA_WIDGETS: ReadonlySet<string> = new Set([
  "woofx3:widget:video",
  "woofx3:widget:audio",
  "woofx3:widget:lottie",
]);

/**
 * The setting a media widget may carry with its media's own length in
 * seconds, recorded by whoever picked the media (from its metadata). It only
 * informs estimates: the widget plays its media however long it really is.
 */
export const MEDIA_LENGTH_HINT_SETTING = "mediaDurationSeconds";

/**
 * Estimated lengths beyond each widget's `settings.duration`, for
 * `TimelineEstimates.durationsMs`. The editor draws an alert's tracks with
 * these and the composition preview plays with them, so both agree.
 *
 * A widget's length is its `settings.duration` in seconds; at 0 (or unset)
 * it has no length of its own and is untimed. A media widget (video, audio,
 * Lottie) at 0 plays its media through, so when its settings carry the
 * media's length (MEDIA_LENGTH_HINT_SETTING, a positive number of seconds) it
 * is estimated as timed for that long, and is untimed otherwise. One set to
 * loop (`settings.loop`) runs for as long as the alert does, so it stays
 * untimed whatever the hint says.
 */
export function mediaLengthEstimates(doc: CompositionDocument): Record<NodeId, number> {
  const estimates: Record<NodeId, number> = {};
  for (const [id, placement] of Object.entries(doc.widgets)) {
    const { settings } = placement;
    const ownLength = settings.duration !== undefined && settings.duration !== 0;
    if (!MEDIA_WIDGETS.has(placement.widget) || ownLength || settings.loop === true) {
      continue;
    }
    const hint = settings[MEDIA_LENGTH_HINT_SETTING];
    if (typeof hint === "number" && Number.isFinite(hint) && hint > 0) {
      estimates[id] = hint * 1000;
    }
  }
  return estimates;
}

export interface TimelineOptions {
  /**
   * Fill in what has not been observed: every widget subscribes and renders
   * as it enters and a timed one completes after its estimated length.
   * Observed facts still win.
   */
  estimate?: TimelineEstimates;
}

/**
 * How a widget takes part: `pending` until it subscribes, then `timed` or
 * `untimed`; `ignored` when it did not subscribe in time (alert); `never` when
 * what it enters on can no longer happen.
 */
export type WidgetStatus = "pending" | "timed" | "untimed" | "ignored" | "never";

/**
 * A widget's active interval. `enterMs` is when it is shown, `leaveMs` when
 * it starts leaving (its exit animations begin) and `exitMs` when it is
 * hidden. In a scene this is the widget's latest interval.
 */
export interface WidgetTimeline {
  status: WidgetStatus;
  enterMs: number | null;
  /**
   * The widget is due to enter and its entrance is held until its frame has
   * painted (`RENDER_WAIT_MS`). Whatever hides it meanwhile must let it paint.
   */
  awaitingPaint: boolean;
  completeMs: number | null;
  leaveMs: number | null;
  exitMs: number | null;
}

export interface BehaviorTimeline {
  startMs: number | null;
  endMs: number | null;
}

/** The canvas as a behavior target: active from the start until the composition is gone. */
export interface CanvasTimeline {
  enterMs: number;
  leaveMs: number | null;
  exitMs: number | null;
}

export type TimelineProblemKind =
  | "dangling-target"
  | "anchor-not-in-profile"
  | "invalid-activity"
  | "duplicate-activity"
  | "activity-cycle";

/**
 * A behavior the resolver could not honour. Validation rejects these before
 * they are stored, but a document merged from concurrent edits can still
 * hold one, and an alert must play regardless, so they are reported rather
 * than thrown.
 */
export interface TimelineProblem {
  behavior: BehaviorId;
  kind: TimelineProblemKind;
}

export interface ResolvedTimeline {
  widgets: Record<NodeId, WidgetTimeline>;
  /** Every behavior whose target exists, activities included. */
  behaviors: Record<BehaviorId, BehaviorTimeline>;
  canvas: CanvasTimeline;
  /** Alert: the `end` anchor, when the alert is over. Scene: always `null`. */
  endMs: number | null;
  /** Alert: when every widget and the canvas have exited. Scene: always `null`. */
  finishMs: number | null;
  /** The earliest time after `nowMs` at which the result may change with no new fact. */
  revisitAtMs: number | null;
  problems: TimelineProblem[];
}

/**
 * Internally a time is a number, `null` when not known yet, or `NEVER` when
 * it is known not to happen; the latter two are both `null` in the result.
 */
type Time = number | null;
const NEVER = Number.POSITIVE_INFINITY;

type TargetId = NodeId | typeof CANVAS_TARGET;

/** Where a widget leaves: when it starts leaving, and when it is gone. */
interface Departure {
  leave: Time;
  exit: Time;
}

export function resolveTimeline(
  doc: CompositionDocument,
  profile: CompositionProfile,
  facts: TimelineFacts,
  options: TimelineOptions = {}
): ResolvedTimeline {
  return new Resolver(doc, profile, facts, options).resolve();
}

class Resolver {
  private readonly bounded: boolean;
  private readonly now: number | null;
  private readonly estimate: TimelineEstimates | null;
  private readonly widgetIds: NodeId[];
  private readonly behaviorIds: BehaviorId[];
  private readonly problems: TimelineProblem[] = [];
  /** The activity that sets each widget's window, once checked. */
  private readonly activities = new Map<NodeId, BehaviorDocument>();
  /** Widgets whose activity waits on the alert's end, so the end cannot wait on them. */
  private readonly afterEnd = new Set<NodeId>();
  private readonly leads = new Map<TargetId, number>();
  private readonly planned = new Map<NodeId, Time>();
  private endMemo: { value: Time } | null = null;

  constructor(
    private readonly doc: CompositionDocument,
    private readonly profile: CompositionProfile,
    private readonly facts: TimelineFacts,
    options: TimelineOptions
  ) {
    assertFinite(facts.startedAtMs, "facts.startedAtMs");
    this.bounded = profile.bounded;
    this.now = facts.nowMs === undefined ? null : this.relative(facts.nowMs, "facts.nowMs");
    this.estimate = options.estimate ?? null;
    // Sorted, so the result and its problems do not depend on key order.
    this.widgetIds = Object.keys(doc.widgets).sort();
    this.behaviorIds = Object.keys(doc.behaviors).sort();
    this.checkFacts();
    this.chooseActivities();
    this.computeLeads();
  }

  resolve(): ResolvedTimeline {
    const widgets: Record<NodeId, WidgetTimeline> = {};
    for (const id of this.widgetIds) {
      const departure = this.departure(id);
      widgets[id] = {
        status: this.status(id),
        enterMs: known(this.enter(id)),
        awaitingPaint: this.awaitingPaint(id),
        completeMs: known(this.rawComplete(id)),
        leaveMs: known(departure.leave),
        exitMs: known(departure.exit),
      };
    }
    const behaviors: Record<BehaviorId, BehaviorTimeline> = {};
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (!this.targetExists(behavior.target)) {
        this.problem(id, "dangling-target");
        continue;
      }
      const window = this.behaviorWindow(id, behavior);
      behaviors[id] = { startMs: known(window.start), endMs: known(window.end) };
    }
    const canvas = this.canvasDeparture();
    return {
      widgets,
      behaviors,
      canvas: { enterMs: 0, leaveMs: known(canvas.leave), exitMs: known(canvas.exit) },
      endMs: this.bounded ? known(this.end()) : null,
      finishMs: this.bounded ? known(this.finish()) : null,
      revisitAtMs: this.revisitAt(),
      problems: this.problems.sort((a, b) => compareText(a.behavior, b.behavior) || compareText(a.kind, b.kind)),
    };
  }

  // ---- document checks -------------------------------------------------

  private checkFacts(): void {
    const widgets = this.facts.widgets ?? {};
    for (const [id, widget] of Object.entries(widgets)) {
      for (const key of ["subscribedAtMs", "renderedAtMs", "completedAtMs"] as const) {
        if (widget[key] !== undefined) {
          assertFinite(widget[key], `facts.widgets.${id}.${key}`);
        }
      }
      if (widget.subscribedAtMs !== undefined && typeof widget.timed !== "boolean") {
        throw new Error(`timeline: facts.widgets.${id} subscribed without saying whether it is timed`);
      }
      for (const change of widget.visibility ?? []) {
        assertFinite(change.atMs, `facts.widgets.${id}.visibility.atMs`);
      }
    }
    for (const [id, duration] of Object.entries(this.estimate?.durationsMs ?? {})) {
      if (duration !== null && !(Number.isFinite(duration) && duration >= 0)) {
        throw new Error(`timeline: estimate.durationsMs.${id} must be a non-negative number or null`);
      }
    }
  }

  /**
   * Pick each widget's activity and drop the ones that cannot resolve. An
   * activity anchored to its own widget's enter or exit defines itself, and
   * one waiting on its own completion never starts, so both fall back to the
   * profile's default window.
   */
  private chooseActivities(): void {
    const byTarget = new Map<NodeId, BehaviorId[]>();
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (behavior.type !== "activity" || !this.targetExists(behavior.target)) {
        continue;
      }
      if (behavior.target === CANVAS_TARGET) {
        this.problem(id, "invalid-activity");
        continue;
      }
      const ids = byTarget.get(behavior.target) ?? [];
      ids.push(id);
      byTarget.set(behavior.target, ids);
    }
    for (const [target, ids] of byTarget) {
      // Concurrent edits can leave two activities on one widget; the first
      // by order wins so every client resolves the same window.
      ids.sort((a, b) => compareOrder(this.doc.behaviors[a], a, this.doc.behaviors[b], b));
      for (const extra of ids.slice(1)) {
        this.problem(extra, "duplicate-activity");
      }
      const id = ids[0];
      const behavior = this.doc.behaviors[id];
      const { anchor, node } = behavior.timing;
      if (!this.profile.anchors.includes(anchor)) {
        this.problem(id, "anchor-not-in-profile");
        continue;
      }
      const selfAnchored = anchor === "enter" || anchor === "exit";
      const badCompletion =
        anchor === "complete" && (node === undefined || node === target || !(node in this.doc.widgets));
      if (selfAnchored || badCompletion) {
        this.problem(id, "invalid-activity");
        continue;
      }
      this.activities.set(target, behavior);
    }
    this.dropActivityCycles();
    for (const id of this.widgetIds) {
      if (this.waitsOnEnd(id, new Set())) {
        this.afterEnd.add(id);
      }
    }
  }

  /** Widgets whose activities wait on each other's completion in a loop never start. */
  private dropActivityCycles(): void {
    const state = new Map<NodeId, "visiting" | "done">();
    const inCycle = new Set<NodeId>();
    const visit = (id: NodeId, path: NodeId[]): void => {
      const seen = state.get(id);
      if (seen === "done") {
        return;
      }
      if (seen === "visiting") {
        for (const member of path.slice(path.indexOf(id))) {
          inCycle.add(member);
        }
        return;
      }
      state.set(id, "visiting");
      const next = this.completionDependency(id);
      if (next !== null) {
        visit(next, [...path, id]);
      }
      state.set(id, "done");
    };
    for (const id of this.widgetIds) {
      visit(id, []);
    }
    for (const id of [...inCycle].sort()) {
      const activity = this.activities.get(id);
      if (activity) {
        const behaviorId = this.behaviorIds.find((candidate) => this.doc.behaviors[candidate] === activity);
        if (behaviorId === undefined) {
          throw new Error("timeline: chosen activity is not in the document");
        }
        this.problem(behaviorId, "activity-cycle");
        this.activities.delete(id);
      }
    }
  }

  private completionDependency(id: NodeId): NodeId | null {
    const activity = this.activities.get(id);
    if (!activity || activity.timing.anchor !== "complete" || activity.timing.node === undefined) {
      return null;
    }
    return activity.timing.node;
  }

  private waitsOnEnd(id: NodeId, seen: Set<NodeId>): boolean {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    const activity = this.activities.get(id);
    if (!activity) {
      return false;
    }
    if (activity.timing.anchor === "end") {
      return true;
    }
    const next = this.completionDependency(id);
    return next !== null && this.waitsOnEnd(next, seen);
  }

  /**
   * How long before a target's exit something on it starts: the target is
   * hidden only that long after it starts leaving, so an exit animation that
   * runs before the exit always has room to play.
   */
  private computeLeads(): void {
    for (const id of this.behaviorIds) {
      const behavior = this.doc.behaviors[id];
      if (behavior.type === "activity" || !this.targetExists(behavior.target)) {
        continue;
      }
      const { timing } = behavior;
      let lead = 0;
      if (phaseOf(behavior) === "out") {
        if (typeof timing.durationMs === "number") {
          lead = timing.durationMs - timing.offsetMs;
        }
      } else if (phaseOf(behavior) === null && timing.anchor === "exit" && timing.offsetMs < 0) {
        lead = -timing.offsetMs;
      }
      const current = this.leads.get(behavior.target) ?? 0;
      this.leads.set(behavior.target, Math.max(current, lead));
    }
  }

  // ---- widgets ---------------------------------------------------------

  /** When the widget is due to enter, before waiting for it to paint. */
  private plannedEnter(id: NodeId): Time {
    if (this.planned.has(id)) {
      return this.planned.get(id) as Time;
    }
    let time: Time;
    const activity = this.activities.get(id);
    const activityStart = activity ? this.activityStart(activity) : 0;
    if (this.bounded && !this.doc.widgets[id].visible) {
      // A hidden widget in an alert does not play at all, as a hidden one in
      // a scene is not shown: nothing waits for it, and nothing anchored to
      // it happens.
      time = NEVER;
    } else if (this.bounded) {
      time = activityStart === null ? null : Math.max(0, activityStart);
    } else {
      const shown = this.visibleWindow(id).show;
      time = shown === null || activityStart === null ? null : Math.max(shown, activityStart);
    }
    this.planned.set(id, time);
    return time;
  }

  private activityStart(activity: BehaviorDocument): Time {
    const { anchor, node, offsetMs } = activity.timing;
    switch (anchor) {
      case "start":
        return offsetMs;
      case "end":
        return add(this.end(), offsetMs);
      case "complete":
        return add(this.completeForAnchor(node as NodeId), offsetMs);
      default:
        throw new Error(`timeline: activity anchored to ${anchor} was not filtered out`);
    }
  }

  /** The fixed close of a widget's activity, or `undefined` when it has none. */
  private activityClose(id: NodeId): Time | undefined {
    const activity = this.activities.get(id);
    if (!activity || activity.timing.durationMs === "until-exit") {
      return undefined;
    }
    return add(this.activityStart(activity), activity.timing.durationMs);
  }

  private enter(id: NodeId): Time {
    const planned = this.plannedEnter(id);
    if (planned === null || planned === NEVER) {
      return planned;
    }
    const rendered = this.fact(id, "renderedAtMs");
    if (rendered !== null) {
      return rendered <= planned ? planned : Math.min(rendered, planned + RENDER_WAIT_MS);
    }
    if (this.estimate !== null) {
      return planned;
    }
    return this.passed(planned + RENDER_WAIT_MS) ? planned + RENDER_WAIT_MS : null;
  }

  private awaitingPaint(id: NodeId): boolean {
    const planned = this.plannedEnter(id);
    return planned !== null && planned !== NEVER && this.enter(id) === null;
  }

  private status(id: NodeId): WidgetStatus {
    const planned = this.plannedEnter(id);
    if (planned === NEVER) {
      return "never";
    }
    const subscribed = this.fact(id, "subscribedAtMs");
    if (subscribed !== null) {
      if (this.bounded && planned !== null && subscribed > planned + SUBSCRIBE_TIMEOUT_MS) {
        return "ignored";
      }
      return this.facts.widgets?.[id]?.timed ? "timed" : "untimed";
    }
    if (this.estimate !== null) {
      return this.estimatedLength(id) === null ? "untimed" : "timed";
    }
    if (this.bounded && planned !== null && this.passed(planned + SUBSCRIBE_TIMEOUT_MS)) {
      return "ignored";
    }
    return "pending";
  }

  private estimatedLength(id: NodeId): number | null {
    const durations = this.estimate?.durationsMs ?? {};
    if (Object.hasOwn(durations, id)) {
      return durations[id];
    }
    const seconds = this.doc.widgets[id].settings.duration;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    return null;
  }

  /** When the widget completed, from what was seen (or estimated). */
  private rawComplete(id: NodeId): Time {
    const planned = this.plannedEnter(id);
    if (planned === NEVER) {
      return NEVER;
    }
    const completed = this.fact(id, "completedAtMs");
    if (completed !== null) {
      return completed;
    }
    const status = this.status(id);
    if (status === "ignored") {
      return NEVER;
    }
    const subscribed = this.fact(id, "subscribedAtMs");
    if (status === "untimed" && subscribed !== null) {
      // An untimed widget completes as soon as its handler returns.
      return planned === null ? subscribed : Math.max(planned, subscribed);
    }
    if (this.estimate !== null && planned !== null) {
      return planned + (this.estimatedLength(id) ?? 0);
    }
    return null;
  }

  /**
   * A completion something else is anchored to. Once the cap has passed, a
   * widget that has not completed never will on this alert's timeline.
   */
  private completeForAnchor(id: NodeId): Time {
    const raw = this.rawComplete(id);
    if (raw === null && this.bounded && this.passed(MAX_ALERT_MS)) {
      return NEVER;
    }
    return raw;
  }

  private departure(id: NodeId): Departure {
    const planned = this.plannedEnter(id);
    if (planned === null || planned === NEVER) {
      return { leave: planned, exit: planned };
    }
    return this.bounded ? this.alertDeparture(id, planned) : this.sceneDeparture(id, planned);
  }

  private alertDeparture(id: NodeId, planned: number): Departure {
    const lead = this.leads.get(id) ?? 0;
    const close = this.activityClose(id);
    const end = this.end();
    if (close !== undefined) {
      if (close === null) {
        return { leave: null, exit: null };
      }
      // A widget held up by a fixed window holds the end at least that long,
      // unless the window runs past the cap.
      if (!this.afterEnd.has(id) && close > MAX_ALERT_MS) {
        return { leave: end, exit: add(end, lead) };
      }
      return { leave: Math.max(planned, close - lead), exit: close };
    }
    let leave: Time;
    if (this.afterEnd.has(id)) {
      // Nothing waits for a widget entering after the end; without a fixed
      // window of its own it leaves at once.
      leave = end === null ? null : Math.max(planned, end);
    } else if (this.status(id) === "timed") {
      const completed = this.rawComplete(id);
      if (completed !== null) {
        leave = end === null ? completed : Math.min(completed, end);
      } else {
        leave = end;
      }
    } else {
      leave = end;
    }
    return { leave, exit: add(leave, lead) };
  }

  private sceneDeparture(id: NodeId, planned: number): Departure {
    const lead = this.leads.get(id) ?? 0;
    const hidden = this.visibleWindow(id).hide;
    const close = this.activityClose(id);
    if (close === null) {
      return { leave: null, exit: null };
    }
    // Whichever comes first: being hidden, or the activity's window closing.
    const candidates: Departure[] = [];
    if (hidden !== null) {
      candidates.push({ leave: hidden, exit: hidden + lead });
    }
    if (close !== undefined) {
      candidates.push({ leave: Math.max(planned, close - lead), exit: close });
    }
    if (candidates.length === 0) {
      return { leave: null, exit: null };
    }
    candidates.sort((a, b) => (a.exit as number) - (b.exit as number));
    return candidates[0];
  }

  /** The widget's latest visible interval in a scene. */
  private visibleWindow(id: NodeId): { show: Time; hide: Time } {
    const changes = (this.facts.widgets?.[id]?.visibility ?? [])
      .map((change, index) => ({ at: this.relative(change.atMs, "visibility.atMs"), visible: change.visible, index }))
      .sort((a, b) => a.at - b.at || a.index - b.index);
    let visible = this.doc.widgets[id].visible;
    let show: Time = visible ? 0 : null;
    let hide: Time = null;
    for (const change of changes) {
      if (change.visible && !visible) {
        show = change.at;
        hide = null;
      } else if (!change.visible && visible) {
        hide = change.at;
      }
      visible = change.visible;
    }
    return { show, hide };
  }

  // ---- the composition ---------------------------------------------------

  /**
   * When the alert is over: every widget that holds it has released it,
   * capped at MAX_ALERT_MS. Widgets that enter relative to the end cannot
   * hold it.
   */
  private end(): Time {
    if (!this.bounded) {
      return null;
    }
    if (this.endMemo !== null) {
      return this.endMemo.value;
    }
    let unknown = false;
    let latest = 0;
    let anyHolds = false;
    for (const id of this.widgetIds) {
      if (this.afterEnd.has(id)) {
        continue;
      }
      const release = this.release(id);
      if (release === null) {
        unknown = true;
        continue;
      }
      if (release.time === NEVER) {
        continue;
      }
      latest = Math.max(latest, release.time);
      anyHolds = anyHolds || release.holds;
    }
    let value: Time;
    if (!unknown) {
      value = Math.min(MAX_ALERT_MS, anyHolds ? latest : Math.max(latest, UNTIMED_ALERT_MS));
    } else if (latest >= MAX_ALERT_MS || this.passed(MAX_ALERT_MS)) {
      value = MAX_ALERT_MS;
    } else {
      value = null;
    }
    this.endMemo = { value };
    return value;
  }

  /**
   * When a widget stops holding the alert, and whether it has a length of
   * its own (which waives the untimed hold). `null` while not known.
   */
  private release(id: NodeId): { time: number; holds: boolean } | null {
    const planned = this.plannedEnter(id);
    if (planned === null) {
      return null;
    }
    if (planned === NEVER) {
      return { time: NEVER, holds: false };
    }
    const close = this.activityClose(id);
    if (close !== undefined) {
      return close === null ? null : { time: close, holds: true };
    }
    const status = this.status(id);
    switch (status) {
      case "pending":
        return null;
      case "ignored":
        return { time: planned + SUBSCRIBE_TIMEOUT_MS, holds: false };
      case "untimed":
        return { time: this.rawComplete(id) as number, holds: false };
      case "timed": {
        const completed = this.rawComplete(id);
        return completed === null ? null : { time: completed, holds: true };
      }
      default:
        throw new Error(`timeline: widget ${id} has unexpected status ${status}`);
    }
  }

  private canvasDeparture(): Departure {
    if (!this.bounded) {
      return { leave: null, exit: null };
    }
    const end = this.end();
    return { leave: end, exit: add(end, this.leads.get(CANVAS_TARGET) ?? 0) };
  }

  private finish(): Time {
    let latest = this.canvasDeparture().exit;
    if (latest === null) {
      return null;
    }
    for (const id of this.widgetIds) {
      const { exit } = this.departure(id);
      if (exit === null) {
        return null;
      }
      if (exit !== NEVER) {
        latest = Math.max(latest, exit);
      }
    }
    return latest;
  }

  private revisitAt(): number | null {
    if (this.now === null || this.estimate !== null) {
      return null;
    }
    const deadlines: number[] = [];
    for (const id of this.widgetIds) {
      const planned = this.plannedEnter(id);
      if (planned === null || planned === NEVER) {
        continue;
      }
      if (this.bounded && this.status(id) === "pending") {
        deadlines.push(planned + SUBSCRIBE_TIMEOUT_MS);
      }
      if (this.enter(id) === null) {
        deadlines.push(planned + RENDER_WAIT_MS);
      }
    }
    if (this.bounded && this.end() === null) {
      deadlines.push(MAX_ALERT_MS);
    }
    const future = deadlines.filter((deadline) => deadline > (this.now as number));
    return future.length === 0 ? null : Math.min(...future);
  }

  // ---- behaviors ---------------------------------------------------------

  private behaviorWindow(id: BehaviorId, behavior: BehaviorDocument): { start: Time; end: Time } {
    const { timing, target } = behavior;
    if (behavior.type === "activity") {
      return this.activityWindow(behavior);
    }
    const phase = phaseOf(behavior);
    if (phase === null && !this.profile.anchors.includes(timing.anchor)) {
      this.problem(id, "anchor-not-in-profile");
      return { start: null, end: null };
    }
    const enter = target === CANVAS_TARGET ? 0 : this.enter(target);
    const departure = target === CANVAS_TARGET ? this.canvasDeparture() : this.departure(target);
    if (phase === "in") {
      const start = add(enter, timing.offsetMs);
      return { start, end: timing.durationMs === "until-exit" ? departure.exit : add(start, timing.durationMs) };
    }
    if (phase === "out") {
      if (timing.durationMs === "until-exit") {
        return { start: departure.leave, end: departure.exit };
      }
      const end = add(departure.exit, timing.offsetMs);
      return { start: add(end, -timing.durationMs), end };
    }
    let anchor: Time;
    switch (timing.anchor) {
      case "start":
        anchor = 0;
        break;
      case "end":
        anchor = this.end();
        break;
      case "enter":
        anchor = enter;
        break;
      case "exit":
        anchor = departure.exit;
        break;
      case "complete": {
        const node = timing.node ?? target;
        anchor = node === CANVAS_TARGET || !(node in this.doc.widgets) ? NEVER : this.completeForAnchor(node);
        break;
      }
      default:
        throw new Error(`timeline: unknown anchor ${String(timing.anchor)}`);
    }
    const start = add(anchor, timing.offsetMs);
    return { start, end: timing.durationMs === "until-exit" ? departure.exit : add(start, timing.durationMs) };
  }

  /** An activity's window: the window it sets, or for one set aside, the widget's own. */
  private activityWindow(behavior: BehaviorDocument): { start: Time; end: Time } {
    if (behavior.target === CANVAS_TARGET) {
      return { start: null, end: null };
    }
    const target = behavior.target;
    return { start: this.enter(target), end: this.departure(target).exit };
  }

  // ---- helpers -----------------------------------------------------------

  private targetExists(target: TargetId): boolean {
    return target === CANVAS_TARGET || Object.hasOwn(this.doc.widgets, target);
  }

  private fact(id: NodeId, key: "subscribedAtMs" | "renderedAtMs" | "completedAtMs"): number | null {
    const value = this.facts.widgets?.[id]?.[key];
    return value === undefined ? null : this.relative(value, key);
  }

  private relative(clock: number, name: string): number {
    assertFinite(clock, name);
    return clock - this.facts.startedAtMs;
  }

  /** Whether `time` has been reached, so what was due by then and is unseen will not be. */
  private passed(time: number): boolean {
    return this.now !== null && this.now >= time;
  }

  private problem(behavior: BehaviorId, kind: TimelineProblemKind): void {
    this.problems.push({ behavior, kind });
  }
}

function phaseOf(behavior: BehaviorDocument): "in" | "out" | null {
  if (behavior.type !== "transition") {
    return null;
  }
  const phase = behavior.params.phase;
  return phase === "in" || phase === "out" ? phase : null;
}

function compareOrder(a: BehaviorDocument, aId: string, b: BehaviorDocument, bId: string): number {
  if (a.order !== b.order) {
    return a.order < b.order ? -1 : 1;
  }
  return compareText(aId, bId);
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function add(time: Time, ms: number): Time {
  return time === null ? null : time + ms;
}

function known(time: Time): number | null {
  return time === null || time === NEVER ? null : time;
}

function assertFinite(value: unknown, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`timeline: ${name} must be a finite number`);
  }
}
