import { describe, expect, test } from "bun:test";
import {
  buildPreviewLayoutMessage,
  createCompositionEditor,
  LocalDocumentSource,
  PREVIEW_LAYOUT_MESSAGE,
} from "../../editor";
import { type CompositionDocument, PROFILES, STRICT_REGISTRY, type Timing } from "../../model";
import { ALERT_AREA, AUDIO, CATALOG, CLOCK, composition, harness, IMAGE, placement, TEXT, VIDEO } from "./support";

const timing: Timing = { anchor: "enter", offsetMs: 0, durationMs: 500, easing: "ease-out" };

function threeStack(): CompositionDocument {
  return composition({
    a: placement({ z: "a0001", x: 0 }),
    b: placement({ z: "a0002", x: 300 }),
    c: placement({ z: "a0003", x: 600 }),
  });
}

describe("state", () => {
  test("getState keeps its identity until something changes, and unchanged nodes keep theirs", () => {
    const { editor } = harness(threeStack());
    const first = editor.getState();
    expect(editor.getState()).toBe(first);
    editor.viewport.setZoom(1);
    expect(editor.getState()).toBe(first);
    editor.nodes.patch("b", { x: 310 });
    const second = editor.getState();
    expect(second).not.toBe(first);
    expect(second.view.nodes.find((node) => node.id === "a")).toBe(first.view.nodes.find((node) => node.id === "a"));
    expect(second.view.nodes.find((node) => node.id === "b")).not.toBe(
      first.view.nodes.find((node) => node.id === "b")
    );
    expect(second.selection).toBe(first.selection);
  });

  test("the view lists nodes bottom first and capabilities follow the profile", () => {
    const scene = harness(threeStack());
    expect(scene.editor.getState().view.nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(scene.editor.getState().capabilities).toMatchObject({ canHide: true, hasTimeline: false, readOnly: false });
    const alert = harness(threeStack(), PROFILES.alert);
    expect(alert.editor.getState().capabilities).toMatchObject({ canHide: false, hasTimeline: true });
    expect(scene.editor.getState().capabilities.anchors).toEqual(PROFILES.scene.anchors);
    expect(alert.editor.getState().capabilities.anchors).toEqual(PROFILES.alert.anchors);
    expect(alert.editor.getState().palette.map((row) => row.widgetId)).toEqual([TEXT, IMAGE, VIDEO, AUDIO]);
  });
});

describe("gestures", () => {
  test("a drag changes only transient state until released, then commits once", () => {
    const { editor, source } = harness(composition({ a: placement({ x: 100, y: 100 }) }));
    expect(editor.gesture.begin({ kind: "move", node: "a", point: { x: 150, y: 150 } })).toBe(true);
    for (let step = 1; step <= 10; step++) {
      editor.gesture.update({ x: 150 + step * 30, y: 150 + step * 7 }, { alt: true });
    }
    expect(source.applies).toBe(0);
    expect(editor.getState().transient?.boxes.a).toMatchObject({ x: 400, y: 170 });
    expect(editor.getState().view.nodes[0]?.box).toMatchObject({ x: 400, y: 170 });
    expect(editor.getState().doc?.widgets.a?.x).toBe(100);
    expect(editor.preview.frame()?.doc.widgets.a?.x).toBe(400);
    expect(editor.gesture.end()).toEqual({ ok: true });
    expect(source.applies).toBe(1);
    expect(editor.getState().transient).toBeNull();
    expect(source.getDocument().widgets.a).toMatchObject({ x: 400, y: 170 });
    editor.history.undo();
    expect(source.getDocument().widgets.a).toMatchObject({ x: 100, y: 100 });
  });

  test("a press without movement commits nothing; cancel drops the gesture", () => {
    const { editor, source } = harness(composition({ a: placement() }));
    editor.gesture.begin({ kind: "move", node: "a", point: { x: 10, y: 10 } });
    expect(editor.gesture.end()).toEqual({ ok: true });
    editor.gesture.begin({ kind: "move", node: "a", point: { x: 10, y: 10 } });
    editor.gesture.update({ x: 500, y: 500 });
    editor.gesture.cancel();
    expect(source.applies).toBe(0);
    expect(editor.getState().transient).toBeNull();
    expect(editor.getState().selection.ids).toEqual(["a"]);
  });

  test("a drag snaps to the canvas centre and shows guides", () => {
    const { editor } = harness(composition({ a: placement({ x: 0, y: 0, width: 100, height: 100 }) }));
    editor.gesture.begin({ kind: "move", node: "a", point: { x: 50, y: 50 } });
    // The centre lands 15 px right of the canvas centre; no edge is near a line.
    editor.gesture.update({ x: 50 + 925, y: 50 + 300 });
    const state = editor.getState();
    expect(state.transient?.boxes.a?.x).toBe(910);
    expect(state.guides).toContainEqual({ axis: "vertical", position: 960, source: "canvas" });
    editor.gesture.update({ x: 50 + 925, y: 50 + 300 }, { alt: true });
    expect(editor.getState().transient?.boxes.a?.x).toBe(925);
    expect(editor.getState().guides).toEqual([]);
    editor.gesture.end();
    expect(editor.getState().guides).toEqual([]);
  });

  test("touch snaps from farther away", () => {
    // Wide enough that only its centre comes near the canvas centre line, 30 px off.
    const { editor } = harness(composition({ a: placement({ x: 0, y: 0, width: 300, height: 100 }) }));
    editor.gesture.begin({ kind: "move", node: "a", point: { x: 0, y: 0 }, pointer: "touch" });
    editor.gesture.update({ x: 840, y: 300 });
    expect(editor.getState().transient?.boxes.a?.x).toBe(810);
    editor.gesture.cancel();
    editor.gesture.begin({ kind: "move", node: "a", point: { x: 0, y: 0 }, pointer: "mouse" });
    editor.gesture.update({ x: 840, y: 300 });
    expect(editor.getState().transient?.boxes.a?.x).toBe(840);
  });

  test("a drag snaps to another widget's edge", () => {
    const { editor } = harness(
      composition({
        a: placement({ x: 0, y: 700, width: 100, height: 100, z: "a0001" }),
        b: placement({ x: 300, y: 200, width: 200, height: 100, z: "a0002" }),
      })
    );
    editor.gesture.begin({ kind: "move", node: "a", point: { x: 0, y: 0 } });
    editor.gesture.update({ x: 506, y: 0 });
    expect(editor.getState().transient?.boxes.a?.x).toBe(500);
    expect(editor.getState().guides).toContainEqual({ axis: "vertical", position: 500, source: "b" });
  });

  test("locked widgets cannot be moved, resized or rotated", () => {
    const { editor } = harness(composition({ a: placement({ locked: true }) }));
    expect(editor.gesture.begin({ kind: "move", node: "a", point: { x: 0, y: 0 } })).toBe(false);
    expect(editor.gesture.begin({ kind: "resize", node: "a", handle: "se", point: { x: 0, y: 0 } })).toBe(false);
    expect(editor.gesture.begin({ kind: "rotate", node: "a", point: { x: 0, y: 0 } })).toBe(false);
    editor.dispatch("selection.select", { id: "a" });
    expect(editor.dispatch("node.nudge", { dx: 1, dy: 0 }).ok).toBe(false);
  });

  test("resize keeps the minimum, and Shift locks the aspect", () => {
    const { editor, source } = harness(composition({ a: placement({ x: 100, y: 100, width: 400, height: 200 }) }));
    editor.gesture.begin({ kind: "resize", node: "a", handle: "se", point: { x: 500, y: 300 } });
    editor.gesture.update({ x: 0, y: 0 }, { alt: true });
    expect(editor.getState().transient?.boxes.a).toMatchObject({ width: 50, height: 50 });
    editor.gesture.update({ x: 700, y: 310 }, { shift: true, alt: true });
    expect(editor.getState().transient?.boxes.a).toMatchObject({ x: 100, y: 100, width: 600, height: 300 });
    editor.gesture.end();
    expect(source.applies).toBe(1);
    expect(source.getDocument().widgets.a).toMatchObject({ width: 600, height: 300 });
  });

  test("media resize freely like any other box, and Shift keeps the aspect", () => {
    const { editor } = harness(
      composition({ v: placement({ widget: VIDEO, width: 640, height: 360 }) }),
      PROFILES.alert
    );
    editor.gesture.begin({ kind: "resize", node: "v", handle: "e", point: { x: 640, y: 180 } });
    editor.gesture.update({ x: 960, y: 180 }, { alt: true });
    expect(editor.getState().transient?.boxes.v).toMatchObject({ width: 960, height: 360 });
    editor.gesture.update({ x: 960, y: 180 }, { shift: true, alt: true });
    expect(editor.getState().transient?.boxes.v).toMatchObject({ width: 960, height: 540 });
    editor.gesture.cancel();
  });

  test("rotation snaps to 15 degrees with Shift", () => {
    const { editor, source } = harness(composition({ a: placement({ x: 0, y: 0, width: 100, height: 100 }) }));
    editor.gesture.begin({ kind: "rotate", node: "a", point: { x: 150, y: 50 } });
    const at = (deg: number) => ({
      x: 50 + Math.cos((deg * Math.PI) / 180) * 100,
      y: 50 + Math.sin((deg * Math.PI) / 180) * 100,
    });
    editor.gesture.update(at(37));
    expect(editor.getState().transient?.boxes.a?.rotation).toBeCloseTo(37, 1);
    editor.gesture.update(at(37), { shift: true });
    expect(editor.getState().transient?.boxes.a?.rotation).toBe(30);
    editor.gesture.end();
    expect(source.getDocument().widgets.a?.rotation).toBe(30);
    expect(source.applies).toBe(1);
  });

  test("gesture points are screen points: zoom and origin are taken out", () => {
    const { editor } = harness(composition({ a: placement({ x: 100, y: 100 }) }));
    editor.viewport.setZoom(0.5);
    editor.viewport.setOrigin({ x: 40, y: 20 });
    expect(editor.viewport.screenToCanvas({ x: 90, y: 70 })).toEqual({ x: 100, y: 100 });
    editor.gesture.begin({ kind: "move", node: "a", point: { x: 90, y: 70 } });
    editor.gesture.update({ x: 140, y: 70 }, { alt: true });
    expect(editor.getState().transient?.boxes.a?.x).toBe(200);
  });

  test("dragging a multi-selection moves every unlocked member", () => {
    const { editor } = harness(threeStack());
    editor.dispatch("selection.select", { id: "a" });
    editor.dispatch("selection.select", { id: "b", additive: true });
    editor.gesture.begin({ kind: "move", node: "b", point: { x: 0, y: 0 } });
    editor.gesture.update({ x: 10, y: 5 }, { alt: true });
    editor.gesture.end();
    const widgets = editor.getState().doc?.widgets;
    expect([widgets?.a?.x, widgets?.b?.x, widgets?.c?.x]).toEqual([10, 310, 600]);
  });
});

describe("stacking", () => {
  function zChanges(before: CompositionDocument, after: CompositionDocument): string[] {
    return Object.keys(after.widgets).filter((id) => before.widgets[id]?.z !== after.widgets[id]?.z);
  }

  test("each layer command changes only the moved node's key", () => {
    const { editor, source } = harness(threeStack());
    const commands = [
      ["a", "layer.bringForward", ["b", "a", "c"]],
      ["a", "layer.toFront", ["b", "c", "a"]],
      ["a", "layer.sendBackward", ["b", "a", "c"]],
      ["c", "layer.toBack", ["c", "b", "a"]],
    ] as const;
    for (const [id, command, order] of commands) {
      editor.dispatch("selection.select", { id });
      const before = source.getDocument();
      expect(editor.dispatch(command).ok).toBe(true);
      expect(zChanges(before, source.getDocument())).toEqual([id]);
      expect(editor.getState().view.nodes.map((node) => node.id)).toEqual([...order]);
    }
  });

  test("bringing the top node forward changes nothing", () => {
    const { editor, source } = harness(threeStack());
    editor.dispatch("selection.select", { id: "c" });
    editor.dispatch("layer.bringForward");
    expect(source.getDocument().widgets.c?.z).toBe("a0003");
  });

  test("reorder moves to an index, and equal keys are renumbered once", () => {
    const { editor, source } = harness(threeStack());
    editor.nodes.reorder("c", { index: 0 });
    expect(editor.getState().view.nodes.map((node) => node.id)).toEqual(["c", "a", "b"]);
    const tied = harness(
      composition({ a: placement({ z: "a0001" }), b: placement({ z: "a0001" }), c: placement({ z: "a0002" }) })
    );
    tied.editor.nodes.reorder("c", { index: 1 });
    expect(tied.editor.getState().view.nodes.map((node) => node.id)).toEqual(["a", "c", "b"]);
    expect(source.applies).toBe(1);
  });
});

describe("commands", () => {
  test("delete removes the widget and its behaviors in one change", () => {
    const doc = threeStack();
    doc.behaviors = {
      fade: { type: "transition", kind: "fade", target: "a", order: "a0001", timing, params: { phase: "in" } },
      shake: { type: "effect", kind: "shake", target: "b", order: "a0001", timing, params: {} },
      glow: { type: "effect", kind: "glow", target: "canvas", order: "a0001", timing, params: {} },
    };
    const { editor, source } = harness(doc);
    editor.dispatch("selection.select", { id: "a" });
    expect(editor.handleKey({ key: "Delete" })).toBe(true);
    expect(source.applies).toBe(1);
    expect(Object.keys(source.getDocument().widgets)).toEqual(["b", "c"]);
    expect(Object.keys(source.getDocument().behaviors).sort()).toEqual(["glow", "shake"]);
    expect(editor.getState().selection.ids).toEqual([]);
    editor.history.undo();
    expect(Object.keys(source.getDocument().behaviors).sort()).toEqual(["fade", "glow", "shake"]);
  });

  test("the keymap nudges by 1, or 10 with Shift, and held arrows undo as one", () => {
    const { editor, source } = harness(composition({ a: placement({ x: 100, y: 100 }) }));
    editor.dispatch("selection.select", { id: "a" });
    editor.handleKey({ key: "ArrowRight" });
    editor.handleKey({ key: "ArrowRight", shiftKey: true });
    editor.handleKey({ key: "ArrowUp" });
    expect(source.getDocument().widgets.a).toMatchObject({ x: 111, y: 100 - 1 });
    expect(editor.handleKey({ key: "q" })).toBe(false);
    editor.handleKey({ key: "z", ctrlKey: true });
    expect(source.getDocument().widgets.a).toMatchObject({ x: 100, y: 100 });
    editor.handleKey({ key: "Z", metaKey: true, shiftKey: true });
    expect(source.getDocument().widgets.a).toMatchObject({ x: 111, y: 99 });
  });

  test("a key is consumed only when its command does something", () => {
    const { editor, source } = harness(composition({ a: placement({ x: 100, y: 100 }) }));
    expect(editor.handleKey({ key: "ArrowRight" })).toBe(false);
    expect(editor.handleKey({ key: "Delete" })).toBe(false);
    expect(editor.handleKey({ key: "Escape" })).toBe(false);
    expect(editor.handleKey({ key: "z", ctrlKey: true })).toBe(false);
    expect(editor.handleKey({ key: "=", ctrlKey: true })).toBe(true);
    editor.dispatch("selection.select", { id: "a" });
    expect(editor.handleKey({ key: "ArrowRight" })).toBe(true);
    expect(editor.handleKey({ key: "z", ctrlKey: true })).toBe(true);
    expect(editor.handleKey({ key: "Escape" })).toBe(true);
    expect(editor.getState().selection.ids).toEqual([]);
    source.setReadOnly(true);
    editor.dispatch("selection.select", { id: "a" });
    expect(editor.handleKey({ key: "ArrowRight" })).toBe(false);
    expect(source.getDocument().widgets.a?.x).toBe(100);
  });

  test("nudging keeps the centre on the canvas", () => {
    const { editor, source } = harness(composition({ a: placement({ x: -50, y: 0, width: 100, height: 100 }) }));
    editor.dispatch("selection.select", { id: "a" });
    editor.dispatch("node.nudge", { dx: -10, dy: 0 });
    expect(source.getDocument().widgets.a?.x).toBe(-50);
  });

  test("visibility toggles on a scene only; lock toggles anywhere", () => {
    const scene = harness(composition({ a: placement() }));
    scene.editor.dispatch("selection.select", { id: "a" });
    scene.editor.dispatch("node.toggleVisible");
    expect(scene.source.getDocument().widgets.a?.visible).toBe(false);
    scene.editor.dispatch("node.toggleLock");
    expect(scene.source.getDocument().widgets.a?.locked).toBe(true);
    const alert = harness(composition({ a: placement() }), PROFILES.alert);
    alert.editor.dispatch("selection.select", { id: "a" });
    expect(alert.editor.dispatch("node.toggleVisible").ok).toBe(false);
  });

  test("duplicate and paste make fresh ids, on top, offset, with behaviors retargeted", () => {
    const doc = composition({ a: placement({ x: 100, y: 100, z: "a0001", locked: true }) });
    doc.behaviors = {
      fade: { type: "transition", kind: "fade", target: "a", order: "a0001", timing, params: { phase: "in" } },
    };
    const { editor, source } = harness(doc);
    editor.dispatch("selection.select", { id: "a" });
    editor.dispatch("node.duplicate");
    const afterDuplicate = source.getDocument();
    expect(Object.keys(afterDuplicate.widgets).sort()).toEqual(["a", "w-2"]);
    expect(afterDuplicate.widgets["w-2"]).toMatchObject({ x: 120, y: 120, locked: false });
    expect(afterDuplicate.widgets["w-2"]!.z > afterDuplicate.widgets.a!.z).toBe(true);
    expect(
      Object.values(afterDuplicate.behaviors)
        .map((behavior) => behavior.target)
        .sort()
    ).toEqual(["a", "w-2"]);
    expect(editor.getState().selection.ids).toEqual(["w-2"]);

    editor.dispatch("selection.select", { id: "a" });
    editor.handleKey({ key: "c", ctrlKey: true });
    editor.handleKey({ key: "v", ctrlKey: true });
    editor.handleKey({ key: "v", ctrlKey: true });
    const widgets = source.getDocument().widgets;
    expect(Object.keys(widgets).sort()).toEqual(["a", "w-2", "w-3", "w-4"]);
    expect(widgets["w-4"]).toMatchObject({ x: 140, y: 140 });
  });

  test("zoom commands step and fit follows the stage", () => {
    const { editor } = harness(threeStack());
    editor.viewport.setStage({ width: 1024, height: 640 });
    editor.dispatch("view.zoomFit");
    const fit = editor.getState().viewport.zoom;
    expect(fit).toBeCloseTo((1024 - 64) / 1920);
    editor.dispatch("view.zoomIn");
    expect(editor.getState().viewport).toMatchObject({ zoom: 0.75, fit: false });
    editor.viewport.setStage({ width: 2000, height: 2000 });
    expect(editor.getState().viewport.zoom).toBe(0.75);
    editor.dispatch("view.zoomFit");
    expect(editor.getState().viewport.zoom).toBeCloseTo((2000 - 64) / 1920);
  });

  test("an unknown command fails fast", () => {
    const { editor } = harness();
    expect(() => editor.dispatch("node.explode" as never)).toThrow();
  });
});

describe("read-only", () => {
  test("refuses every change, but selection and zoom still work", () => {
    const { editor, source } = harness(threeStack(), PROFILES.scene, { readOnly: true });
    expect(editor.getState().capabilities.readOnly).toBe(true);
    editor.dispatch("selection.select", { id: "a" });
    expect(editor.getState().selection.ids).toEqual(["a"]);
    expect(editor.dispatch("node.delete").ok).toBe(false);
    expect(editor.dispatch("layer.toFront").ok).toBe(false);
    expect(editor.dispatch("node.nudge", { dx: 1, dy: 0 }).ok).toBe(false);
    expect(editor.nodes.add(CLOCK).ok).toBe(false);
    expect(editor.gesture.begin({ kind: "move", node: "a", point: { x: 0, y: 0 } })).toBe(false);
    expect(editor.dispatch("view.zoomIn").ok).toBe(true);
    expect(source.applies).toBe(0);
  });

  test("follows the source as it locks and unlocks, and says why", () => {
    const { editor, source } = harness(threeStack());
    expect(editor.getState().capabilities.readOnlyReason).toBeNull();
    source.setReadOnly(true, "the draft is being published");
    expect(editor.getState().capabilities).toMatchObject({
      readOnly: true,
      readOnlyReason: "the draft is being published",
    });
    expect(editor.nodes.patch("a", { x: 5 })).toEqual({ ok: false, detail: "the draft is being published" });
    source.setReadOnly(false);
    expect(editor.getState().capabilities).toMatchObject({ readOnly: false, readOnlyReason: null });
  });
});

describe("adding nodes", () => {
  test("a scene widget gets its declared defaults, centred, stepped, on top, selected", () => {
    const { editor, source } = harness(threeStack());
    const added = editor.nodes.add(CLOCK);
    expect(added).toEqual({ ok: true, id: "w-4" });
    const placed = source.getDocument().widgets["w-4"]!;
    expect(placed).toMatchObject({
      widget: CLOCK,
      name: "Clock",
      settings: { format: "HH:mm" },
      width: 300,
      height: 200,
      x: 960 - 150 + 120,
      y: 540 - 100 + 120,
    });
    expect(placed.z > "a0003").toBe(true);
    expect(editor.getState().selection.primary).toBe("w-4");
  });

  test("alert layers get kind sizes and lengths; audio sits in the corner", () => {
    const { editor, source } = harness(composition(), PROFILES.alert);
    editor.nodes.add(TEXT);
    editor.nodes.add(VIDEO);
    editor.nodes.add(AUDIO);
    const widgets = source.getDocument().widgets;
    expect(widgets["w-1"]).toMatchObject({
      width: 1200,
      height: 76,
      settings: { font: "Inter", duration: 5, text: "New text", fontSize: 48, color: "#ffffff" },
    });
    expect(widgets["w-2"]).toMatchObject({ width: 640, height: 360, settings: { duration: 8 } });
    expect(widgets["w-3"]).toMatchObject({ x: 1680, y: 20, width: 200, height: 80, settings: { duration: 3 } });
  });

  test("alert areas are named default, then alert-2, alert-3", () => {
    const { editor, source } = harness(composition());
    editor.nodes.add(ALERT_AREA);
    editor.nodes.add(ALERT_AREA);
    editor.nodes.add(ALERT_AREA);
    const names = Object.values(source.getDocument().widgets).map((widget) => widget.settings.name);
    expect(names).toEqual(["default", "alert-2", "alert-3"]);
  });

  test("a widget not placeable on the profile is refused", () => {
    const { editor } = harness(composition(), PROFILES.alert);
    expect(editor.nodes.add(CLOCK).ok).toBe(false);
    expect(editor.nodes.add("nope:widget:x").ok).toBe(false);
  });

  test("ids must be URL-safe", () => {
    const source = new LocalDocumentSource(composition());
    const editor = createCompositionEditor({
      source,
      profile: PROFILES.scene,
      catalog: CATALOG,
      newNodeId: () => "has space",
    });
    expect(() => editor.nodes.add(CLOCK)).toThrow();
  });

  test("the default ids are random, URL-safe and distinct", () => {
    const source = new LocalDocumentSource(composition());
    const editor = createCompositionEditor({ source, profile: PROFILES.scene, catalog: CATALOG });
    const first = editor.nodes.add(CLOCK);
    const second = editor.nodes.add(CLOCK);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.id).not.toBe(second.id);
      expect(first.id).toMatch(/^w-[a-z0-9]{8}$/);
    }
  });
});

