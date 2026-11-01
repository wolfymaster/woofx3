import { describe, expect, test } from "bun:test";
import { type CompositionDocument, PROFILES, type ProfileId } from "../model";
import { createScheduler, type PatchOp } from "../runtime";
import { behavior, composition, FakeClock, placement, timing } from "./runtime-fixtures";

const T0 = 1_000_000;

/** Fades in on entering and out on leaving, 500 ms each. */
function faded(ids: string[]): CompositionDocument {
  const widgets = Object.fromEntries(ids.map((id, index) => [id, placement({ z: `a${index}` })]));
  const behaviors = Object.fromEntries(
    ids.flatMap((id) => [
      [`${id}-in`, behavior({ target: id })],
      [`${id}-out`, behavior({ target: id, params: { phase: "out" }, order: "a1" })],
    ])
  );
  return composition(widgets, behaviors);
}

function setup(doc: CompositionDocument, profile: ProfileId = "alert") {
  const clock = new FakeClock(T0);
  const applied: Array<{ atMs: number; ops: readonly PatchOp[] }> = [];
  const finished: number[] = [];
  const scheduler = createScheduler({
    doc,
    profile: PROFILES[profile],
    clock,
    renderer: { apply: (ops) => applied.push({ atMs: clock.now() - T0, ops }) },
    onFinished: () => finished.push(clock.now() - T0),
  });
  const at = (ms: number) => clock.advanceTo(T0 + ms);
  /** Every op applied, with the composition time it was applied at. */
  const ops = (kind?: PatchOp["op"]) =>
    applied.flatMap((batch) =>
      batch.ops.filter((op) => kind === undefined || op.op === kind).map((op) => ({ atMs: batch.atMs, op }))
    );
  return { clock, scheduler, applied, finished, at, ops };
}

