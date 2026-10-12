import { describe, expect, test } from "bun:test";
import type { AnimationSpec } from "../model";
import { type DelegatedBehavior, diffPlans, type PlannedAnimation, type RenderPlan, type WidgetPlan } from "../runtime";

function spec(delay: number, layer: "transition" | "effect" = "transition"): AnimationSpec {
  return {
    layer,
    keyframes: [
      { opacity: 0, transform: "none" },
      { opacity: 1, transform: "none" },
    ],
    timing: { duration: 500, easing: "ease-out", delay, fill: "both", iterations: 1 },
  };
}

function animation(behavior: string, delay = 0, layer: "transition" | "effect" = "transition"): PlannedAnimation {
  return { behavior, spec: spec(delay, layer) };
}

function delegated(behavior: string, startMs = 0): DelegatedBehavior {
  return {
    behavior,
    type: "transition",
    kind: "typewriter",
    phase: "in",
    startMs,
    endMs: startMs + 500,
    easing: "linear",
    params: { phase: "in" },
  };
}

function widget(id: string, overrides: Partial<WidgetPlan> = {}): WidgetPlan {
  return {
    id,
    widget: "woofx3:widget:text",
    box: { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1 },
    z: 0,
    visible: true,
    animations: { transition: [], effect: [] },
    delegated: [],
    ...overrides,
  };
}

function plan(widgets: WidgetPlan[], canvas: PlannedAnimation[] = []): RenderPlan {
  return {
    atMs: 0,
    widgets: Object.fromEntries(widgets.map((entry) => [entry.id, entry])),
    canvas: { animations: { transition: canvas, effect: [] } },
    nextChangeMs: null,
    skipped: [],
  };
}

describe("diffPlans from nothing", () => {
  test("mounts every widget with its box, rank and visibility, then starts its animations", () => {
    const next = plan(
      [
        widget("w1", {
          z: 1,
          visible: false,
          animations: { transition: [animation("in")], effect: [animation("shake", 0, "effect")] },
          delegated: [delegated("tw")],
        }),
      ],
      [animation("stage")]
    );
    expect(diffPlans(null, next)).toEqual([
      { op: "mount", id: "w1", widget: "woofx3:widget:text", box: next.widgets.w1.box, z: 1, visible: false },
      { op: "startAnimation", id: "w1", layer: "transition", behavior: "in", spec: spec(0) },
      { op: "startAnimation", id: "w1", layer: "effect", behavior: "shake", spec: spec(0, "effect") },
      { op: "startAnimation", id: null, layer: "transition", behavior: "stage", spec: spec(0) },
      { op: "delegate", id: "w1", delegated: delegated("tw") },
    ]);
  });
});