describe("patching nodes", () => {
  test("a text box grows with its text about its centre, and typing undoes as one", () => {
    const { editor, source, clock } = harness(
      composition({
        t: placement({ widget: TEXT, x: 0, y: 462, width: 1200, height: 76, settings: { text: "Hi", fontSize: 48 } }),
      }),
      PROFILES.alert
    );
    editor.nodes.patch("t", { settings: { text: "Hi\nthere" } });
    clock.time += 200;
    editor.nodes.patch("t", { settings: { text: "Hi\nthere\nyou" } });
    const text = source.getDocument().widgets.t!;
    expect(text.height).toBe(196);
    expect(text.y + text.height / 2).toBe(500);
    editor.history.undo();
    expect(source.getDocument().widgets.t).toMatchObject({ height: 76, settings: { text: "Hi" } });
    expect(editor.getState().history.canUndo).toBe(false);
  });

  test("edits far apart in time undo separately", () => {
    const { editor, source, clock } = harness(composition({ a: placement() }));
    editor.nodes.patch("a", { name: "one" });
    clock.time += 5_000;
    editor.nodes.patch("a", { name: "two" });
    editor.history.undo();
    expect(source.getDocument().widgets.a?.name).toBe("one");
  });

  test("resize keeps the centre, and a media its height when none is given; moveCenter clamps", () => {
    const { editor, source } = harness(
      composition({ v: placement({ widget: IMAGE, x: 0, y: 0, width: 640, height: 360 }) }),
      PROFILES.alert
    );
    editor.nodes.resize("v", { width: 320 });
    expect(source.getDocument().widgets.v).toMatchObject({ x: 160, y: 0, width: 320, height: 360 });
    editor.nodes.moveCenter("v", { x: 5000, y: -5 });
    expect(source.getDocument().widgets.v).toMatchObject({ x: 1920 - 160, y: -180 });
  });

  test("the registry refuses a change before it is applied; the default tolerates what it does not know", () => {
    const doc = composition({ a: placement() });
    doc.behaviors.b = { type: "effect", kind: "shake", target: "a", order: "a0", timing, params: {} };
    const strictSource = new LocalDocumentSource(doc);
    const strict = createCompositionEditor({
      source: strictSource,
      profile: PROFILES.scene,
      catalog: CATALOG,
      registry: STRICT_REGISTRY,
    });
    const result = strict.behaviors.patch("b", { params: { wobble: 1 } });
    expect(result.ok).toBe(false);
    expect((result as { detail: string }).detail).toContain("no param wobble");
    expect(strictSource.getDocument().behaviors.b?.params).toEqual({});
    expect(strict.getState().history.canUndo).toBe(false);

    const { editor, source } = harness(doc);
    // A param a newer build may know: kept by a client, judged by the engine.
    expect(editor.behaviors.patch("b", { params: { wobble: 1 } }).ok).toBe(true);
    // A known field out of range is refused by any registry.
    expect(editor.nodes.patch("a", { opacity: 7 }).ok).toBe(false);
    expect(source.getDocument().widgets.a?.opacity).toBe(1);
  });

  test("an entry that is invalid already does not block edits elsewhere", () => {
    const doc = composition({ a: placement(), b: placement({ z: "a0002", opacity: 7 }) });
    const { editor, source } = harness(doc);
    expect(editor.nodes.patch("a", { x: 40 }).ok).toBe(true);
    expect(source.getDocument().widgets.a?.x).toBe(40);
    expect(editor.nodes.patch("b", { x: 40 }).ok).toBe(false);
  });
});

