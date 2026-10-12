// What the overlay plays for a behavior it animates itself, as plain data
// for the Web Animations API: `element.animate(spec.keyframes, spec.timing)`.
//
// The host plays a fixed set of kinds on the widget's box, for every widget
// and without the widget knowing. Any other kind is the widget's own (a text
// widget's typewriter): `compileAnimation` returns `null` for it and the
// overlay hands it to the widget over the widget protocol instead.
//
// A widget is wrapped in layers, outermost first: the box (position, size,
// rotation, opacity, stacking), the transition wrapper, the effect wrapper,
// then the frame. Each wrapper animates only the properties listed in
// LAYER_PROPERTIES, all of which the compositor can animate without layout,
// so a transition and an effect playing at once never write the same
// property on the same element and simply compose.
//
// Times come from the resolved timeline (see timeline.ts): `delay` is the
// behavior's start in ms since the composition started, so an animation
// whose start time is the composition's start lands where the timeline
// says, and the editor scrubs by setting `currentTime`.

import {
  EFFECT_DEFAULTS,
  HOST_EFFECT_KINDS,
  HOST_TRANSITION_KINDS,
  type HostEffectKind,
  type HostTransitionKind,
  TRANSITION_DIRECTIONS,
  type TransitionDirection,
} from "./entity-types";
import type { BehaviorDocument, Easing } from "./types";

/** The wrapper a host animation plays on. */
export type HostLayer = "transition" | "effect";

/**
 * What each wrapper may animate. A transition fades and moves the box in or
 * out (`filter` only for `blur`); an effect moves or filters it while it is
 * shown. Opacity stays with transitions so an effect never fights an
 * entrance for it.
 */
export const LAYER_PROPERTIES: Readonly<Record<HostLayer, readonly AnimatedProperty[]>> = {
  transition: ["transform", "opacity", "filter"],
  effect: ["transform", "filter"],
};

export type AnimatedProperty = "transform" | "opacity" | "filter";

export interface AnimationKeyframe {
  offset?: number;
  transform?: string;
  opacity?: number;
  filter?: string;
}

/** Shaped like `KeyframeAnimationOptions`, so it passes to `animate` as is. */
export interface AnimationTiming {
  /** One iteration, in ms. */
  duration: number;
  easing: Easing;
  /** The behavior's start, in ms since the composition started. */
  delay: number;
  fill: "none" | "both";
  iterations: number;
}

export interface AnimationSpec {
  layer: HostLayer;
  keyframes: AnimationKeyframe[];
  timing: AnimationTiming;
}

/** Where a behavior runs on the resolved timeline; `endMs: null` runs until stopped. */
export interface AnimationWindow {
  startMs: number;
  endMs: number | null;
}

/** Whether the host plays `kind` for a behavior of `type` (else the widget does). */
export function isHostKind(type: string, kind: string): boolean {
  if (type === "transition") {
    return (HOST_TRANSITION_KINDS as readonly string[]).includes(kind);
  }
  if (type === "effect") {
    return (HOST_EFFECT_KINDS as readonly string[]).includes(kind);
  }
  return false;
}

/**
 * The animation the host plays for `behavior` over `window`, or `null` when
 * the host does not play it: a widget's own kind, or a type that is not
 * animated (an activity). Throws on a behavior the host plays whose params
 * are malformed, which validation should have refused.
 */
export function compileAnimation(behavior: BehaviorDocument, window: AnimationWindow): AnimationSpec | null {
  if (!isHostKind(behavior.type, behavior.kind)) {
    return null;
  }
  assertWindow(window);
  if (behavior.type === "transition") {
    return compileTransition(behavior, window);
  }
  return compileEffect(behavior, window);
}

// ---- transitions -----------------------------------------------------------

/** Where a `slide` starts entering from, or ends leaving to, by its own size. */
const SLIDE_OFFSET: Record<TransitionDirection, { enter: string; leave: string }> = {
  up: { enter: "translate(0, 100%)", leave: "translate(0, -100%)" },
  down: { enter: "translate(0, -100%)", leave: "translate(0, 100%)" },
  left: { enter: "translate(100%, 0)", leave: "translate(-100%, 0)" },
  right: { enter: "translate(-100%, 0)", leave: "translate(100%, 0)" },
};

