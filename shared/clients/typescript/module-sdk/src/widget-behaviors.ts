// Behaviors a widget plays itself.
//
// A composition animates a placed widget through behaviors: a transition as
// it enters or leaves, an effect while it is shown. The host plays its own
// kinds (fade, slide, shake, ...) on the frame's box and the widget never
// hears of them. A widget can also declare kinds of its own in its manifest
// (`transitions` and `effects`), which animate its content, such as a text
// widget typing its letters in. Those the host hands to the frame: the shim
// marks the frame's root element with the behavior, and the widget's CSS
// animates from the marks.
//
// A transition marks :root with
//
//   data-transition="{kind}"  data-transition-phase="in|out"
//   --transition-duration     --transition-easing
//
// and an effect with
//
//   data-effect="{kind}"      --effect-duration     --effect-easing
//
// A widget selects on the marks:
//
//   :root[data-transition="typewriter"][data-transition-phase="in"] .letter {
//     animation: reveal var(--transition-duration) var(--transition-easing) both;
//   }
//
// The host sends a widget only the kinds it declares: a behavior of any other
// widget kind on it is skipped, and reported, rather than sent. A widget
// whose CSS does not select on a kind it declares simply shows as it is.

import type { BindingDocument } from "./widget-bindings";

/** The behavior types a widget can play itself. */
export const WIDGET_BEHAVIOR_TYPES = ["transition", "effect"] as const;
export type WidgetBehaviorType = (typeof WIDGET_BEHAVIOR_TYPES)[number];

/**
 * A kind a widget declares for itself. Kept to a CSS-identifier-safe token,
 * since it ends up in an attribute selector in the widget's stylesheet. Must
 * match `KIND_ID` in @woofx3/scene's model/entity-types.ts and
 * `is_widget_behavior_kind` in barkloader's manifest_validate.rs.
 */
export const WIDGET_BEHAVIOR_KIND = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * CSS easing keywords. Arbitrary `cubic-bezier()` is left out on purpose:
 * every value here is a token a widget's CSS can use as it is. Must match
 * `EASINGS` in @woofx3/scene's model/types.ts.
 */
export const WIDGET_BEHAVIOR_EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;
export type WidgetBehaviorEasing = (typeof WIDGET_BEHAVIOR_EASINGS)[number];

export type WidgetTransitionPhase = "in" | "out";

/** A kind a widget declares in its manifest's `transitions` or `effects`. */
export interface WidgetBehaviorKindDefinition {
  /** What a behavior's `kind` names and the `data-transition` / `data-effect` mark is set to. */
  id: string;
  /** What an editor shows for it. */
  label: string;
}

/** One behavior the host asks the widget to play, from now. */
export interface WidgetBehaviorState {
  type: WidgetBehaviorType;
  kind: string;
  /** A transition's phase; absent for an effect. */
  phase?: WidgetTransitionPhase;
  /** How long it runs, or `null` until the host withdraws it (an effect while the widget is shown). */
  durationMs: number | null;
  easing: WidgetBehaviorEasing;
  /** The behavior's own params as the composition gives them, for a widget that reads them. */
  params: Record<string, unknown>;
}

export function isWidgetBehaviorState(value: unknown): value is WidgetBehaviorState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const state = value as Record<string, unknown>;
  const phaseFits =
    state.type === "transition" ? state.phase === "in" || state.phase === "out" : state.phase === undefined;
  return (
    (WIDGET_BEHAVIOR_TYPES as readonly unknown[]).includes(state.type) &&
    phaseFits &&
    typeof state.kind === "string" &&
    WIDGET_BEHAVIOR_KIND.test(state.kind) &&
    (state.durationMs === null ||
      (typeof state.durationMs === "number" && Number.isFinite(state.durationMs) && state.durationMs >= 0)) &&
    (WIDGET_BEHAVIOR_EASINGS as readonly unknown[]).includes(state.easing) &&
    typeof state.params === "object" &&
    state.params !== null &&
    !Array.isArray(state.params)
  );
}

/** The attribute and properties one behavior type marks :root with. */
interface BehaviorMarks {
  kind: string;
  phase: string | null;
  duration: string;
  easing: string;
}

const MARKS: Readonly<Record<WidgetBehaviorType, BehaviorMarks>> = {
  transition: {
    kind: "data-transition",
    phase: "data-transition-phase",
    duration: "--transition-duration",
    easing: "--transition-easing",
  },
  effect: { kind: "data-effect", phase: null, duration: "--effect-duration", easing: "--effect-easing" },
};

/**
 * Mark the frame's root element with a behavior, replacing the last one of
 * its type, or with `null` clear every mark so the widget shows as it is.
 *
 * The marks are cleared and the root's layout read before they are set
 * again, so playing the same behavior twice restarts its CSS animations
 * rather than leaving them finished.
 */
export function applyWidgetBehavior(doc: BindingDocument, state: WidgetBehaviorState | null): void {
  const root = doc.documentElement;
  const types = state === null ? WIDGET_BEHAVIOR_TYPES : [state.type];
  for (const type of types) {
    const marks = MARKS[type];
    root.removeAttribute(marks.kind);
    if (marks.phase !== null) {
      root.removeAttribute(marks.phase);
    }
    root.style.removeProperty(marks.duration);
    root.style.removeProperty(marks.easing);
  }
  if (state === null) {
    return;
  }
  void (root as { offsetWidth?: number }).offsetWidth;
  const marks = MARKS[state.type];
  if (state.durationMs !== null) {
    root.style.setProperty(marks.duration, `${state.durationMs}ms`);
  }
  root.style.setProperty(marks.easing, state.easing);
  if (marks.phase !== null && state.phase !== undefined) {
    root.setAttribute(marks.phase, state.phase);
  }
  root.setAttribute(marks.kind, state.kind);
}