describe("behaviors", () => {
  test("add, reorder, patch and remove; only the moved behavior's order changes", () => {
    const { editor, source } = harness(threeStack(), PROFILES.alert);
    const first = editor.behaviors.add("a", "transition", "fade", timing, { phase: "in" });
    const second = editor.behaviors.add("a", "transition", "slide", timing, { phase: "in" });
    const third = editor.behaviors.add("a", "effect", "shake", timing);
    expect([first.ok, second.ok, third.ok]).toEqual([true, true, true]);
    const before = source.getDocument().behaviors;
    expect(before["b-1"]!.order < before["b-2"]!.order && before["b-2"]!.order < before["b-3"]!.order).toBe(true);
    editor.behaviors.reorder("b-3", { index: 0 });
    const after = source.getDocument().behaviors;
    expect(after["b-3"]!.order < after["b-1"]!.order).toBe(true);
    expect(after["b-1"]!.order).toBe(before["b-1"]!.order);
    expect(after["b-2"]!.order).toBe(before["b-2"]!.order);
    editor.behaviors.patch("b-1", { kind: "zoom" });
    expect(source.getDocument().behaviors["b-1"]?.kind).toBe("zoom");
    editor.behaviors.remove("b-2");
    expect(Object.keys(source.getDocument().behaviors).sort()).toEqual(["b-1", "b-3"]);
  });

  test("timing must use an anchor the profile has, and the target and type must exist", () => {
    const { editor } = harness(threeStack(), PROFILES.scene);
    expect(editor.behaviors.add("a", "effect", "shake", { ...timing, anchor: "start" }).ok).toBe(false);
    expect(editor.behaviors.add("zz", "effect", "shake", timing).ok).toBe(false);
    expect(editor.behaviors.add("a", "sound", "chime", timing).ok).toBe(false);
    // An activity's default timing starts with the composition, which a scene does not have.
    expect(editor.behaviors.add("a", "activity", "window")).toEqual({
      ok: false,
      detail: "a scene cannot time from start",
    });
    expect(editor.behaviors.add("canvas", "effect", "shake", timing).ok).toBe(true);
  });

  test("a kind or params that make no valid behavior are refused, not thrown", () => {
    const { editor, source } = harness(threeStack(), PROFILES.alert);
    expect(editor.behaviors.add("a", "effect", "Not A Kind", timing)).toEqual({
      ok: false,
      detail: "invalid behavior kind",
    });
    expect(editor.behaviors.add("a", "transition", "slide", timing, { phase: "in", direction: "sideways" }).ok).toBe(
      false
    );
    expect(source.applies).toBe(0);
    expect(editor.getState().history.canUndo).toBe(false);
  });

  test("what the call leaves out takes the type's defaults from the registry", () => {
    const { editor, source } = harness(threeStack(), PROFILES.alert);
    const added = editor.behaviors.add("a", "transition", "slide", { durationMs: 900 }, { phase: "out" });
    expect(added).toEqual({ ok: true, id: "b-1" });
    expect(source.getDocument().behaviors["b-1"]).toMatchObject({
      type: "transition",
      kind: "slide",
      target: "a",
      timing: { anchor: "exit", offsetMs: 0, durationMs: 900, easing: "ease-in" },
      params: { phase: "out", direction: "up" },
    });
  });
});