describe("createScheduler for an alert", () => {
  test("mounts everything hidden at once, so frames load before they are shown", () => {
    const { applied } = setup(faded(["w1", "w2"]));
    expect(applied).toHaveLength(1);
    expect(applied[0].ops.map((op) => [op.op, (op as { visible?: boolean }).visible])).toEqual([
      ["mount", false],
      ["mount", false],
    ]);
  });

  test("timed and untimed widgets: shown as they paint, leave when the timed one completes, finish after the exits", () => {
    const { scheduler, finished, at, ops } = setup(faded(["text", "video"]));
    at(100);
    scheduler.widgetSubscribed("text", false);
    at(150);
    scheduler.widgetSubscribed("video", true);
    at(200);
    scheduler.widgetRendered("text");
    at(300);
    scheduler.widgetRendered("video");

    expect(ops("setVisible")).toEqual([
      { atMs: 200, op: { op: "setVisible", id: "text", visible: true, awaitingPaint: false } },
      { atMs: 300, op: { op: "setVisible", id: "video", visible: true, awaitingPaint: false } },
    ]);
    const entrances = ops("startAnimation").map(({ atMs, op }) => [
      atMs,
      (op as { behavior: string }).behavior,
      (op as { spec: { timing: { delay: number } } }).spec.timing.delay,
    ]);
    expect(entrances).toEqual([
      [200, "text-in", 200],
      [300, "video-in", 300],
    ]);

    // Nothing is known about the end while the video plays.
    at(3_999);
    expect(finished).toEqual([]);
    scheduler.widgetCompleted("video");
    at(4_000);
    scheduler.widgetCompleted("video");
    const exits = ops("startAnimation")
      .slice(2)
      .map(({ atMs, op }) => [
        atMs,
        (op as { behavior: string }).behavior,
        (op as { spec: { timing: { delay: number } } }).spec.timing.delay,
      ]);
    expect(exits).toEqual([
      [3_999, "text-out", 3_999],
      [3_999, "video-out", 3_999],
    ]);
    expect(scheduler.timeline().endMs).toBe(3_999);
    expect(scheduler.timeline().finishMs).toBe(4_499);

    at(4_498);
    expect(ops("setVisible")).toHaveLength(2);
    expect(finished).toEqual([]);
    at(10_000);
    expect(ops("setVisible").slice(2)).toEqual([
      { atMs: 4_499, op: { op: "setVisible", id: "text", visible: false, awaitingPaint: false } },
      { atMs: 4_499, op: { op: "setVisible", id: "video", visible: false, awaitingPaint: false } },
    ]);
    expect(finished).toEqual([4_499]);
  });

  test("untimed widgets hold the alert for the untimed length, then exit", () => {
    const { scheduler, finished, at, ops, clock } = setup(faded(["w1"]));
    at(50);
    scheduler.widgetSubscribed("w1", false);
    scheduler.widgetRendered("w1");
    const out = ops("startAnimation").find(({ op }) => (op as { behavior: string }).behavior === "w1-out");
    expect((out?.op as { spec: { timing: { delay: number } } }).spec.timing.delay).toBe(5_000);
    expect(clock.pending()).toEqual([T0 + 5_500]);
    at(60_000);
    expect(finished).toEqual([5_500]);
    expect(ops("setVisible").map(({ atMs, op }) => [atMs, (op as { visible: boolean }).visible])).toEqual([
      [50, true],
      [5_500, false],
    ]);
    expect(clock.pending()).toEqual([]);
  });

  test("revisit timers show a widget that never paints and stop waiting for one that never subscribes", () => {
    const { finished, at, ops, scheduler } = setup(composition({ silent: placement() }));
    at(1_999);
    expect(ops("setVisible")).toEqual([]);
    at(2_000);
    expect(ops("setVisible")).toEqual([
      { atMs: 2_000, op: { op: "setVisible", id: "silent", visible: true, awaitingPaint: false } },
    ]);
    at(9_999);
    expect(scheduler.timeline().widgets.silent.status).toBe("pending");
    expect(finished).toEqual([]);
    at(10_000);
    expect(scheduler.timeline().widgets.silent.status).toBe("ignored");
    expect(finished).toEqual([10_000]);
  });

  test("a delegated kind is handed over when it starts", () => {
    const doc = composition(
      { w1: placement() },
      { tw: behavior({ kind: "typewriter", timing: timing({ offsetMs: 1_000 }) }) }
    );
    const { scheduler, at, ops } = setup(doc);
    scheduler.widgetSubscribed("w1", false);
    scheduler.widgetRendered("w1");
    at(999);
    expect(ops("delegate")).toEqual([]);
    at(1_000);
    expect(
      ops("delegate").map(({ atMs, op }) => [atMs, (op as { delegated: { startMs: number } }).delegated.startMs])
    ).toEqual([[1_000, 1_000]]);
  });

  test("a hidden widget is never mounted and the alert finishes without it", () => {
    const doc = composition({ text: placement({ z: "a0" }), sound: placement({ visible: false, z: "a1" }) });
    const { scheduler, finished, at, ops } = setup(doc);
    expect(ops("mount").map(({ op }) => (op as { id: string }).id)).toEqual(["text"]);
    scheduler.widgetSubscribed("sound", true);
    at(100);
    scheduler.widgetSubscribed("text", false);
    scheduler.widgetRendered("text");
    at(10_000);
    expect(finished).toEqual([5_000]);
    expect(ops("mount")).toHaveLength(1);
  });

  test("ignores repeated facts, facts for widgets it does not have, and anything after dispose", () => {
    const { scheduler, applied, at, clock } = setup(faded(["w1"]));
    at(100);
    scheduler.widgetRendered("w1");
    const batches = applied.length;
    at(200);
    scheduler.widgetRendered("w1");
    scheduler.widgetSubscribed("ghost", true);
    scheduler.widgetCompleted("ghost");
    expect(applied).toHaveLength(batches);
    expect(scheduler.timeline().widgets.w1.enterMs).toBe(100);
    scheduler.dispose();
    expect(clock.pending()).toEqual([]);
    scheduler.widgetSubscribed("w1", true);
    at(60_000);
    expect(applied).toHaveLength(batches);
    expect(() => scheduler.setDocument(faded(["w1"]))).toThrow(/disposed/);
  });
});