const SHOWN = { opacity: 1, transform: "none" } as const;

function compileTransition(behavior: BehaviorDocument, window: AnimationWindow): AnimationSpec {
  const phase = behavior.params.phase;
  if (phase !== "in" && phase !== "out") {
    throw new Error(`animation: a transition's params.phase must be "in" or "out"`);
  }
  if (window.endMs === null) {
    throw new Error("animation: a transition must have an end");
  }
  const kind = behavior.kind as HostTransitionKind;
  const direction = slideDirection(behavior);
  return {
    layer: "transition",
    keyframes: transitionKeyframes(kind, phase, direction),
    timing: {
      duration: window.endMs - window.startMs,
      easing: behavior.timing.easing,
      delay: window.startMs,
      // Held on both sides: before an entrance starts the widget is already
      // hidden, and after an exit ends it stays hidden until it is removed.
      fill: "both",
      iterations: 1,
    },
  };
}

/**
 * Each kind is written as an entrance, from hidden to shown; an exit plays
 * it backwards, except a slide, which leaves the way it points rather than
 * the way it came.
 */
export function transitionKeyframes(
  kind: HostTransitionKind,
  phase: "in" | "out",
  direction: TransitionDirection = "up"
): AnimationKeyframe[] {
  const entrance = entranceKeyframes(kind, phase, direction);
  if (phase === "in") {
    return entrance;
  }
  return entrance
    .slice()
    .reverse()
    .map((frame) => (frame.offset === undefined ? frame : { ...frame, offset: 1 - frame.offset }));
}

function entranceKeyframes(
  kind: HostTransitionKind,
  phase: "in" | "out",
  direction: TransitionDirection
): AnimationKeyframe[] {
  // Every frame names every property the kind animates, so no engine has to
  // fill one in from the element's current style.
  switch (kind) {
    case "fade":
      return [
        { opacity: 0, transform: "none" },
        { opacity: 1, transform: "none" },
      ];
    case "slide": {
      const offset = SLIDE_OFFSET[direction];
      // Written as an entrance, so an exit's last frame is this list's first.
      return [{ opacity: 0, transform: phase === "in" ? offset.enter : offset.leave }, { ...SHOWN }];
    }
    case "zoom":
      return [{ opacity: 0, transform: "scale(0.5)" }, { ...SHOWN }];
    case "bounce":
      return [
        { opacity: 0, transform: "scale(0.3)" },
        { opacity: 1, transform: "scale(1.08)", offset: 0.5 },
        { opacity: 1, transform: "scale(0.94)", offset: 0.75 },
        { ...SHOWN },
      ];
    case "spin":
      return [{ opacity: 0, transform: "rotate(-360deg) scale(0)" }, { ...SHOWN }];
    case "pop":
      return [
        { opacity: 0, transform: "scale(0)" },
        { opacity: 1, transform: "scale(1.15)", offset: 0.7 },
        { ...SHOWN },
      ];
    case "blur":
      return [
        { opacity: 0, transform: "none", filter: "blur(16px)" },
        { ...SHOWN, filter: "none" },
      ];
    default:
      throw new Error(`animation: no keyframes for transition ${String(kind)}`);
  }
}

function slideDirection(behavior: BehaviorDocument): TransitionDirection {
  const direction = behavior.params.direction;
  if (direction === undefined) {
    return "up";
  }
  if (!(TRANSITION_DIRECTIONS as readonly unknown[]).includes(direction)) {
    throw new Error(`animation: params.direction must be one of ${TRANSITION_DIRECTIONS.join(", ")}`);
  }
  return direction as TransitionDirection;
}

// ---- effects ---------------------------------------------------------------