describe("canvas", () => {
  test("a patch sets layout keys as one change that undoes as one", () => {
    const { editor, source } = harness(threeStack());
    expect(editor.canvas.patch({ width: 1280, height: 720, backgroundColor: "#112233" })).toEqual({ ok: true });
    expect(source.getDocument().layout).toEqual({ width: 1280, height: 720, backgroundColor: "#112233" });
    expect(editor.getState().view.canvas).toEqual({ width: 1280, height: 720 });
    expect(editor.dispatch("canvas.patch", { grid: 8 })).toEqual({ ok: true });
    expect(source.getDocument().layout.grid).toBe(8);
    editor.history.undo();
    editor.history.undo();
    expect(source.getDocument().layout).toEqual({ width: 1920, height: 1080 });
  });

  test("typing a size undoes as one", () => {
    const { editor, source, clock } = harness(threeStack());
    editor.canvas.patch({ width: 1 });
    clock.time += 200;
    editor.canvas.patch({ width: 12 });
    clock.time += 200;
    editor.canvas.patch({ width: 128 });
    editor.history.undo();
    expect(source.getDocument().layout.width).toBe(1920);
  });

  test("a size that is not a positive number is refused, and so is any patch while read-only", () => {
    const { editor, source } = harness(threeStack());
    expect(editor.canvas.patch({ width: 0 }).ok).toBe(false);
    expect(editor.canvas.patch({ height: -1 }).ok).toBe(false);
    expect(editor.canvas.patch({ width: Number.NaN }).ok).toBe(false);
    expect(editor.canvas.patch({ backgroundColor: 7 as unknown as string }).ok).toBe(false);
    expect(source.getDocument().layout).toEqual({ width: 1920, height: 1080 });
    expect(editor.getState().history.canUndo).toBe(false);
    source.setReadOnly(true);
    expect(editor.canvas.patch({ width: 1280 })).toEqual({ ok: false, detail: "the document is read-only" });
  });

  test("a document loaded without a size is fitted and edited on the default canvas, as the overlay draws it", () => {
    const doc = threeStack();
    doc.layout = {};
    const { editor } = harness(doc);
    expect(editor.getState().view.canvas).toEqual({ width: 1920, height: 1080 });
    editor.viewport.setStage({ width: 1024, height: 640 });
    editor.dispatch("view.zoomFit");
    expect(editor.getState().viewport.zoom).toBeCloseTo((1024 - 64) / 1920);
    expect(editor.nodes.add(CLOCK).ok).toBe(true);
    expect(editor.nodes.moveCenter("a", { x: 10, y: 10 }).ok).toBe(true);
    expect(editor.gesture.begin({ kind: "move", node: "a", point: { x: 0, y: 0 } })).toBe(true);
  });

  test("each missing or unusable dimension falls back on its own", () => {
    const doc = threeStack();
    doc.layout = { width: 1280, height: 0 };
    const { editor } = harness(doc);
    expect(editor.getState().view.canvas).toEqual({ width: 1280, height: 1080 });
  });
});