describe("createScheduler for a scene", () => {
  test("hiding a widget plays its exit from now and hides it after; showing it plays its entrance again", () => {
    const doc = faded(["w1"]);
    const { scheduler, at, ops, finished } = setup(doc, "scene");
    at(100);
    scheduler.widgetRendered("w1");
    expect(ops("setVisible")).toEqual([
      { atMs: 100, op: { op: "setVisible", id: "w1", visible: true, awaitingPaint: false } },
    ]);

    at(5_000);
    scheduler.setDocument({ ...doc, widgets: { w1: { ...doc.widgets.w1, visible: false } } });
    const out = ops("startAnimation").filter(({ op }) => (op as { behavior: string }).behavior === "w1-out");
    expect(
      out.map(({ atMs, op }) => [atMs, (op as { spec: { timing: { delay: number } } }).spec.timing.delay])
    ).toEqual([[5_000, 5_000]]);
    at(5_499);
    expect(ops("setVisible")).toHaveLength(1);
    at(5_500);
    expect(ops("setVisible").at(-1)).toEqual({
      atMs: 5_500,
      op: { op: "setVisible", id: "w1", visible: false, awaitingPaint: false },
    });

    at(8_000);
    scheduler.visibilityChanged("w1", true);
    expect(ops("setVisible").at(-1)).toEqual({
      atMs: 8_000,
      op: { op: "setVisible", id: "w1", visible: true, awaitingPaint: false },
    });
    const reentry = ops("startAnimation").filter(
      ({ atMs, op }) => atMs === 8_000 && (op as { behavior: string }).behavior === "w1-in"
    );
    expect((reentry[0].op as { spec: { timing: { delay: number } } }).spec.timing.delay).toBe(8_000);
    expect(finished).toEqual([]);
  });

  test("a widget added later enters once it paints, not at the scene's start", () => {
    const doc = faded(["w1"]);
    const { scheduler, at, ops } = setup(doc, "scene");
    scheduler.widgetRendered("w1");
    at(30_000);
    const grown = faded(["w1", "w2"]);
    scheduler.setDocument(grown);
    const mount = ops("mount").find(({ op }) => (op as { id: string }).id === "w2");
    expect(mount).toEqual({
      atMs: 30_000,
      op: {
        op: "mount",
        id: "w2",
        widget: "woofx3:widget:text",
        box: expect.anything(),
        z: 1,
        visible: false,
        awaitingPaint: true,
      },
    });
    at(30_300);
    scheduler.widgetRendered("w2");
    expect(ops("setVisible").at(-1)).toEqual({
      atMs: 30_300,
      op: { op: "setVisible", id: "w2", visible: true, awaitingPaint: false },
    });
    const entrance = ops("startAnimation").find(({ op }) => (op as { behavior: string }).behavior === "w2-in");
    expect((entrance?.op as { spec: { timing: { delay: number } } }).spec.timing.delay).toBe(30_300);
  });

  test("a removed widget is unmounted and its facts forgotten", () => {
    const { scheduler, ops } = setup(faded(["w1", "w2"]), "scene");
    scheduler.widgetRendered("w1");
    scheduler.setDocument(faded(["w2"]));
    expect(ops("unmount").map(({ op }) => (op as { id: string }).id)).toEqual(["w1"]);
    scheduler.widgetRendered("w1");
    expect(Object.keys(scheduler.timeline().widgets)).toEqual(["w2"]);
  });

  test("transient overrides move a box without touching the timeline", () => {
    const { scheduler, ops } = setup(faded(["w1"]), "scene");
    scheduler.setTransient({ w1: { x: 77 } });
    expect(ops("setBox").map(({ op }) => (op as { box: { x: number } }).box.x)).toEqual([77]);
    scheduler.setTransient(undefined);
    expect(ops("setBox").map(({ op }) => (op as { box: { x: number } }).box.x)).toEqual([77, 0]);
  });

  test("meta arriving later mounts the widget it was waiting for", () => {
    const clock = new FakeClock(T0);
    const applied: PatchOp[] = [];
    const doc = faded(["w1", "w2"]);
    const scheduler = createScheduler({
      doc,
      profile: PROFILES.scene,
      clock,
      meta: { w1: {} },
      renderer: { apply: (ops) => applied.push(...ops) },
    });
    expect(applied.filter((op) => op.op === "mount").map((op) => (op as { id: string }).id)).toEqual(["w1"]);
    scheduler.setDocument(doc, { w1: {}, w2: {} });
    expect(applied.filter((op) => op.op === "mount").map((op) => (op as { id: string }).id)).toEqual(["w1", "w2"]);
  });
});

describe("createScheduler reporting skipped behaviors", () => {
  test("reports each skip once, however often it plans", () => {
    const doc = composition(
      { w1: placement() },
      {
        tw: behavior({ kind: "typewriter" }),
        wave: behavior({ kind: "wave", order: "a1" }),
      }
    );
    const clock = new FakeClock(T0);
    const reported: string[][] = [];
    const scheduler = createScheduler({
      doc,
      profile: PROFILES.alert,
      clock,
      renderer: { apply: () => {} },
      declaredKinds: () => ({ transitions: ["typewriter"], effects: [] }),
      onSkipped: (skips) => reported.push(skips.map((skip) => `${skip.behavior}:${skip.reason}`)),
    });
    scheduler.widgetSubscribed("w1", false);
    clock.advanceTo(T0 + 100);
    scheduler.widgetRendered("w1");
    clock.advanceTo(T0 + 600);
    scheduler.dispose();
    expect(reported).toEqual([["wave:undeclared-kind"]]);
  });
});

