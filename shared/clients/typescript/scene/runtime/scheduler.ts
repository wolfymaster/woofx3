// Plays a composition: keeps the page in step with the timeline as it is
// observed.
//
// The scheduler holds what has been seen of each widget (it subscribed,
// painted, completed, was shown or hidden) and, each time that grows or a
// planned moment arrives, resolves the timeline again (see model/timeline.ts),
// plans the frame for now (plan.ts) and hands the difference from the last
// plan (diff.ts) to the renderer. Between facts it sleeps until the earliest
// of: the timeline's `revisitAtMs` (a subscription times out, the alert cap),
// the plan's `nextChangeMs` (a widget is shown or hidden, a delegation
// starts), and, for an alert, `finishMs`, when it reports `finished` once.
//
// Animations need no timer: they are started with their planned times as
// soon as those are known, and run on the document timeline.
//
// The clock is injected, and is the one every fact time is read from; the
// overlay passes `Date.now` and `setTimeout`, tests a fake.
//
// The editor's composition preview plays on a clock that can pause and jump.
// It resolves with `estimate`, so the timeline is complete before anything is
// observed and stays put while the playhead moves over it, and calls `resync`
// after each jump.

import {
  type ResolvedTimeline,
  resolveTimeline,
  type TimelineEstimates,
  type TimelineFacts,
  type WidgetFacts,
} from "../model/timeline";
import type { CompositionDocument, CompositionProfile, NodeId } from "../model/types";
import { diffPlans, type PatchOp } from "./diff";
import { type PlanOptions, type PlanSkip, planFrame, type RenderPlan, type TransientOverrides } from "./plan";

export interface SchedulerClock<THandle = unknown> {
  /** Milliseconds on a monotonic-enough clock, the same one every fact is read from. */
  now(): number;
  /** Call `callback` once `now()` has reached `atMs`. */
  setTimer(atMs: number, callback: () => void): THandle;
  clearTimer(handle: THandle): void;
}

/** Whatever applies patches: the DOM renderer, or a recorder in tests. */
export interface PatchTarget {
  apply(ops: readonly PatchOp[]): void;
}

export interface SchedulerOptions<THandle = unknown> {
  doc: CompositionDocument;
  profile: CompositionProfile;
  clock: SchedulerClock<THandle>;
  renderer: PatchTarget;
  /** See `PlanOptions.meta`. */
  meta?: Readonly<Record<NodeId, unknown>>;
  /** See `PlanOptions.declaredKinds`. Read at every plan, so it may follow meta as it changes. */
  declaredKinds?: PlanOptions["declaredKinds"];
  /**
   * Behaviors the plan leaves out, each reported once per reason for as long
   * as this scheduler plays: a plan is made on every fact, and the same skip
   * every time is one problem, not many.
   */
  onSkipped?(skips: readonly PlanSkip[]): void;
  /**
   * Resolve with estimates (see `TimelineOptions.estimate`): what has not
   * been observed is filled in, so every time is known from the start. For
   * a preview, which must be able to show any moment before it has played
   * there; an overlay waits for what it observes instead.
   */
  estimate?: TimelineEstimates;
  /** A bounded composition (an alert) has played out: every widget has exited. */
  onFinished?(): void;
}

export interface Scheduler {
  widgetSubscribed(id: NodeId, timed: boolean): void;
  widgetRendered(id: NodeId): void;
  widgetCompleted(id: NodeId): void;
  /** A scene widget was shown or hidden other than through `setDocument`. */
  visibilityChanged(id: NodeId, visible: boolean): void;
  /**
   * The document changed. A widget whose `visible` flipped is shown or
   * hidden from now, with its transitions; a widget added after the start
   * enters from now.
   */
  setDocument(doc: CompositionDocument, meta?: Readonly<Record<NodeId, unknown>>): void;
  /** Lay uncommitted gesture state over the document (the editor's live preview). */
  setTransient(transient: TransientOverrides | undefined): void;
  /** The latest resolution, for inspection. */
  timeline(): ResolvedTimeline;
  plan(): RenderPlan;
  /** Ms since the composition started. */
  elapsedMs(): number;
  /**
   * The clock jumped rather than ran: plan for the time it reads now. Facts
   * keep the times they were observed at. A bounded composition moved back
   * before its finish reports `finished` again when it gets there.
   */
  resync(): void;
  /** Stop scheduling; the renderer is left as it is for its owner to dispose. */
  dispose(): void;
}

interface Observed extends WidgetFacts {
  visibility: Array<{ atMs: number; visible: boolean }>;
}

