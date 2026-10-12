import { describe, expect, test } from "bun:test";
import {
  CANVAS_TARGET,
  type CompositionDocument,
  compileAnimation,
  PROFILES,
  type ResolvedTimeline,
  resolveTimeline,
  type TimelineFacts,
  type WidgetFacts,
} from "../model";
import { fitCanvas, planFrame } from "../runtime";
import { behavior, composition, placement, timing } from "./runtime-fixtures";

const T0 = 1_000_000;

/** An alert's timeline with every widget subscribed (untimed) at 100 ms and painted at 200 ms. */
function alertTimeline(
  doc: CompositionDocument,
  nowMs: number,
  extra: TimelineFacts["widgets"] = {}
): ResolvedTimeline {
  const widgets: Record<string, WidgetFacts> = {};
  for (const id of Object.keys(doc.widgets)) {
    widgets[id] = { subscribedAtMs: T0 + 100, timed: false, renderedAtMs: T0 + 200, ...extra[id] };
  }
  return resolveTimeline(doc, PROFILES.alert, { startedAtMs: T0, nowMs: T0 + nowMs, widgets });
}

describe("planFrame without a timeline", () => {
  test("lays every widget out as placed, shown as its flag says, with nothing animating", () => {
    const doc = composition(
      {
        w1: placement({ x: 10, y: 20, width: 300, height: 200, rotation: 15, opacity: 0.5, z: "a1" }),
        w2: placement({ widget: "woofx3:widget:image", visible: false, z: "a0" }),
      },
      { b1: behavior() }
    );
    const plan = planFrame(doc);
    expect(plan.atMs).toBeNull();
    expect(plan.nextChangeMs).toBeNull();
    expect(plan.skipped).toEqual([]);
    expect(plan.widgets.w1).toEqual({
      id: "w1",
      widget: "woofx3:widget:text",
      box: { x: 10, y: 20, width: 300, height: 200, rotation: 15, opacity: 0.5 },
      z: 1,
      visible: true,
      animations: { transition: [], effect: [] },
      delegated: [],
    });
    expect(plan.widgets.w2.visible).toBe(false);
    expect(plan.widgets.w2.z).toBe(0);
    expect(plan.canvas.animations).toEqual({ transition: [], effect: [] });
  });

  test("ranks by z as text, then by id, densely from 0", () => {
    const doc = composition({
      c: placement({ z: "a0" }),
      b: placement({ z: "a0" }),
      a: placement({ z: "Zz" }),
      d: placement({ z: "a0V" }),
    });
    const plan = planFrame(doc);
    expect(["a", "b", "c", "d"].map((id) => plan.widgets[id].z)).toEqual([0, 1, 2, 3]);
  });

  test("meta, when given, leaves out a widget until its entry arrives", () => {
    const doc = composition({ w1: placement(), w2: placement({ z: "a1" }) });
    const plan = planFrame(doc, { meta: { w2: { frameUrl: "/frame" } } });
    expect(Object.keys(plan.widgets)).toEqual(["w2"]);
    expect(plan.widgets.w2.z).toBe(0);
  });

  test("transient overrides lay gesture state over geometry and stacking", () => {
    const doc = composition({ w1: placement({ z: "a0" }), w2: placement({ z: "a1" }) });
    const plan = planFrame(doc, { transient: { w1: { x: 40, rotation: 90, z: "a2" } } });
    expect(plan.widgets.w1.box).toEqual({ x: 40, y: 0, width: 100, height: 100, rotation: 90, opacity: 1 });
    expect(plan.widgets.w1.z).toBe(1);
    expect(plan.widgets.w2.z).toBe(0);
  });
});