describe("createScheduler with estimates, on a clock that jumps", () => {
  function estimated(doc: CompositionDocument, documentChanges?: "now" | "start") {
    const clock = new FakeClock(0);
    const applied: PatchOp[] = [];
    const finished: number[] = [];
    const scheduler = createScheduler({
      doc,
      profile: PROFILES.alert,
      clock,
      renderer: { apply: (ops) => applied.push(...ops) },
      estimate: {},
      onFinished: () => finished.push(clock.now()),
      ...(documentChanges === undefined ? {} : { documentChanges }),
    });
    const visible = (id: string) => scheduler.plan().widgets[id]?.visible;
    return { clock, scheduler, applied, finished, visible };
  }

  test("knows the whole timeline before anything is observed", () => {
    const { scheduler } = estimated(faded(["w1"]));
    // Untimed: held for the untimed alert length, then the 500 ms exit.
    expect(scheduler.timeline().widgets.w1).toMatchObject({ enterMs: 0, leaveMs: 5_000, exitMs: 5_500 });
    expect(scheduler.timeline().finishMs).toBe(5_500);
  });

  test("a frame's own length replaces the estimate once it reports it", () => {
    const doc = faded(["w1"]);
    doc.widgets.w1 = { ...doc.widgets.w1, settings: { duration: 2 } };
    const { clock, scheduler } = estimated(doc);
    expect(scheduler.timeline().finishMs).toBe(2_500);
    scheduler.widgetSubscribed("w1", true);
    clock.advanceTo(1_200);
    scheduler.widgetCompleted("w1");
    expect(scheduler.timeline().finishMs).toBe(1_700);
  });

  test("resync plans for where the clock jumped, backwards included", () => {
    const { clock, scheduler, visible } = estimated(faded(["w1"]));
    clock.advanceTo(6_000);
    expect(visible("w1")).toBe(false);
    clock.jumpTo(1_000);
    scheduler.resync();
    expect(visible("w1")).toBe(true);
    expect(scheduler.plan().atMs).toBe(1_000);
  });

  test("finishes again after a jump back before the finish", () => {
    const { clock, scheduler, finished } = estimated(faded(["w1"]));
    clock.advanceTo(6_000);
    expect(finished).toEqual([5_500]);
    clock.jumpTo(5_000);
    scheduler.resync();
    expect(finished).toEqual([5_500]);
    clock.advanceTo(6_000);
    expect(finished).toEqual([5_500, 5_500]);
  });

  test("a jump past the finish reports it once", () => {
    const { clock, scheduler, finished } = estimated(faded(["w1"]));
    clock.jumpTo(9_000);
    scheduler.resync();
    scheduler.resync();
    expect(finished).toEqual([9_000]);
  });

  test("with documentChanges start, a widget added mid-play belongs to the whole composition", () => {
    const { clock, scheduler, visible } = estimated(faded(["w1"]), "start");
    clock.advanceTo(3_000);
    scheduler.setDocument(faded(["w1", "w2"]));
    expect(scheduler.timeline().widgets.w2).toMatchObject({ enterMs: 0, leaveMs: 5_000, exitMs: 5_500 });
    expect(visible("w2")).toBe(true);
    clock.jumpTo(100);
    scheduler.resync();
    expect(visible("w2")).toBe(true);
  });

  test("with documentChanges start, a hidden widget is hidden from the start, not from now", () => {
    const doc = faded(["w1", "w2"]);
    const { clock, scheduler, visible } = estimated(doc, "start");
    clock.advanceTo(2_000);
    scheduler.setDocument({ ...doc, widgets: { ...doc.widgets, w2: { ...doc.widgets.w2, visible: false } } });
    clock.jumpTo(500);
    scheduler.resync();
    expect(visible("w1")).toBe(true);
    expect(visible("w2")).toBeFalsy();
  });

  test("with documentChanges start, what a frame reported survives a move but not a change of settings", () => {
    const doc = faded(["w1"]);
    doc.widgets.w1 = { ...doc.widgets.w1, settings: { duration: 2 } };
    const { clock, scheduler } = estimated(doc, "start");
    scheduler.widgetSubscribed("w1", true);
    clock.advanceTo(1_200);
    scheduler.widgetCompleted("w1");
    expect(scheduler.timeline().finishMs).toBe(1_700);

    const moved = { ...doc, widgets: { w1: { ...doc.widgets.w1, x: 40 } } };
    scheduler.setDocument(moved);
    expect(scheduler.timeline().finishMs).toBe(1_700);

    scheduler.setDocument({ ...moved, widgets: { w1: { ...moved.widgets.w1, settings: { duration: 3 } } } });
    expect(scheduler.timeline().finishMs).toBe(3_500);
  });

  test("resync after dispose is a bug", () => {
    const { scheduler } = estimated(faded(["w1"]));
    scheduler.dispose();
    expect(() => scheduler.resync()).toThrow();
  });
});