export function createScheduler<THandle>(options: SchedulerOptions<THandle>): Scheduler {
  const { profile, clock, renderer } = options;
  const startedAtMs = clock.now();
  let doc = options.doc;
  let meta = options.meta;
  let transient: TransientOverrides | undefined;
  const observed = new Map<NodeId, Observed>();
  // The visibility each widget started with: the resolver replays changes
  // from it, so it must not move when the document's flag does.
  const initialVisible = new Map<NodeId, boolean>();
  const currentVisible = new Map<NodeId, boolean>();
  let lastTimeline: ResolvedTimeline | null = null;
  let lastPlan: RenderPlan | null = null;
  const reportedSkips = new Set<string>();
  let timer: { handle: THandle } | null = null;
  let finished = false;
  let disposed = false;

  for (const [id, placement] of Object.entries(doc.widgets)) {
    initialVisible.set(id, placement.visible);
    currentVisible.set(id, placement.visible);
  }

  function factsOf(id: NodeId): Observed {
    let facts = observed.get(id);
    if (facts === undefined) {
      facts = { visibility: [] };
      observed.set(id, facts);
    }
    return facts;
  }

  function recordVisibility(id: NodeId, visible: boolean, atMs: number): void {
    if (currentVisible.get(id) === visible) {
      return;
    }
    currentVisible.set(id, visible);
    factsOf(id).visibility.push({ atMs, visible });
  }

  function resolverDocument(): CompositionDocument {
    const widgets: CompositionDocument["widgets"] = {};
    for (const [id, placement] of Object.entries(doc.widgets)) {
      const visible = initialVisible.get(id);
      if (visible === undefined) {
        throw new Error(`runtime: widget ${id} has no starting visibility`);
      }
      widgets[id] = visible === placement.visible ? placement : { ...placement, visible };
    }
    return { ...doc, widgets };
  }

  function update(): void {
    if (disposed) {
      return;
    }
    const now = clock.now();
    const facts: TimelineFacts = { startedAtMs, nowMs: now, widgets: Object.fromEntries(observed) };
    const timeline = resolveTimeline(
      resolverDocument(),
      profile,
      facts,
      options.estimate === undefined ? {} : { estimate: options.estimate }
    );
    const atMs = now - startedAtMs;
    const plan = planFrame(doc, { timeline, atMs, meta, transient, declaredKinds: options.declaredKinds });
    const ops = diffPlans(lastPlan, plan);
    lastTimeline = timeline;
    lastPlan = plan;
    if (ops.length > 0) {
      renderer.apply(ops);
    }
    reportSkips(plan.skipped);
    schedule(timeline, plan, atMs);
  }

  function reportSkips(skips: readonly PlanSkip[]): void {
    if (options.onSkipped === undefined) {
      return;
    }
    const fresh = skips.filter((skip) => !reportedSkips.has(`${skip.behavior}\u0000${skip.reason}`));
    if (fresh.length === 0) {
      return;
    }
    for (const skip of fresh) {
      reportedSkips.add(`${skip.behavior}\u0000${skip.reason}`);
    }
    options.onSkipped(fresh);
  }

  function schedule(timeline: ResolvedTimeline, plan: RenderPlan, atMs: number): void {
    if (timer !== null) {
      clock.clearTimer(timer.handle);
      timer = null;
    }
    const finishMs = profile.bounded && !finished ? timeline.finishMs : null;
    if (finishMs !== null && finishMs <= atMs) {
      finished = true;
      options.onFinished?.();
      return;
    }
    const due = [timeline.revisitAtMs, plan.nextChangeMs, finishMs].filter(
      (time): time is number => time !== null && time > atMs
    );
    if (due.length === 0 || finished) {
      return;
    }
    timer = { handle: clock.setTimer(startedAtMs + Math.min(...due), onTimer) };
  }

  function onTimer(): void {
    timer = null;
    update();
  }

  /**
   * Facts race teardown and document changes: a frame can report after its
   * widget was removed or the composition was disposed. Such a fact
   * describes nothing on the page and is dropped.
   */
  function accepts(id: NodeId): boolean {
    return !disposed && Object.hasOwn(doc.widgets, id);
  }

  update();

  return {
    widgetSubscribed(id, timed) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      if (facts.subscribedAtMs !== undefined) {
        return;
      }
      facts.subscribedAtMs = clock.now();
      facts.timed = timed;
      update();
    },

    widgetRendered(id) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      // The first paint is the one that counts; a frame swapped in for new
      // settings paints again without the widget entering again.
      if (facts.renderedAtMs !== undefined) {
        return;
      }
      facts.renderedAtMs = clock.now();
      update();
    },

    widgetCompleted(id) {
      if (!accepts(id)) {
        return;
      }
      const facts = factsOf(id);
      if (facts.completedAtMs !== undefined) {
        return;
      }
      facts.completedAtMs = clock.now();
      update();
    },

    visibilityChanged(id, visible) {
      if (!accepts(id)) {
        return;
      }
      recordVisibility(id, visible, clock.now());
      update();
    },

    setDocument(next, nextMeta) {
      if (disposed) {
        throw new Error("runtime: setDocument after the scheduler was disposed");
      }
      const now = clock.now();
      for (const id of Object.keys(doc.widgets)) {
        if (!Object.hasOwn(next.widgets, id)) {
          observed.delete(id);
          initialVisible.delete(id);
          currentVisible.delete(id);
        }
      }
      for (const [id, placement] of Object.entries(next.widgets)) {
        if (!initialVisible.has(id)) {
          // Starts hidden and is shown now, so it enters now rather than at
          // the composition's start, which has long passed.
          initialVisible.set(id, false);
          currentVisible.set(id, false);
        }
        recordVisibility(id, placement.visible, now);
      }
      doc = next;
      if (nextMeta !== undefined) {
        meta = nextMeta;
      }
      update();
    },

    setTransient(next) {
      transient = next;
      update();
    },

    timeline() {
      if (lastTimeline === null) {
        throw new Error("runtime: the scheduler has not resolved yet");
      }
      return lastTimeline;
    },

    plan() {
      if (lastPlan === null) {
        throw new Error("runtime: the scheduler has not planned yet");
      }
      return lastPlan;
    },

    elapsedMs() {
      return clock.now() - startedAtMs;
    },

    resync() {
      if (disposed) {
        throw new Error("runtime: resync after the scheduler was disposed");
      }
      const finishMs = lastTimeline?.finishMs ?? null;
      if (finished && finishMs !== null && clock.now() - startedAtMs < finishMs) {
        finished = false;
      }
      update();
    },

    dispose() {
      disposed = true;
      if (timer !== null) {
        clock.clearTimer(timer.handle);
        timer = null;
      }
    },
  };
}
