// What the overlay shows of a composition at one moment, as plain data.
//
// `planFrame` reads a document, and optionally its resolved timeline (see
// model/timeline.ts), and says for every widget where its box is, how it is
// stacked, whether it is shown, and which animations play on it. It touches
// no DOM and holds no clock, so the overlay, the editor's preview and tests
// all share it; `diffPlans` (see diff.ts) turns two plans into the few writes
// that take the page from one to the other.
//
// Animations are planned in absolute composition time (`spec.timing.delay` is
// the behavior's start in ms since the composition started), not relative to
// the moment of planning, so a plan made later never moves an animation that
// is already playing and the editor can scrub by setting `currentTime`.
//
// What is not rendered is left out rather than refused: a document merged
// from concurrent edits, or written by a newer client, must still play.
// Behaviors of a type this runtime does not know, behaviors on a widget that
// no longer exists, and host kinds whose params do not compile are skipped and
// reported in `skipped`. A transition or effect of a kind the host does not
// play is the widget's own (a text widget's typewriter) and is planned as a
// delegation, which the overlay hands to the widget over the widget protocol.
// Given what each widget declares (`PlanOptions.declaredKinds`), a widget
// kind its widget does not declare is skipped too: a widget told to play a
// kind it never declared shows as it is, and the skip at least says why.

import { type AnimationSpec, compileAnimation, type HostLayer, isHostKind } from "../model/animation";
import { type DeclaredBehaviorKinds, declaresKind, NO_DECLARED_KINDS } from "../model/entity-types";
import type { ResolvedTimeline } from "../model/timeline";
import {
  type BehaviorDocument,
  type BehaviorId,
  CANVAS_TARGET,
  type CompositionDocument,
  type Easing,
  type NodeId,
  type PlacementDocument,
} from "../model/types";

/** Where a widget's box sits on the canvas, in canvas pixels. */
export interface BoxState {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise about the box's centre. */
  rotation: number;
  opacity: number;
}

/** A host animation on one wrapper, keyed by the behavior it plays. */
export interface PlannedAnimation {
  behavior: BehaviorId;
  spec: AnimationSpec;
}

/**
 * A behavior the widget plays itself. Times are in ms since the composition
 * started; `endMs` is `null` while the window is open-ended or not known yet.
 */
export interface DelegatedBehavior {
  behavior: BehaviorId;
  type: string;
  kind: string;
  /** A transition's `params.phase`; `null` for anything else. */
  phase: "in" | "out" | null;
  startMs: number;
  endMs: number | null;
  easing: Easing;
  params: Record<string, unknown>;
}

/** Animations on a target, by the wrapper they play on, in composite order. */
export type LayerAnimations = Record<HostLayer, PlannedAnimation[]>;

export interface WidgetPlan {
  id: NodeId;
  /** The placement's canonical widget id; a change means new content. */
  widget: string;
  box: BoxState;
  /** Stacking rank, 0 at the bottom, dense across the plan's widgets. */
  z: number;
  visible: boolean;
  /** Not shown yet, but its entrance waits on its frame painting, so it must keep rendering unseen. */
  awaitingPaint: boolean;
  animations: LayerAnimations;
  /** Behaviors handed to the widget, in behavior order. */
  delegated: DelegatedBehavior[];
}

export type PlanSkipReason =
  | "unknown-type"
  | "dangling-target"
  | "invalid-params"
  | "canvas-delegate"
  | "undeclared-kind";

export interface PlanSkip {
  behavior: BehaviorId;
  reason: PlanSkipReason;
}

export interface RenderPlan {
  /** The composition time this plan is for, or `null` for a plan without a timeline. */
  atMs: number | null;
  widgets: Record<NodeId, WidgetPlan>;
  /** Animations on the canvas root, around every widget. */
  canvas: { animations: LayerAnimations };
  /**
   * The next composition time after `atMs` at which this plan changes with
   * no new fact: a widget is shown or hidden, or a delegation starts. A
   * timer that re-plans then is all the overlay needs between facts.
   */
  nextChangeMs: number | null;
  skipped: PlanSkip[];
}

/** Gesture state the editor has not committed, laid over the document. */
export type TransientOverrides = Readonly<
  Record<NodeId, Partial<Pick<PlacementDocument, "x" | "y" | "width" | "height" | "rotation" | "opacity" | "z">>>
