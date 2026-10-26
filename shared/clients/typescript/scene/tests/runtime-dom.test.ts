import { describe, expect, test } from "bun:test";
import { type AnimationKeyframe, type AnimationTiming, LAYER_PROPERTIES } from "../model";
import {
  createDomRenderer,
  type DelegatedBehavior,
  type DelegateRequest,
  type HideWith,
  type PatchOp,
  type RenderAnimation,
  type RenderDocument,
  type RenderElement,
  type RenderStyle,
} from "../runtime";

// The real DOM must satisfy the slices the renderer is written against.
export function realDomFits(doc: Document, root: HTMLElement): void {
  const renderer = createDomRenderer<HTMLElement>({ document: doc, root, mountContent: () => () => {} });
  const box: HTMLElement | undefined = renderer.boxOf("w1");
  const element: RenderElement<HTMLElement> = root;
  const animation: RenderAnimation = root.animate([], {});
  void box;
  void element;
  void animation;
}

class FakeAnimation implements RenderAnimation {
  startTime: number | null = null;
  currentTime: number | null = null;
  paused = false;
  cancelled = false;

  constructor(
    readonly element: FakeElement,
    readonly keyframes: Keyframe[],
    readonly options: KeyframeAnimationOptions
  ) {}

  pause(): void {
    this.paused = true;
  }

  cancel(): void {
    this.cancelled = true;
  }
}

/** Every style write the renderer makes, in order, across every element. */
type StyleWrite = { element: FakeElement; property: keyof RenderStyle; value: string };

class FakeElement implements RenderElement<FakeElement> {
  readonly style: RenderStyle;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly animations: FakeAnimation[] = [];
  parent: FakeElement | null = null;

  constructor(
    readonly tag: string,
    writes: StyleWrite[]
  ) {
    const values: Partial<RenderStyle> = {};
    this.style = new Proxy(values as RenderStyle, {
      set: (target, property, value) => {
        writes.push({ element: this, property: property as keyof RenderStyle, value });
        (target as unknown as Record<string | symbol, unknown>)[property] = value;
        return true;
      },
    });
  }

  appendChild(child: FakeElement): unknown {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parent !== null) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): FakeAnimation {
    const animation = new FakeAnimation(this, keyframes, options);
    this.animations.push(animation);
    return animation;
  }
}

class FakeDocument implements RenderDocument<FakeElement> {
  readonly writes: StyleWrite[] = [];
  readonly timeline = { currentTime: 10_000 as number | null };

  createElement(tag: "div"): FakeElement {
    return new FakeElement(tag, this.writes);
  }
}

const FADE: AnimationKeyframe[] & Keyframe[] = [
  { opacity: 0, transform: "none" },
  { opacity: 1, transform: "none" },
];

function timingAt(delay: number): AnimationTiming {
  return { duration: 500, easing: "ease-out", delay, fill: "both", iterations: 1 };
}

function setup(atMs = 0, hideWith?: HideWith) {
  const doc = new FakeDocument();
  const root = doc.createElement("div");
  const mounted: Array<{ id: string; widget: string; slot: FakeElement }> = [];
  const unmounted: string[] = [];
  const delegations: Array<[string, DelegateRequest]> = [];
  const renderer = createDomRenderer<FakeElement>({
    document: doc,
    root,
    atMs,
    mountContent: (slot, id, widget) => {
      mounted.push({ id, widget, slot });
      slot.appendChild(doc.createElement("div"));
      return () => unmounted.push(id);
    },
    onDelegate: (id, request) => delegations.push([id, request]),
    ...(hideWith === undefined ? {} : { hideWith }),
  });
  return { doc, root, renderer, mounted, unmounted, delegations };
}

const MOUNT: PatchOp = {
  op: "mount",
  id: "w1",
  widget: "woofx3:widget:text",
  box: { x: 10, y: 20, width: 300, height: 200, rotation: 45, opacity: 0.5 },
  z: 3,
  visible: true,
};

function boxOf(renderer: ReturnType<typeof setup>["renderer"], id: string): FakeElement {
  const box = renderer.boxOf(id);
  if (box === undefined) {
    throw new Error(`no box for ${id}`);
  }
  return box;
}

