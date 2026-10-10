// How a placed widget appears and leaves.
//
// A transition belongs to the placement, not to the widget's code: the scene
// or alert layout says how each placement enters (`transitionIn`) and leaves
// (`transitionOut`), and the page that hosts the widget plays it. The
// generic types below move the placement's whole box and work for every
// widget. A widget can also declare types of its own in its manifest
// (`transitions`), which animate its content (a text widget revealing letter
// by letter): the page hands those to the frame, the shim marks the frame's
// root element with them, and the widget's own CSS animates.
//
// This file is the one definition of the shape: sceneManager validates
// placements with it, the page plays them, and the shim applies a widget's
// own types.

import type { BindingDocument } from "./widget-bindings";

/** Types the host plays on the placement's box, for any widget. */
export const GENERIC_TRANSITION_TYPES = ["fade", "slide", "zoom", "bounce", "spin", "pop", "blur"] as const;
export type GenericTransitionType = (typeof GENERIC_TRANSITION_TYPES)[number];

/** Which way a `slide` moves: in from the opposite side, out toward this one. */
export const TRANSITION_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

/** CSS easing keywords. Arbitrary `cubic-bezier()` is left out on purpose:
 *  every value here is a token a widget's CSS can use as it is. */
export const TRANSITION_EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;
export type TransitionEasing = (typeof TRANSITION_EASINGS)[number];

export const MIN_TRANSITION_MS = 50;
/** Long enough for any entrance; an out-transition holds a placement (and an
 *  alert) on screen for this long, so it is bounded. */
export const MAX_TRANSITION_MS = 10_000;

/**
 * A type a widget declares for itself. Kept to a CSS-identifier-safe token,
 * since it ends up in an attribute selector in the widget's stylesheet.
 * Must match `WIDGET_TRANSITION_ID` in barkloader's module_manifest.rs.
 */
export const WIDGET_TRANSITION_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** How one placement enters or leaves. Absent on a placement means none. */
export interface PlacementTransition {
  /** A generic type, or one the placed widget declares. */
  type: string;
  durationMs: number;
  /** Defaults to `ease-out` entering and `ease-in` leaving. */
  easing?: TransitionEasing;
  /** Only for `slide`, where it defaults to `up`. */
  direction?: TransitionDirection;
}

/** A transition a widget declares in its manifest. */
export interface WidgetTransitionDefinition {
  id: string;
  label: string;
}

export type TransitionPhase = "in" | "out";

/**
 * What the shim applies to a frame for one of the widget's own types: the
 * frame's root element gets `data-transition` and `data-transition-phase`,
 * and the `--transition-duration` and `--transition-easing` properties.
 */
export interface WidgetTransitionState {
  phase: TransitionPhase;
  type: string;
  durationMs: number;
  easing: TransitionEasing;
}

export function isGenericTransitionType(type: string): type is GenericTransitionType {
  return (GENERIC_TRANSITION_TYPES as readonly string[]).includes(type);
}

export type PlacementTransitionParse = { ok: true; transition: PlacementTransition } | { ok: false; reason: string };

const TRANSITION_KEYS = new Set(["type", "durationMs", "easing", "direction"]);

/**
 * Check a placement's `transitionIn` or `transitionOut`. Only the shape: a
 * type that is not generic is the widget's own, and whether the widget
 * declares it is for the caller, who knows the widget, to check (see
 * `isTransitionAvailable`). Unknown fields are refused rather than ignored,
 * so a misspelling is caught where it is written.
 */
export function parsePlacementTransition(value: unknown): PlacementTransitionParse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "a transition must be an object" };
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!TRANSITION_KEYS.has(key)) {
      return { ok: false, reason: `a transition has no field ${JSON.stringify(key)}` };
    }
  }
  if (typeof raw.type !== "string" || !WIDGET_TRANSITION_ID.test(raw.type)) {
    return { ok: false, reason: "a transition's type must be a lowercase token" };
  }
  if (
    typeof raw.durationMs !== "number" ||
    !Number.isInteger(raw.durationMs) ||
    raw.durationMs < MIN_TRANSITION_MS ||
    raw.durationMs > MAX_TRANSITION_MS
  ) {
    return {
      ok: false,
      reason: `a transition's durationMs must be a whole number from ${MIN_TRANSITION_MS} to ${MAX_TRANSITION_MS}`,
    };
  }
  if (raw.easing !== undefined && !(TRANSITION_EASINGS as readonly unknown[]).includes(raw.easing)) {
    return { ok: false, reason: `a transition's easing must be one of ${TRANSITION_EASINGS.join(", ")}` };
  }
  if (raw.direction !== undefined) {
    if (raw.type !== "slide") {
      return { ok: false, reason: "only a slide has a direction" };
    }
    if (!(TRANSITION_DIRECTIONS as readonly unknown[]).includes(raw.direction)) {
      return { ok: false, reason: `a slide's direction must be one of ${TRANSITION_DIRECTIONS.join(", ")}` };
    }
  }
  const transition: PlacementTransition = { type: raw.type, durationMs: raw.durationMs };
  if (raw.easing !== undefined) {
    transition.easing = raw.easing as TransitionEasing;
  }
  if (raw.direction !== undefined) {
    transition.direction = raw.direction as TransitionDirection;
  }
  return { ok: true, transition };
}

/** Whether a placement of a widget declaring `declared` can play `type`. */
export function isTransitionAvailable(type: string, declared: readonly string[]): boolean {
  return isGenericTransitionType(type) || declared.includes(type);
}

/** The easing a transition plays with. */
export function transitionEasing(transition: PlacementTransition, phase: TransitionPhase): TransitionEasing {
  return transition.easing ?? (phase === "in" ? "ease-out" : "ease-in");
}

/** What the frame is told for one of the widget's own types. */
export function widgetTransitionState(transition: PlacementTransition, phase: TransitionPhase): WidgetTransitionState {
  return {
    phase,
    type: transition.type,
    durationMs: transition.durationMs,
    easing: transitionEasing(transition, phase),
  };
}

export function isWidgetTransitionState(value: unknown): value is WidgetTransitionState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const state = value as Record<string, unknown>;
  return (
    (state.phase === "in" || state.phase === "out") &&
    typeof state.type === "string" &&
    WIDGET_TRANSITION_ID.test(state.type) &&
    typeof state.durationMs === "number" &&
    Number.isFinite(state.durationMs) &&
    state.durationMs >= 0 &&
    (TRANSITION_EASINGS as readonly unknown[]).includes(state.easing)
  );
}

/**
 * Mark the frame's root element with one of the widget's own transitions, or
 * clear the mark (`null`). The widget's CSS animates from these:
 *
 *   :root[data-transition="typewriter"][data-transition-phase="in"] .letter {
 *     animation: reveal var(--transition-duration) var(--transition-easing) both;
 *   }
 *
 * The attributes are cleared and the root's layout read before they are set
 * again, so playing the same transition twice restarts its CSS animations
 * rather than leaving them finished.
 */
export function applyWidgetTransition(doc: BindingDocument, state: WidgetTransitionState | null): void {
  const root = doc.documentElement;
  root.removeAttribute("data-transition");
  root.removeAttribute("data-transition-phase");
  root.style.removeProperty("--transition-duration");
  root.style.removeProperty("--transition-easing");
  if (state === null) {
    return;
  }
  void (root as { offsetWidth?: number }).offsetWidth;
  root.style.setProperty("--transition-duration", `${state.durationMs}ms`);
  root.style.setProperty("--transition-easing", state.easing);
  root.setAttribute("data-transition-phase", state.phase);
  root.setAttribute("data-transition", state.type);
}
