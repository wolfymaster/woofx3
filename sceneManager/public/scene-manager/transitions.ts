// Plays a placement's transitions on the page (see
// docs/services/widget-transitions.md).
//
// A generic type is played here, on the placement's box (its frame, or an
// alert widget's area), with the Web Animations API, so it works for every
// widget without the widget knowing. A type the widget declares for itself is
// handed to the frame, whose shim marks the frame's root element for the
// widget's CSS; the page only waits out its duration. Either way a leaving
// placement is hidden only once its out-transition has finished.

import {
  type PlacementTransition,
  type TransitionDirection,
  type TransitionPhase,
  type WidgetTransitionState,
  isGenericTransitionType,
  transitionEasing,
  widgetTransitionState,
} from "@woofx3/module-sdk";

/** The frame a placement's own transitions are handed to; null for an alert area. */
export interface TransitionFrame {
  sendTransition(state: WidgetTransitionState | null): void;
}

/** The slice of an element the animator touches (injectable for tests). */
export interface AnimatedElement {
  style: { visibility: string };
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): AnimationLike;
}

/** The slice of an `Animation` the animator uses. */
export interface AnimationLike {
  readonly finished: Promise<unknown>;
  cancel(): void;
}

export interface TransitionTarget {
  element: AnimatedElement;
  frame: TransitionFrame | null;
}

/** Where a `slide` starts entering from, or ends leaving to, by its own size. */
const SLIDE_OFFSET: Record<TransitionDirection, { enter: string; leave: string }> = {
  up: { enter: "translate(0, 100%)", leave: "translate(0, -100%)" },
  down: { enter: "translate(0, -100%)", leave: "translate(0, 100%)" },
  left: { enter: "translate(100%, 0)", leave: "translate(-100%, 0)" },
  right: { enter: "translate(-100%, 0)", leave: "translate(100%, 0)" },
};

const SHOWN: Keyframe = { opacity: 1, transform: "none", filter: "none" };

/**
 * The keyframes of a generic transition. Each is written as an entrance,
 * from hidden to shown; a leave plays it backwards, except a slide, which
 * leaves the way it points rather than the way it came.
 */
export function genericKeyframes(transition: PlacementTransition, phase: TransitionPhase): Keyframe[] {
  // Every frame names every property, so no engine has to fill one in.
  const entrance = entranceKeyframes(transition, phase).map((frame) => ({ ...SHOWN, ...frame }));
  if (phase === "in") {
    return entrance;
  }
  return entrance
    .slice()
    .reverse()
    .map((frame) =>
      frame.offset === undefined || frame.offset === null ? frame : { ...frame, offset: 1 - frame.offset }
    );
}

function entranceKeyframes(transition: PlacementTransition, phase: TransitionPhase): Keyframe[] {
  switch (transition.type) {
    case "fade":
      return [{ opacity: 0 }, { opacity: 1 }];
    case "slide": {
      const offset = SLIDE_OFFSET[transition.direction ?? "up"];
      // Written as an entrance, so a leave's end is this list's start.
      const from = phase === "in" ? offset.enter : offset.leave;
      return [{ opacity: 0, transform: from }, SHOWN];
    }
    case "zoom":
      return [{ opacity: 0, transform: "scale(0.5)" }, SHOWN];
    case "bounce":
      return [
        { opacity: 0, transform: "scale(0.3)" },
        { opacity: 1, transform: "scale(1.08)", offset: 0.5 },
        { transform: "scale(0.94)", offset: 0.75 },
        SHOWN,
      ];
    case "spin":
      return [{ opacity: 0, transform: "rotate(-360deg) scale(0)" }, SHOWN];
    case "pop":
      return [{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1.15)", offset: 0.7 }, SHOWN];
    case "blur":
      return [{ opacity: 0, filter: "blur(16px)" }, SHOWN];
    default:
      return [{ opacity: 1 }, { opacity: 1 }];
  }
}

/**
 * Shows and hides placements, playing their transitions. One animator serves
 * a page; it remembers what is playing on each element, so a placement shown
 * while it is leaving comes straight back instead of disappearing once the
 * leave finishes.
 */
export class TransitionAnimator {
  private readonly playing = new WeakMap<AnimatedElement, { generation: number; animation: AnimationLike | null }>();
  private nextGeneration = 0;

  /** Show the placement, entering with `transition` when it has one. */
  enter(target: TransitionTarget, transition: PlacementTransition | undefined): void {
    this.settle(target.element);
    target.element.style.visibility = "";
    if (!transition) {
      target.frame?.sendTransition(null);
      return;
    }
    if (!isGenericTransitionType(transition.type)) {
      target.frame?.sendTransition(widgetTransitionState(transition, "in"));
      return;
    }
    target.frame?.sendTransition(null);
    const animation = target.element.animate(genericKeyframes(transition, "in"), {
      duration: transition.durationMs,
      easing: transitionEasing(transition, "in"),
      fill: "both",
    });
    const generation = this.track(target.element, animation);
    animation.finished.then(
      () => {
        if (this.isCurrent(target.element, generation)) {
          animation.cancel();
          this.playing.delete(target.element);
        }
      },
      () => {}
    );
  }

  /**
   * Hide the placement, leaving with `transition` when it has one. Resolves
   * once it is hidden, or once a later `enter` or `leave` has taken over.
   */
  leave(target: TransitionTarget, transition: PlacementTransition | undefined): Promise<void> {
    this.settle(target.element);
    if (!transition) {
      target.element.style.visibility = "hidden";
      return Promise.resolve();
    }
    if (!isGenericTransitionType(transition.type)) {
      target.frame?.sendTransition(widgetTransitionState(transition, "out"));
      const generation = this.track(target.element, null);
      return new Promise((resolve) => {
        setTimeout(() => {
          if (this.isCurrent(target.element, generation)) {
            target.element.style.visibility = "hidden";
            this.playing.delete(target.element);
          }
          resolve();
        }, transition.durationMs);
      });
    }
    const animation = target.element.animate(genericKeyframes(transition, "out"), {
      duration: transition.durationMs,
      easing: transitionEasing(transition, "out"),
      fill: "both",
    });
    const generation = this.track(target.element, animation);
    return animation.finished.then(
      () => {
        if (this.isCurrent(target.element, generation)) {
          target.element.style.visibility = "hidden";
          animation.cancel();
          this.playing.delete(target.element);
        }
      },
      () => {}
    );
  }

  /** Hide or show the placement at once, ending anything playing on it. */
  set(element: AnimatedElement, visible: boolean): void {
    this.settle(element);
    element.style.visibility = visible ? "" : "hidden";
  }

  private track(element: AnimatedElement, animation: AnimationLike | null): number {
    this.nextGeneration += 1;
    this.playing.set(element, { generation: this.nextGeneration, animation });
    return this.nextGeneration;
  }

  private isCurrent(element: AnimatedElement, generation: number): boolean {
    return this.playing.get(element)?.generation === generation;
  }

  private settle(element: AnimatedElement): void {
    this.playing.get(element)?.animation?.cancel();
    this.playing.delete(element);
  }
}