describe("catalog", () => {
  test("setCatalog changes the palette and new placements' defaults, keeping history", () => {
    const { editor, source } = harness(composition());
    editor.nodes.add(CLOCK);
    const before = editor.getState().palette;
    editor.setCatalog(CATALOG.map((row) => row));
    expect(editor.getState().palette).toBe(before);
    editor.setCatalog([
      ...CATALOG.filter((row) => row.widgetId !== CLOCK),
      { widgetId: CLOCK, name: "Clock", settings: [{ id: "format", defaultValue: "h:mm a" }] },
      { widgetId: "example:widget:timer", name: "Timer", settings: [] },
    ]);
    expect(editor.getState().palette.map((row) => row.widgetId)).toContain("example:widget:timer");
    expect(editor.getState().history.canUndo).toBe(true);
    const added = editor.nodes.add(CLOCK);
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(source.getDocument().widgets[added.id]?.settings).toEqual({ format: "h:mm a" });
    }
    editor.setCatalog([]);
    expect(editor.getState().palette).toEqual([]);
    expect(editor.nodes.add(CLOCK).ok).toBe(false);
    expect(Object.keys(source.getDocument().widgets)).toHaveLength(2);
  });
});

describe("history", () => {
  test("undo and redo walk back and forth; a new change ends the redo chain", () => {
    const { editor, source } = harness(composition({ a: placement() }));
    editor.nodes.patch("a", { x: 10 });
    editor.nodes.add(CLOCK);
    expect(editor.getState().history).toEqual({ canUndo: true, canRedo: false });
    editor.history.undo();
    expect(Object.keys(source.getDocument().widgets)).toEqual(["a"]);
    editor.history.undo();
    expect(source.getDocument().widgets.a?.x).toBe(0);
    expect(editor.history.undo().ok).toBe(false);
    editor.history.redo();
    editor.history.redo();
    expect(Object.keys(source.getDocument().widgets).sort()).toEqual(["a", "w-2"]);
    editor.history.undo();
    editor.nodes.patch("a", { y: 5 });
    expect(editor.getState().history.canRedo).toBe(false);
  });

  test("undo reverts only this user's change after another editor's change", () => {
    const { editor, source } = harness(composition({ a: placement(), b: placement({ z: "a0002" }) }));
    editor.nodes.patch("a", { x: 10 });
    // Another editor moves b and renames a.
    const remote = structuredClone(source.getDocument());
    remote.widgets.b!.x = 99;
    remote.widgets.a!.name = "theirs";
    source.replace(remote);
    editor.history.undo();
    const doc = source.getDocument();
    expect(doc.widgets.a).toMatchObject({ x: 0, name: "theirs" });
    expect(doc.widgets.b?.x).toBe(99);
    editor.history.redo();
    expect(source.getDocument().widgets.a).toMatchObject({ x: 10, name: "theirs" });
  });

  test("undo yields where another editor changed the same value since", () => {
    const { editor, source } = harness(composition({ a: placement() }));
    editor.nodes.patch("a", { x: 10 });
    const remote = structuredClone(source.getDocument());
    remote.widgets.a!.x = 50;
    source.replace(remote);
    expect(editor.getState().history.canUndo).toBe(false);
    expect(source.getDocument().widgets.a?.x).toBe(50);
  });

  test("undoing an add after another editor deleted the node does nothing", () => {
    const { editor, source } = harness(composition());
    editor.nodes.add(CLOCK);
    editor.nodes.patch("w-1", { x: 5 });
    const remote = structuredClone(source.getDocument());
    delete remote.widgets["w-1"];
    source.replace(remote);
    expect(editor.getState().selection.ids).toEqual([]);
    expect(editor.getState().history.canUndo).toBe(false);
  });
});