/** A hex colour only, since it is written into a CSS `filter` value. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function compileEffect(behavior: BehaviorDocument, window: AnimationWindow): AnimationSpec {
  const kind = behavior.kind as HostEffectKind;
  const length = window.endMs === null ? Number.POSITIVE_INFINITY : window.endMs - window.startMs;
  const { keyframes, periodMs } = effectCycle(kind, behavior.params);
  // A repeating effect plays cycles back to back over its window, the last
  // one cut short; one without a cycle is a single iteration as long as the
  // window. Either may be infinite, which Web Animations accepts.
  const duration = periodMs ?? length;
  const iterations = periodMs === null ? 1 : length / periodMs;
  return {
    layer: "effect",
    keyframes,
    timing: {
      duration,
      easing: behavior.timing.easing,
      delay: window.startMs,
      // An effect only applies within its window.
      fill: "none",
      iterations,
    },
  };
}

function effectCycle(
  kind: HostEffectKind,
  params: Record<string, unknown>
): { keyframes: AnimationKeyframe[]; periodMs: number | null } {
  switch (kind) {
    case "shake": {
      const distance = positiveParam(params, "distancePx", EFFECT_DEFAULTS.shake.distancePx);
      const at = (x: number, offset?: number): AnimationKeyframe =>
        offset === undefined ? { transform: `translateX(${x}px)` } : { transform: `translateX(${x}px)`, offset };
      return {
        keyframes: [at(0), at(-distance, 0.2), at(distance, 0.4), at(-distance, 0.6), at(distance, 0.8), at(0)],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.shake.periodMs),
      };
    }
    case "pulse": {
      const scale = positiveParam(params, "scale", EFFECT_DEFAULTS.pulse.scale);
      return {
        keyframes: [
          { transform: "scale(1)" },
          { transform: `scale(${scale})`, offset: 0.5 },
          { transform: "scale(1)" },
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.pulse.periodMs),
      };
    }
    case "glow": {
      const radius = positiveParam(params, "radiusPx", EFFECT_DEFAULTS.glow.radiusPx);
      const color = colorParam(params, "color", EFFECT_DEFAULTS.glow.color);
      return {
        keyframes: [
          { filter: `drop-shadow(0 0 0px ${color})` },
          { filter: `drop-shadow(0 0 ${radius}px ${color})`, offset: 0.5 },
          { filter: `drop-shadow(0 0 0px ${color})` },
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.glow.periodMs),
      };
    }
    case "float": {
      const distance = positiveParam(params, "distancePx", EFFECT_DEFAULTS.float.distancePx);
      return {
        keyframes: [
          { transform: "translateY(0px)" },
          { transform: `translateY(${-distance}px)`, offset: 0.5 },
          { transform: "translateY(0px)" },
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.float.periodMs),
      };
    }
    case "flash": {
      // Brightness rather than opacity: opacity belongs to the transition wrapper.
      const brightness = positiveParam(params, "brightness", EFFECT_DEFAULTS.flash.brightness);
      return {
        keyframes: [
          { filter: "brightness(1)" },
          { filter: `brightness(${brightness})`, offset: 0.5 },
          { filter: "brightness(1)" },
        ],
        periodMs: positiveParam(params, "periodMs", EFFECT_DEFAULTS.flash.periodMs),
      };
    }
    case "blur": {
      const radius = positiveParam(params, "radiusPx", EFFECT_DEFAULTS.blur.radiusPx);
      return {
        keyframes: [{ filter: `blur(${radius}px)` }, { filter: `blur(${radius}px)` }],
        periodMs: null,
      };
    }
    default:
      throw new Error(`animation: no keyframes for effect ${String(kind)}`);
  }
}

function positiveParam(params: Record<string, unknown>, name: string, fallback: number): number {
  const value = params[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`animation: params.${name} must be a positive number`);
  }
  return value;
}

function colorParam(params: Record<string, unknown>, name: string, fallback: string): string {
  const value = params[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new Error(`animation: params.${name} must be a hex colour`);
  }
  return value;
}

function assertWindow(window: AnimationWindow): void {
  if (!Number.isFinite(window.startMs)) {
    throw new Error("animation: window.startMs must be a finite number");
  }
  if (window.endMs !== null && !(Number.isFinite(window.endMs) && window.endMs >= window.startMs)) {
    throw new Error("animation: window.endMs must be a finite number no earlier than startMs");
  }
}