>;

export interface PlanOptions {
  /**
   * The resolved timeline, and the composition time to plan for. Without a
   * timeline every widget is shown as its placement says and nothing
   * animates: a static layout.
   */
  timeline?: ResolvedTimeline;
  atMs?: number;
  /**
   * Per-widget data the page needs before it can mount a widget (the frame
   * URL the server resolved). When given, a widget without an entry is left
   * out until its entry arrives.
   */
  meta?: Readonly<Record<NodeId, unknown>>;
  transient?: TransientOverrides;
  /**
   * The kinds a widget declares it plays itself, from the widget catalog;
   * `undefined` for a widget the catalog lists none for, which then declares
   * none. When given, a widget kind is handed over only to a widget that
   * declares it, and skipped as `undeclared-kind` otherwise. Without it every
   * kind the host does not play is handed over, for a caller with no catalog.
   */
  declaredKinds?(widgetId: NodeId): DeclaredBehaviorKinds | undefined;
}

/** The behavior types the runtime renders; anything else is skipped. */
const RENDERED_TYPES: readonly string[] = ["transition", "effect"];

export function planFrame(doc: CompositionDocument, options: PlanOptions = {}): RenderPlan {
  const { timeline, meta, transient } = options;
  if (timeline !== undefined && !(typeof options.atMs === "number" && Number.isFinite(options.atMs))) {
    throw new Error("plan: atMs must be a finite number when a timeline is given");
  }
  const atMs = timeline === undefined ? null : (options.atMs as number);

  // A widget the timeline says will never enter (a hidden widget in an
  // alert) is not mounted at all: a mounted frame would still subscribe,
  // receive the alert and play its sound out of sight.
  const ids = Object.keys(doc.widgets).filter(
    (id) => (meta === undefined || Object.hasOwn(meta, id)) && timeline?.widgets[id]?.status !== "never"
  );
  const zOf = (id: NodeId): string => transient?.[id]?.z ?? doc.widgets[id].z;
  ids.sort((a, b) => compareText(zOf(a), zOf(b)) || compareText(a, b));

  const widgets: Record<NodeId, WidgetPlan> = {};
  const changes: number[] = [];
  ids.forEach((id, rank) => {
    const placement = { ...doc.widgets[id], ...transient?.[id] };
    widgets[id] = {
      id,
      widget: placement.widget,
      box: {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        rotation: placement.rotation,
        opacity: placement.opacity,
      },
      z: rank,
      visible: timeline === undefined ? placement.visible : shownAt(timeline, id, atMs as number, changes),
      awaitingPaint: timeline?.widgets[id]?.awaitingPaint ?? false,
      animations: { transition: [], effect: [] },
      delegated: [],
    };
  });

  const canvas = { animations: { transition: [], effect: [] } as LayerAnimations };
  const skipped: PlanSkip[] = [];
  if (timeline !== undefined) {
    for (const [behaviorId, behavior] of sortedBehaviors(doc)) {
      planBehavior(behaviorId, behavior, {
        timeline,
        atMs: atMs as number,
        doc,
        widgets,
        canvas,
        skipped,
        changes,
        declaredKinds: options.declaredKinds,
      });
    }
  }

  const future = changes.filter((time) => time > (atMs as number));
  return {
    atMs,
    widgets,
    canvas,
    nextChangeMs: future.length === 0 ? null : Math.min(...future),
    skipped,
  };
}

/** Whether a widget is shown at `atMs`, noting when that next changes. */
function shownAt(timeline: ResolvedTimeline, id: NodeId, atMs: number, changes: number[]): boolean {
  const resolved = timeline.widgets[id];
  if (resolved === undefined) {
    throw new Error(`plan: the timeline has no entry for widget ${id}; resolve it for this document`);
  }
  const { enterMs, exitMs } = resolved;
  if (enterMs !== null) {
    changes.push(enterMs);
  }
  if (exitMs !== null) {
    changes.push(exitMs);
  }
  return enterMs !== null && enterMs <= atMs && (exitMs === null || atMs < exitMs);
}