describe("preview", () => {
  test("the layout message carries placements bottom first, in the stored shape", () => {
    const { editor } = harness(threeStack());
    const message = editor.preview.layoutMessage();
    expect(message?.type).toBe(PREVIEW_LAYOUT_MESSAGE);
    expect(message?.widgets.map((widget) => widget.id)).toEqual(["a", "b", "c"]);
    expect(message?.placements?.[1]).toEqual({
      id: "b",
      widgetCanonicalId: CLOCK,
      name: "",
      position: { x: 300, y: 0 },
      size: { width: 100, height: 100 },
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      visible: true,
      settings: {},
    });
    const frame = editor.preview.frame();
    expect(frame).not.toBeNull();
    expect(buildPreviewLayoutMessage(frame!, { placements: false }).placements).toBeUndefined();
  });

  test("each widget's layout carries its rotation, opacity, visibility and rank, mid-gesture included", () => {
    const { editor } = harness(
      composition({
        a: placement({ z: "a0002", rotation: 15, opacity: 0.5, visible: false }),
        b: placement({ z: "a0001", x: 300 }),
      })
    );
    editor.gesture.begin({ kind: "rotate", node: "b", point: { x: 350, y: 0 } });
    editor.gesture.update({ x: 450, y: 50 });
    const widgets = editor.preview.layoutMessage({ placements: false })?.widgets ?? [];
    expect(widgets.map((widget) => widget.id)).toEqual(["b", "a"]);
    expect(widgets[1]).toEqual({
      id: "a",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 15,
      opacity: 0.5,
      visible: false,
      zIndex: 1,
    });
    expect(widgets[0]?.zIndex).toBe(0);
    expect(widgets[0]?.rotation).not.toBe(0);
  });

  test("the frame carries the playhead", () => {
    const { editor } = harness(threeStack(), PROFILES.alert);
    editor.timeline.seek(1200);
    editor.timeline.play();
    editor.timeline.advance(300);
    expect(editor.preview.frame()).toMatchObject({ playheadMs: 1500, playing: true });
    editor.timeline.pause();
    editor.timeline.advance(300);
    expect(editor.getState().timeline).toMatchObject({ playheadMs: 1500, playing: false });
  });
});