describe("diffPlans between plans", () => {
  const base = () =>
    plan([
      widget("w1", { z: 0, animations: { transition: [animation("a"), animation("b"), animation("c")], effect: [] } }),
      widget("w2", { z: 1, delegated: [delegated("tw")] }),
    ]);

  test("writes nothing when nothing changed", () => {
    expect(diffPlans(base(), base())).toEqual([]);
  });

  test("a moved widget gets one box write", () => {
    const next = base();
    next.widgets.w1.box = { ...next.widgets.w1.box, x: 50, rotation: 10 };
    expect(diffPlans(base(), next)).toEqual([{ op: "setBox", id: "w1", box: next.widgets.w1.box }]);
  });

  test("each box field counts", () => {
    for (const field of ["x", "y", "width", "height", "rotation", "opacity"] as const) {
      const next = base();
      next.widgets.w2.box = { ...next.widgets.w2.box, [field]: 0.25 };
      expect(diffPlans(base(), next)).toEqual([{ op: "setBox", id: "w2", box: next.widgets.w2.box }]);
    }
  });

  test("swapping two layers restacks only those two", () => {
    const prev = plan([widget("a", { z: 0 }), widget("b", { z: 1 }), widget("c", { z: 2 })]);
    const next = plan([widget("a", { z: 1 }), widget("b", { z: 0 }), widget("c", { z: 2 })]);
    expect(diffPlans(prev, next)).toEqual([
      { op: "setStack", id: "a", z: 1 },
      { op: "setStack", id: "b", z: 0 },
    ]);
  });

  test("showing a widget writes only its visibility", () => {
    const prev = base();
    prev.widgets.w2.visible = false;
    expect(diffPlans(prev, base())).toEqual([{ op: "setVisible", id: "w2", visible: true }]);
  });

  test("a removed widget is unmounted, its animations and delegations with it", () => {
    const next = plan([widget("w2", { z: 0, delegated: [delegated("tw")] })]);
    expect(diffPlans(base(), next)).toEqual([
      { op: "unmount", id: "w1" },
      { op: "setStack", id: "w2", z: 0 },
    ]);
  });

  test("a widget of another type is remounted, and its animations start again", () => {
    const next = base();
    next.widgets.w1.widget = "woofx3:widget:image";
    expect(diffPlans(base(), next)).toEqual([
      { op: "unmount", id: "w1" },
      { op: "mount", id: "w1", widget: "woofx3:widget:image", box: next.widgets.w1.box, z: 0, visible: true },
      { op: "startAnimation", id: "w1", layer: "transition", behavior: "a", spec: spec(0) },
      { op: "startAnimation", id: "w1", layer: "transition", behavior: "b", spec: spec(0) },
      { op: "startAnimation", id: "w1", layer: "transition", behavior: "c", spec: spec(0) },
    ]);
  });

  test("an animation added on top starts alone", () => {
    const next = base();
    next.widgets.w1.animations.transition.push(animation("d", 900));
    expect(diffPlans(base(), next)).toEqual([
      { op: "startAnimation", id: "w1", layer: "transition", behavior: "d", spec: spec(900) },
    ]);
  });

  test("a changed animation restarts with those composed above it, cancels first", () => {
    const next = base();
    next.widgets.w1.animations.transition[1] = animation("b", 700);
    expect(diffPlans(base(), next)).toEqual([
      { op: "cancelAnimation", id: "w1", layer: "transition", behavior: "b" },
      { op: "cancelAnimation", id: "w1", layer: "transition", behavior: "c" },
      { op: "startAnimation", id: "w1", layer: "transition", behavior: "b", spec: spec(700) },
      { op: "startAnimation", id: "w1", layer: "transition", behavior: "c", spec: spec(0) },
    ]);
  });

  test("a removed top animation is cancelled alone", () => {
    const next = base();
    next.widgets.w1.animations.transition.pop();
    expect(diffPlans(base(), next)).toEqual([{ op: "cancelAnimation", id: "w1", layer: "transition", behavior: "c" }]);
  });

  test("infinite timings compare equal to themselves", () => {
    const endless = (): PlannedAnimation => ({
      behavior: "glow",
      spec: { ...spec(0, "effect"), timing: { ...spec(0, "effect").timing, iterations: Number.POSITIVE_INFINITY } },
    });
    const prev = plan([widget("w1", { animations: { transition: [], effect: [endless()] } })]);
    const next = plan([widget("w1", { animations: { transition: [], effect: [endless()] } })]);
    expect(diffPlans(prev, next)).toEqual([]);
    next.widgets.w1.animations.effect[0].spec.timing.iterations = 3;
    expect(diffPlans(prev, next).map((op) => op.op)).toEqual(["cancelAnimation", "startAnimation"]);
  });

  test("canvas animations diff on the canvas root", () => {
    const prev = plan([], [animation("stage")]);
    const next = plan([], [animation("stage", 100)]);
    expect(diffPlans(prev, next)).toEqual([
      { op: "cancelAnimation", id: null, layer: "transition", behavior: "stage" },
      { op: "startAnimation", id: null, layer: "transition", behavior: "stage", spec: spec(100) },
    ]);
  });

  test("delegations are sent once, again when they change, and withdrawn when gone", () => {
    const added = base();
    added.widgets.w2.delegated.push(delegated("tw2", 300));
    expect(diffPlans(base(), added)).toEqual([{ op: "delegate", id: "w2", delegated: delegated("tw2", 300) }]);

    const changed = base();
    changed.widgets.w2.delegated = [{ ...delegated("tw"), endMs: 9_000 }];
    expect(diffPlans(base(), changed)).toEqual([
      { op: "delegate", id: "w2", delegated: changed.widgets.w2.delegated[0] },
    ]);

    const gone = base();
    gone.widgets.w2.delegated = [];
    expect(diffPlans(base(), gone)).toEqual([{ op: "cancelDelegate", id: "w2", behavior: "tw" }]);
  });

  test("orders removals, mounts, writes, cancels, starts, then delegations", () => {
    const prev = plan([
      widget("old"),
      widget("kept", { z: 1, animations: { transition: [animation("a")], effect: [] } }),
    ]);
    const next = plan([
      widget("kept", {
        z: 0,
        visible: false,
        animations: { transition: [animation("a", 5)], effect: [] },
        delegated: [delegated("tw")],
      }),
      widget("new", { z: 1 }),
    ]);
    expect(diffPlans(prev, next).map((op) => op.op)).toEqual([
      "unmount",
      "mount",
      "setStack",
      "setVisible",
      "cancelAnimation",
      "startAnimation",
      "delegate",
    ]);
  });
});