describe("createDomRenderer structure", () => {
  test("wraps the widgets in a canvas root: transition > effect > widget layer", () => {
    const { root } = setup();
    expect(root.children).toHaveLength(1);
    const transition = root.children[0];
    expect(transition.attributes.get("data-scene-layer")).toBe("canvas-transition");
    const effect = transition.children[0];
    expect(effect.attributes.get("data-scene-layer")).toBe("canvas-effect");
    expect(effect.children[0].attributes.get("data-scene-layer")).toBe("widgets");
  });

  test("mounts a widget as box > transition > effect > slot, with content from the caller", () => {
    const { root, renderer, mounted } = setup();
    renderer.apply([MOUNT]);
    const layer = root.children[0].children[0].children[0];
    const box = boxOf(renderer, "w1");
    expect(layer.children).toEqual([box]);
    expect(box.attributes.get("data-scene-widget")).toBe("w1");
    const transition = box.children[0];
    const effect = transition.children[0];
    const slot = effect.children[0];
    expect(mounted).toEqual([{ id: "w1", widget: "woofx3:widget:text", slot }]);
    // The box is in the page before its content is mounted.
    expect(box.parent).toBe(layer);
  });

  test("positions the box with a transform, never left/top offsets, rotated about its centre", () => {
    const { renderer } = setup();
    renderer.apply([MOUNT]);
    const style = boxOf(renderer, "w1").style;
    expect(style.transform).toBe("translate(10px, 20px) rotate(45deg)");
    expect(style.left).toBe("0");
    expect(style.top).toBe("0");
    expect(style.transformOrigin).toBe("50% 50%");
    expect(style.width).toBe("300px");
    expect(style.height).toBe("200px");
    expect(style.opacity).toBe("0.5");
    expect(style.zIndex).toBe("3");
    expect(style.visibility).toBe("");
  });

  test("a widget mounted hidden keeps its content, out of sight", () => {
    const { renderer, mounted } = setup();
    renderer.apply([{ ...MOUNT, visible: false } as PatchOp]);
    expect(boxOf(renderer, "w1").style.visibility).toBe("hidden");
    expect(mounted).toHaveLength(1);
  });

  test("unmount tears the content down, cancels its animations and removes the box", () => {
    const { renderer, unmounted } = setup();
    renderer.apply([
      MOUNT,
      {
        op: "startAnimation",
        id: "w1",
        layer: "transition",
        behavior: "in",
        spec: { layer: "transition", keyframes: FADE, timing: timingAt(0) },
      },
    ]);
    const box = boxOf(renderer, "w1");
    const animation = box.children[0].animations[0];
    renderer.apply([{ op: "unmount", id: "w1" }]);
    expect(unmounted).toEqual(["w1"]);
    expect(animation.cancelled).toBe(true);
    expect(box.parent).toBeNull();
    expect(renderer.boxOf("w1")).toBeUndefined();
  });

  test("refuses ops for a widget that is not mounted, and a double mount", () => {
    const { renderer } = setup();
    expect(() => renderer.apply([{ op: "setVisible", id: "nope", visible: true }])).toThrow(/not mounted/);
    renderer.apply([MOUNT]);
    expect(() => renderer.apply([MOUNT])).toThrow(/already mounted/);
  });

  test("dispose unmounts every widget and removes the canvas root", () => {
    const { root, renderer, unmounted } = setup();
    renderer.apply([MOUNT, { ...MOUNT, id: "w2" } as PatchOp]);
    renderer.dispose();
    expect(unmounted.sort()).toEqual(["w1", "w2"]);
    expect(root.children).toEqual([]);
  });
});