describe("timeline", () => {
  test("an alert's tracks are estimated from each widget's duration, and resolved again only when the document changes", () => {
    const doc = composition({
      text: placement({ widget: TEXT, settings: { duration: 3 } }),
      clip: placement({ widget: VIDEO, z: "a0002", settings: { duration: 8 } }),
    });
    doc.behaviors.fade = {
      type: "transition",
      kind: "fade",
      target: "text",
      order: "a0",
      timing: { anchor: "exit", offsetMs: -400, durationMs: 400, easing: "ease-in" },
      params: { phase: "out" },
    };
    const { editor } = harness(doc, PROFILES.alert);
    const tracks = editor.getState().timeline.tracks;
    expect(tracks?.widgets.text).toMatchObject({ enterMs: 0, completeMs: 3000 });
    expect(tracks?.widgets.clip).toMatchObject({ enterMs: 0, completeMs: 8000 });
    expect(tracks?.behaviors.fade?.startMs).not.toBeNull();
    expect(tracks?.endMs).toBe(8000);

    editor.timeline.seek(500);
    editor.dispatch("selection.select", { id: "text" });
    editor.gesture.begin({ kind: "move", node: "text", point: { x: 0, y: 0 } });
    editor.gesture.update({ x: 30, y: 0 });
    expect(editor.getState().timeline.tracks).toBe(tracks);
    editor.gesture.cancel();

    editor.nodes.patch("text", { settings: { duration: 10 } });
    expect(editor.getState().timeline.tracks?.endMs).toBe(10000);
  });

  test("a media widget with no length of its own is timed by its media's length when its settings carry one", () => {
    const doc = composition({
      hinted: placement({ widget: VIDEO, settings: { duration: 0, mediaDurationSeconds: 6.5 } }),
      bare: placement({ widget: AUDIO, z: "a0002", settings: { duration: 0 } }),
      looping: placement({ widget: VIDEO, z: "a0003", settings: { duration: 0, loop: true, mediaDurationSeconds: 4 } }),
      text: placement({ widget: TEXT, z: "a0004", settings: { duration: 0, mediaDurationSeconds: 9 } }),
    });
    const { editor } = harness(doc, PROFILES.alert);
    const tracks = editor.getState().timeline.tracks;
    expect(tracks?.widgets.hinted).toMatchObject({ status: "timed", completeMs: 6500 });
    expect(tracks?.widgets.bare?.status).toBe("untimed");
    expect(tracks?.widgets.looping?.status).toBe("untimed");
    // Only media plays a length of its own.
    expect(tracks?.widgets.text?.status).toBe("untimed");
    expect(tracks?.endMs).toBe(6500);

    editor.nodes.patch("hinted", { settings: { duration: 2 } });
    expect(editor.getState().timeline.tracks?.widgets.hinted).toMatchObject({ completeMs: 2000 });
  });

  test("a scene has no tracks", () => {
    const { editor } = harness(threeStack(), PROFILES.scene);
    expect(editor.getState().timeline.tracks).toBeNull();
  });
});