/** What planning one behavior reads, and the lists it adds to. */
interface BehaviorPlanning {
  timeline: ResolvedTimeline;
  atMs: number;
  doc: CompositionDocument;
  widgets: Record<NodeId, WidgetPlan>;
  canvas: { animations: LayerAnimations };
  skipped: PlanSkip[];
  changes: number[];
  declaredKinds: PlanOptions["declaredKinds"];
}

function planBehavior(id: BehaviorId, behavior: BehaviorDocument, planning: BehaviorPlanning): void {
  const { timeline, atMs, doc, widgets, canvas, skipped, changes, declaredKinds } = planning;
  if (behavior.type === "activity") {
    // An activity only shapes the timeline, which already accounts for it.
    return;
  }
  if (!RENDERED_TYPES.includes(behavior.type)) {
    skipped.push({ behavior: id, reason: "unknown-type" });
    return;
  }
  const onCanvas = behavior.target === CANVAS_TARGET;
  if (!onCanvas && !Object.hasOwn(doc.widgets, behavior.target)) {
    skipped.push({ behavior: id, reason: "dangling-target" });
    return;
  }
  const target = onCanvas ? canvas : widgets[behavior.target];
  if (target === undefined) {
    // A widget left out (no meta yet, or it never enters); its behaviors go with it.
    return;
  }
  const window = timeline.behaviors[id];
  if (window === undefined || window.startMs === null) {
    // Not known yet: a later fact will place it.
    return;
  }

  if (!isHostKind(behavior.type, behavior.kind)) {
    if (onCanvas) {
      skipped.push({ behavior: id, reason: "canvas-delegate" });
      return;
    }
    if (
      declaredKinds !== undefined &&
      !declaresKind(declaredKinds(behavior.target) ?? NO_DECLARED_KINDS, behavior.type, behavior.kind)
    ) {
      skipped.push({ behavior: id, reason: "undeclared-kind" });
      return;
    }
    // Handed over when it starts, so the widget is told "play this now".
    changes.push(window.startMs);
    if (window.startMs <= atMs) {
      (target as WidgetPlan).delegated.push({
        behavior: id,
        type: behavior.type,
        kind: behavior.kind,
        phase: phaseOf(behavior),
        startMs: window.startMs,
        endMs: window.endMs,
        easing: behavior.timing.easing,
        params: behavior.params,
      });
    }
    return;
  }

  if (behavior.type === "transition" && window.endMs === null) {
    // A transition until an exit that is not known yet.
    return;
  }
  let spec: AnimationSpec | null;
  try {
    spec = compileAnimation(behavior, { startMs: window.startMs, endMs: window.endMs });
  } catch {
    // Validation refuses these; one that slipped through a merge must not
    // stop the rest of the composition from playing.
    skipped.push({ behavior: id, reason: "invalid-params" });
    return;
  }
  if (spec === null) {
    throw new Error(`plan: host kind ${behavior.type}/${behavior.kind} compiled to nothing`);
  }
  target.animations[spec.layer].push({ behavior: id, spec });
}

/** Behaviors in the order they compose: by `order`, then id. */
function sortedBehaviors(doc: CompositionDocument): Array<[BehaviorId, BehaviorDocument]> {
  return Object.entries(doc.behaviors).sort(
    ([aId, a], [bId, b]) => compareText(a.order, b.order) || compareText(aId, bId)
  );
}

function phaseOf(behavior: BehaviorDocument): "in" | "out" | null {
  if (behavior.type !== "transition") {
    return null;
  }
  const phase = behavior.params.phase;
  return phase === "in" || phase === "out" ? phase : null;
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** How a canvas is scaled and centred to fit an area, as `translate(x, y) scale(scale)`. */
export interface CanvasFit {
  scale: number;
  x: number;
  y: number;
}

/**
 * Fit a canvas inside an area, keeping its aspect ratio: an alert's stage
 * inside the alert widget's box on a scene.
 */
export function fitCanvas(
  canvas: { width: number; height: number },
  area: { width: number; height: number }
): CanvasFit {
  if (!(canvas.width > 0 && canvas.height > 0)) {
    throw new Error("plan: a canvas must have a positive width and height");
  }
  const scale = Math.min(area.width / canvas.width, area.height / canvas.height);
  return {
    scale,
    x: (area.width - canvas.width * scale) / 2,
    y: (area.height - canvas.height * scale) / 2,
  };
}