describe("planFrame with a timeline", () => {
  test("requires the time it plans for", () => {
    const doc = composition({ w1: placement() });
    const timeline = alertTimeline(doc, 0);
    expect(() => planFrame(doc, { timeline })).toThrow(/atMs/);
    expect(() => planFrame(doc, { timeline, atMs: Number.NaN })).toThrow(/atMs/);
  });

  test("refuses a timeline resolved for another document", () => {
    const doc = composition({ w1: placement() });
    const timeline = alertTimeline(doc, 0);
    const grown = composition({ w1: placement(), w2: placement() });
    expect(() => planFrame(grown, { timeline, atMs: 0 })).toThrow(/no entry for widget w2/);
  });

  test("shows a widget from its enter until its exit, and says when that changes", () => {
    const doc = composition({ w1: placement() });
    // Entered at 200 (painted), ends at UNTIMED_ALERT_MS, no exit animation.
    const timeline = alertTimeline(doc, 6_000);
    expect(timeline.widgets.w1.enterMs).toBe(200);
    expect(timeline.widgets.w1.exitMs).toBe(5_000);
    const at = (atMs: number) => planFrame(doc, { timeline, atMs });
    expect(at(0).widgets.w1.visible).toBe(false);
    expect(at(0).nextChangeMs).toBe(200);
    expect(at(200).widgets.w1.visible).toBe(true);
    expect(at(200).nextChangeMs).toBe(5_000);
    expect(at(4_999).widgets.w1.visible).toBe(true);
    expect(at(5_000).widgets.w1.visible).toBe(false);
    expect(at(5_000).nextChangeMs).toBeNull();
  });

  test("a widget that has not entered yet is hidden with no change planned", () => {
    const doc = composition({ w1: placement() });
    const timeline = resolveTimeline(doc, PROFILES.alert, { startedAtMs: T0, nowMs: T0 });
    const plan = planFrame(doc, { timeline, atMs: 0 });
    expect(plan.widgets.w1.visible).toBe(false);
    expect(plan.nextChangeMs).toBeNull();
  });

  test("plans transitions in absolute composition time, on the transition layer", () => {
    const enter = behavior({ timing: timing({ offsetMs: 100, durationMs: 400 }) });
    const leave = behavior({ kind: "slide", params: { phase: "out", direction: "left" }, order: "a1" });
    const doc = composition({ w1: placement() }, { in: enter, out: leave });
    const timeline = alertTimeline(doc, 6_000);
    const plan = planFrame(doc, { timeline, atMs: 1_000 });
    const transitions = plan.widgets.w1.animations.transition;
    expect(transitions.map((animation) => animation.behavior)).toEqual(["in", "out"]);
    expect(transitions[0].spec).toEqual(compileAnimation(enter, { startMs: 300, endMs: 700 }) as never);
    expect(transitions[0].spec.timing.delay).toBe(300);
    // The exit animation holds the exit back by its length.
    expect(timeline.widgets.w1.leaveMs).toBe(5_000);
    expect(transitions[1].spec.timing.delay).toBe(5_000);
    expect(transitions[1].spec.timing.duration).toBe(500);
    expect(plan.widgets.w1.animations.effect).toEqual([]);
  });

  test("an animation is planned the same however late the plan is made", () => {
    const doc = composition({ w1: placement() }, { in: behavior() });
    const timeline = alertTimeline(doc, 6_000);
    const early = planFrame(doc, { timeline, atMs: 0 });
    const late = planFrame(doc, { timeline, atMs: 4_000 });
    expect(late.widgets.w1.animations).toEqual(early.widgets.w1.animations);
  });

  test("splits effects onto the effect layer", () => {
    const doc = composition(
      { w1: placement() },
      {
        shake: behavior({ type: "effect", kind: "shake", params: {}, timing: timing({ durationMs: 1_000 }) }),
        fade: behavior(),
      }
    );
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 6_000), atMs: 0 });
    expect(plan.widgets.w1.animations.effect.map((animation) => animation.behavior)).toEqual(["shake"]);
    expect(plan.widgets.w1.animations.transition.map((animation) => animation.behavior)).toEqual(["fade"]);
  });

  test("orders animations on a layer by order, then id", () => {
    const doc = composition(
      { w1: placement() },
      {
        z: behavior({ order: "a0" }),
        y: behavior({ order: "a1" }),
        x: behavior({ order: "a1" }),
      }
    );
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 6_000), atMs: 0 });
    expect(plan.widgets.w1.animations.transition.map((animation) => animation.behavior)).toEqual(["z", "x", "y"]);
  });

  test("leaves out an animation whose window is not known yet", () => {
    const doc = composition(
      { w1: placement() },
      {
        out: behavior({ params: { phase: "out" } }),
        rest: behavior({ params: { phase: "in" }, timing: timing({ durationMs: "until-exit" }) }),
      }
    );
    // Timed, not completed: the end and so the exit are not known.
    const timeline = alertTimeline(doc, 1_000, {
      w1: { subscribedAtMs: T0 + 100, timed: true, renderedAtMs: T0 + 200 },
    });
    expect(timeline.widgets.w1.exitMs).toBeNull();
    const plan = planFrame(doc, { timeline, atMs: 1_000 });
    expect(plan.widgets.w1.animations.transition).toEqual([]);
    expect(plan.widgets.w1.visible).toBe(true);
  });

  test("skips unknown types and dangling targets, and ignores activities", () => {
    const doc = composition(
      { w1: placement() },
      {
        future: behavior({ type: "sparkle", kind: "glitter" }),
        gone: behavior({ target: "w9" }),
        act: behavior({
          type: "activity",
          kind: "active",
          timing: timing({ anchor: "start", durationMs: "until-exit" }),
          params: {},
        }),
      }
    );
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 6_000), atMs: 0 });
    expect(plan.skipped).toEqual([
      { behavior: "future", reason: "unknown-type" },
      { behavior: "gone", reason: "dangling-target" },
    ]);
    expect(plan.widgets.w1.animations).toEqual({ transition: [], effect: [] });
  });

  test("skips a host kind whose params do not compile, and plays the rest", () => {
    const doc = composition(
      { w1: placement() },
      {
        bad: behavior({ kind: "slide", params: { phase: "in", direction: "sideways" } }),
        good: behavior({ order: "a1" }),
      }
    );
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 6_000), atMs: 0 });
    expect(plan.skipped).toEqual([{ behavior: "bad", reason: "invalid-params" }]);
    expect(plan.widgets.w1.animations.transition.map((animation) => animation.behavior)).toEqual(["good"]);
  });

  test("plays canvas behaviors on the canvas root", () => {
    const doc = composition(
      { w1: placement() },
      {
        enter: behavior({ target: CANVAS_TARGET }),
        pulse: behavior({
          target: CANVAS_TARGET,
          type: "effect",
          kind: "pulse",
          params: {},
          timing: timing({ anchor: "start", durationMs: "until-exit" }),
        }),
      }
    );
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 6_000), atMs: 0 });
    expect(plan.canvas.animations.transition.map((animation) => animation.behavior)).toEqual(["enter"]);
    expect(plan.canvas.animations.transition[0].spec.timing.delay).toBe(0);
    expect(plan.canvas.animations.effect.map((animation) => animation.behavior)).toEqual(["pulse"]);
    expect(plan.widgets.w1.animations).toEqual({ transition: [], effect: [] });
  });

  test("hands a widget its own kinds once they start, and wakes up for them", () => {
    const typewriter = behavior({
      kind: "typewriter",
      params: { phase: "in", speed: 2 },
      timing: timing({ offsetMs: 300 }),
    });
    const doc = composition({ w1: placement() }, { tw: typewriter });
    const timeline = alertTimeline(doc, 6_000);
    const before = planFrame(doc, { timeline, atMs: 250 });
    expect(before.widgets.w1.delegated).toEqual([]);
    expect(before.nextChangeMs).toBe(500);
    const after = planFrame(doc, { timeline, atMs: 500 });
    expect(after.widgets.w1.delegated).toEqual([
      {
        behavior: "tw",
        type: "transition",
        kind: "typewriter",
        phase: "in",
        startMs: 500,
        endMs: 1_000,
        easing: "ease-out",
        params: { phase: "in", speed: 2 },
      },
    ]);
    expect(after.widgets.w1.animations.transition).toEqual([]);
  });

  test("a widget's own effect is delegated without a phase", () => {
    const doc = composition({ w1: placement() }, { wobble: behavior({ type: "effect", kind: "wobble", params: {} }) });
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 6_000), atMs: 1_000 });
    expect(plan.widgets.w1.delegated.map((entry) => [entry.behavior, entry.phase])).toEqual([["wobble", null]]);
  });

  test("the canvas cannot be delegated to", () => {
    const doc = composition({ w1: placement() }, { tw: behavior({ target: CANVAS_TARGET, kind: "typewriter" }) });
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 6_000), atMs: 1_000 });
    expect(plan.skipped).toEqual([{ behavior: "tw", reason: "canvas-delegate" }]);
  });

  test("given the catalog, a widget is handed only the kinds it declares", () => {
    const doc = composition(
      { w1: placement(), w2: placement({ z: "a1" }) },
      {
        tw: behavior({ kind: "typewriter" }),
        sparkle: behavior({ type: "effect", kind: "sparkle", params: {}, order: "a1" }),
        other: behavior({ target: "w2", kind: "typewriter", order: "a2" }),
        fade: behavior({ target: "w2", order: "a3" }),
      }
    );
    const declared = { w1: { transitions: ["typewriter"], effects: [] } };
    const plan = planFrame(doc, {
      timeline: alertTimeline(doc, 6_000),
      atMs: 1_000,
      declaredKinds: (id) => declared[id as keyof typeof declared],
    });
    expect(plan.widgets.w1.delegated.map((entry) => entry.behavior)).toEqual(["tw"]);
    expect(plan.widgets.w2.delegated).toEqual([]);
    // A host kind needs no declaration.
    expect(plan.widgets.w2.animations.transition.map((animation) => animation.behavior)).toEqual(["fade"]);
    expect(plan.skipped).toEqual([
      { behavior: "sparkle", reason: "undeclared-kind" },
      { behavior: "other", reason: "undeclared-kind" },
    ]);
  });

  test("behaviors on a widget left out for want of meta wait with it", () => {
    const doc = composition({ w1: placement() }, { in: behavior(), tw: behavior({ kind: "typewriter" }) });
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 6_000), atMs: 1_000, meta: {} });
    expect(plan.widgets).toEqual({});
    expect(plan.skipped).toEqual([]);
  });

  test("leaves out a widget that never enters, with its behaviors: a hidden widget in an alert is not mounted", () => {
    const doc = composition(
      { shown: placement({ z: "a0" }), hidden: placement({ visible: false, z: "a1" }) },
      { fade: behavior({ target: "hidden" }) }
    );
    const plan = planFrame(doc, { timeline: alertTimeline(doc, 300), atMs: 300 });
    expect(Object.keys(plan.widgets)).toEqual(["shown"]);
    expect(plan.widgets.shown.z).toBe(0);
    expect(plan.skipped).toEqual([]);
  });

  test("a scene widget shown and hidden by facts", () => {
    const doc = composition({ w1: placement() }, { out: behavior({ params: { phase: "out" } }) });
    const timeline = resolveTimeline(doc, PROFILES.scene, {
      startedAtMs: T0,
      nowMs: T0 + 3_000,
      widgets: { w1: { renderedAtMs: T0 + 50, visibility: [{ atMs: T0 + 2_000, visible: false }] } },
    });
    const plan = (atMs: number) => planFrame(doc, { timeline, atMs });
    expect(plan(1_000).widgets.w1.visible).toBe(true);
    expect(plan(1_000).nextChangeMs).toBe(2_500);
    expect(plan(2_400).widgets.w1.visible).toBe(true);
    expect(plan(2_500).widgets.w1.visible).toBe(false);
    expect(plan(1_000).widgets.w1.animations.transition[0].spec.timing.delay).toBe(2_000);
  });
});

describe("fitCanvas", () => {
  test("scales to the tighter side and centres the other", () => {
    expect(fitCanvas({ width: 1920, height: 1080 }, { width: 960, height: 960 })).toEqual({ scale: 0.5, x: 0, y: 210 });
    expect(fitCanvas({ width: 100, height: 200 }, { width: 400, height: 200 })).toEqual({ scale: 1, x: 150, y: 0 });
  });

  test("refuses an empty canvas", () => {
    expect(() => fitCanvas({ width: 0, height: 10 }, { width: 10, height: 10 })).toThrow(/positive/);
  });
});