describe("createDomRenderer writes", () => {
  test("stacking and visibility patches write one property each", () => {
    const { doc, renderer } = setup();
    renderer.apply([MOUNT]);
    const box = boxOf(renderer, "w1");
    doc.writes.length = 0;
    renderer.apply([{ op: "setStack", id: "w1", z: 7 }]);
    expect(doc.writes.map((write) => [write.element === box, write.property, write.value])).toEqual([
      [true, "zIndex", "7"],
    ]);
    doc.writes.length = 0;
    renderer.apply([{ op: "setVisible", id: "w1", visible: false }]);
    expect(doc.writes.map((write) => [write.property, write.value])).toEqual([["visibility", "hidden"]]);
  });

  test("hidden with opacity, a widget keeps its visibility and is shown at its own opacity", () => {
    const { doc, renderer } = setup(0, "opacity");
    renderer.apply([{ ...MOUNT, visible: false } as PatchOp]);
    expect(boxOf(renderer, "w1").style.opacity).toBe("0");
    expect(doc.writes.filter((write) => write.property === "visibility")).toEqual([]);
    doc.writes.length = 0;
    renderer.apply([{ op: "setVisible", id: "w1", visible: true }]);
    expect(doc.writes.map((write) => [write.property, write.value])).toEqual([["opacity", "0.5"]]);
  });

  test("hidden with opacity, a box patch to a hidden widget's opacity keeps it hidden until shown", () => {
    const { renderer } = setup(0, "opacity");
    renderer.apply([{ ...MOUNT, visible: false } as PatchOp]);
    const box = MOUNT.op === "mount" ? MOUNT.box : null;
    renderer.apply([{ op: "setBox", id: "w1", box: { ...(box as NonNullable<typeof box>), opacity: 0.8 } }]);
    expect(boxOf(renderer, "w1").style.opacity).toBe("0");
    renderer.apply([{ op: "setVisible", id: "w1", visible: true }]);
    expect(boxOf(renderer, "w1").style.opacity).toBe("0.8");
  });

  test("a box patch writes only the properties that changed", () => {
    const { doc, renderer } = setup();
    renderer.apply([MOUNT]);
    doc.writes.length = 0;
    const box = MOUNT.op === "mount" ? MOUNT.box : null;
    renderer.apply([{ op: "setBox", id: "w1", box: { ...(box as NonNullable<typeof box>), x: 11 } }]);
    expect(doc.writes.map((write) => [write.property, write.value])).toEqual([
      ["transform", "translate(11px, 20px) rotate(45deg)"],
    ]);
    doc.writes.length = 0;
    renderer.apply([{ op: "setBox", id: "w1", box: { ...(box as NonNullable<typeof box>), x: 11, width: 50 } }]);
    expect(doc.writes.map((write) => write.property)).toEqual(["width"]);
  });

  test("animations play on their wrapper and write only compositor properties, never box style", () => {
    const { doc, renderer } = setup();
    renderer.apply([MOUNT]);
    doc.writes.length = 0;
    renderer.apply([
      {
        op: "startAnimation",
        id: "w1",
        layer: "transition",
        behavior: "in",
        spec: { layer: "transition", keyframes: FADE, timing: timingAt(200) },
      },
      {
        op: "startAnimation",
        id: "w1",
        layer: "effect",
        behavior: "shake",
        spec: {
          layer: "effect",
          keyframes: [{ transform: "translateX(0px)" }, { transform: "translateX(5px)" }],
          timing: { ...timingAt(0), fill: "none" },
        },
      },
    ]);
    expect(doc.writes).toEqual([]);
    const box = boxOf(renderer, "w1");
    const transition = box.children[0];
    const effect = transition.children[0];
    expect(box.animations).toEqual([]);
    expect(transition.animations.map((animation) => animation.keyframes)).toEqual([FADE]);
    expect(effect.animations).toHaveLength(1);
    for (const [wrapper, layer] of [
      [transition, "transition"],
      [effect, "effect"],
    ] as const) {
      for (const animation of wrapper.animations) {
        for (const frame of animation.keyframes) {
          for (const property of Object.keys(frame).filter((key) => key !== "offset")) {
            expect(LAYER_PROPERTIES[layer] as readonly string[]).toContain(property);
          }
        }
      }
    }
    expect(transition.animations[0].options.delay).toBe(200);
  });

  test("canvas animations play on the canvas root's wrappers", () => {
    const { root, renderer } = setup();
    renderer.apply([
      {
        op: "startAnimation",
        id: null,
        layer: "transition",
        behavior: "stage",
        spec: { layer: "transition", keyframes: FADE, timing: timingAt(0) },
      },
    ]);
    expect(root.children[0].animations).toHaveLength(1);
    renderer.apply([{ op: "cancelAnimation", id: null, layer: "transition", behavior: "stage" }]);
    expect(root.children[0].animations[0].cancelled).toBe(true);
  });

  test("refuses to start an animation twice or cancel one that is not playing", () => {
    const { renderer } = setup();
    renderer.apply([MOUNT]);
    const start: PatchOp = {
      op: "startAnimation",
      id: "w1",
      layer: "transition",
      behavior: "in",
      spec: { layer: "transition", keyframes: FADE, timing: timingAt(0) },
    };
    renderer.apply([start]);
    expect(() => renderer.apply([start])).toThrow(/already animating/);
    expect(() => renderer.apply([{ op: "cancelAnimation", id: "w1", layer: "effect", behavior: "in" }])).toThrow(
      /no animation/
    );
  });

  test("delegations go to the caller", () => {
    const { renderer, delegations } = setup();
    renderer.apply([MOUNT]);
    const entry: DelegatedBehavior = {
      behavior: "tw",
      type: "transition",
      kind: "typewriter",
      phase: "in",
      startMs: 0,
      endMs: 500,
      easing: "linear",
      params: {},
    };
    renderer.apply([
      { op: "delegate", id: "w1", delegated: entry },
      { op: "cancelDelegate", id: "w1", behavior: "tw" },
    ]);
    expect(delegations).toEqual([
      ["w1", { kind: "start", delegated: entry }],
      ["w1", { kind: "cancel", behavior: "tw" }],
    ]);
  });
});

