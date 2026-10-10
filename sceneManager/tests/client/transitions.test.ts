import { describe, expect, it } from "bun:test";
import type { WidgetTransitionState } from "@woofx3/module-sdk";
import {
  type AnimatedElement,
  type AnimationLike,
  TransitionAnimator,
  genericKeyframes,
} from "../../public/scene-manager/transitions";

/** An element whose animations finish when the test says so. */
function fakeElement() {
  const animations: Array<{
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    finish(): void;
    cancelled: boolean;
  }> = [];
  const element: AnimatedElement = {
    style: { visibility: "" },
    animate(keyframes, options): AnimationLike {
      let finish = (): void => {};
      let fail = (_: unknown): void => {};
      const finished = new Promise<unknown>((resolve, reject) => {
        finish = () => resolve(undefined);
        fail = reject;
      });
      const record = { keyframes, options, finish, cancelled: false };
      animations.push(record);
      return {
        finished,
        cancel() {
          if (!record.cancelled) {
            record.cancelled = true;
            fail(new Error("cancelled"));
          }
        },
      };
    },
  };
  return { element, animations };
}

function fakeFrame() {
  const sent: Array<WidgetTransitionState | null> = [];
  return { sent, sendTransition: (state: WidgetTransitionState | null) => void sent.push(state) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("genericKeyframes", () => {
  it("enters from hidden to shown and leaves the reverse way", () => {
    const fade = { type: "fade", durationMs: 300 };
    expect(genericKeyframes(fade, "in").map((f) => f.opacity)).toEqual([0, 1]);
    expect(genericKeyframes(fade, "out").map((f) => f.opacity)).toEqual([1, 0]);
  });

  it("slides in from the far side and out the way it points", () => {
    const slide = { type: "slide", durationMs: 300, direction: "left" as const };
    expect(genericKeyframes(slide, "in")[0]!.transform).toBe("translate(100%, 0)");
    expect(genericKeyframes(slide, "out").at(-1)!.transform).toBe("translate(-100%, 0)");
  });

  it("mirrors the offsets of a multi-step leave", () => {
    const offsets = genericKeyframes({ type: "bounce", durationMs: 300 }, "out").map((f) => f.offset);
    expect(offsets).toEqual([undefined, 0.25, 0.5, undefined]);
  });

  it("names every animated property in every frame", () => {
    for (const type of ["fade", "slide", "zoom", "bounce", "spin", "pop", "blur"]) {
      for (const frame of genericKeyframes({ type, durationMs: 300 }, "in")) {
        expect(Object.keys(frame)).toEqual(expect.arrayContaining(["opacity", "transform", "filter"]));
      }
    }
  });
});

describe("TransitionAnimator", () => {
  it("hides a leaving placement only once its animation finishes", async () => {
    const { element, animations } = fakeElement();
    const animator = new TransitionAnimator();
    const left = animator.leave({ element, frame: null }, { type: "zoom", durationMs: 300 });
    expect(element.style.visibility).toBe("");
    expect(animations[0]!.options).toMatchObject({ duration: 300, easing: "ease-in", fill: "both" });
    animations[0]!.finish();
    await left;
    expect(element.style.visibility).toBe("hidden");
  });

  it("keeps a placement shown when it is shown again while leaving", async () => {
    const { element, animations } = fakeElement();
    const animator = new TransitionAnimator();
    const left = animator.leave({ element, frame: null }, { type: "fade", durationMs: 300 });
    animator.enter({ element, frame: null }, undefined);
    await left;
    expect(animations[0]!.cancelled).toBe(true);
    expect(element.style.visibility).toBe("");
  });

  it("shows and hides at once without a transition", async () => {
    const { element, animations } = fakeElement();
    const animator = new TransitionAnimator();
    await animator.leave({ element, frame: null }, undefined);
    expect(element.style.visibility).toBe("hidden");
    animator.enter({ element, frame: null }, undefined);
    expect(element.style.visibility).toBe("");
    expect(animations).toEqual([]);
  });

  it("ends an entrance by handing the element back to its own styles", async () => {
    const { element, animations } = fakeElement();
    new TransitionAnimator().enter({ element, frame: null }, { type: "pop", durationMs: 300 });
    animations[0]!.finish();
    await tick();
    expect(animations[0]!.cancelled).toBe(true);
  });

  it("hands one of the widget's own transitions to its frame and waits out the leave", async () => {
    const { element, animations } = fakeElement();
    const frame = fakeFrame();
    const animator = new TransitionAnimator();
    animator.enter({ element, frame }, { type: "typewriter", durationMs: 20 });
    expect(frame.sent).toEqual([{ phase: "in", type: "typewriter", durationMs: 20, easing: "ease-out" }]);

    const left = animator.leave({ element, frame }, { type: "typewriter", durationMs: 20 });
    expect(frame.sent.at(-1)).toMatchObject({ phase: "out" });
    expect(element.style.visibility).toBe("");
    await left;
    expect(element.style.visibility).toBe("hidden");
    expect(animations).toEqual([]);
  });

  it("clears a widget's own transition before playing a generic one", () => {
    const { element } = fakeElement();
    const frame = fakeFrame();
    new TransitionAnimator().enter({ element, frame }, { type: "fade", durationMs: 300 });
    expect(frame.sent).toEqual([null]);
  });
});