describe("createDomRenderer clock", () => {
  function animated(atMs = 0) {
    const context = setup(atMs);
    context.renderer.apply([
      MOUNT,
      {
        op: "startAnimation",
        id: "w1",
        layer: "transition",
        behavior: "in",
        spec: { layer: "transition", keyframes: FADE, timing: timingAt(0) },
      },
      {
        op: "startAnimation",
        id: null,
        layer: "effect",
        behavior: "pulse",
        spec: {
          layer: "effect",
          keyframes: [{ transform: "scale(1)" }, { transform: "scale(2)" }],
          timing: timingAt(0),
        },
      },
    ]);
    const widgetAnimation = boxOf(context.renderer, "w1").children[0].animations[0];
    const canvasAnimation = context.root.children[0].children[0].animations[0];
    return { ...context, animations: [widgetAnimation, canvasAnimation] };
  }

  test("every animation starts on the shared origin: the timeline time of composition 0", () => {
    const { animations } = animated(1_500);
    for (const animation of animations) {
      expect(animation.startTime).toBe(10_000 - 1_500);
      expect(animation.paused).toBe(false);
    }
  });

  test("seek sets currentTime on every live animation", () => {
    const { renderer, animations } = animated();
    renderer.seek(2_345);
    for (const animation of animations) {
      expect(animation.currentTime).toBe(2_345);
    }
    expect(renderer.timeMs()).toBe(2_345);
    expect(() => renderer.seek(Number.NaN)).toThrow(/finite/);
  });

  test("pause holds the composition time, and animations started while paused join it", () => {
    const { doc, renderer, animations } = animated();
    doc.timeline.currentTime = 10_800;
    renderer.pause();
    for (const animation of animations) {
      expect(animation.paused).toBe(true);
      expect(animation.currentTime).toBe(800);
    }
    doc.timeline.currentTime = 20_000;
    expect(renderer.timeMs()).toBe(800);
    renderer.seek(300);
    renderer.apply([
      {
        op: "startAnimation",
        id: "w1",
        layer: "effect",
        behavior: "late",
        spec: { layer: "effect", keyframes: [{ transform: "none" }, { transform: "none" }], timing: timingAt(0) },
      },
    ]);
    const late = boxOf(renderer, "w1").children[0].children[0].animations[0];
    expect(late.paused).toBe(true);
    expect(late.currentTime).toBe(300);
  });

  test("play resumes from the held time on a new origin", () => {
    const { doc, renderer, animations } = animated();
    renderer.pause();
    renderer.seek(400);
    doc.timeline.currentTime = 50_000;
    renderer.play();
    for (const animation of animations) {
      expect(animation.startTime).toBe(49_600);
    }
    doc.timeline.currentTime = 50_100;
    expect(renderer.timeMs()).toBe(500);
  });

  test("refuses to run on a stopped document timeline", () => {
    const doc = new FakeDocument();
    doc.timeline.currentTime = null;
    expect(() =>
      createDomRenderer<FakeElement>({ document: doc, root: doc.createElement("div"), mountContent: () => () => {} })
    ).toThrow(/timeline/);
  });
});
