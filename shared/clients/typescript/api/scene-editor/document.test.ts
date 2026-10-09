import { describe, expect, test } from "bun:test";
import {
  applyOps,
  composeOps,
  diffDocuments,
  invalidOps,
  invalidResult,
  invertOps,
  type Ops,
  type SceneDocument,
  sameValue,
  transformOps,
} from "./document";
import { placement, sceneDoc } from "./test-support";

describe("json0 tie convention", () => {
  // Pinned because the sequencer and the client rely on it: the server
  // transforms an incoming op as "left" against what it already committed,
  // and a client transforms its pending ops as "left" against the server's.

  test("both replacing one key: the left side wins, the right side's becomes a no-op", () => {
    const left: Ops = [{ p: ["widgets", "a", "x"], od: 0, oi: 10 }];
    const right: Ops = [{ p: ["widgets", "a", "x"], od: 0, oi: 20 }];
    const doc = sceneDoc({ a: placement() });

    const leftAfterRight = transformOps(left, right, "left");
    const rightAfterLeft = transformOps(right, left, "right");

    expect(rightAfterLeft).toEqual([]);
    expect(applyOps(applyOps(doc, right), leftAfterRight).widgets.a!.x).toBe(10);
    expect(applyOps(applyOps(doc, left), rightAfterLeft).widgets.a!.x).toBe(10);
  });

  test("both inserting text at one index: the left side's text lands first and both are kept", () => {
    const doc = sceneDoc({ a: placement({ name: "ab" }) });
    const left: Ops = [{ p: ["widgets", "a", "name", 1], si: "L" }];
    const right: Ops = [{ p: ["widgets", "a", "name", 1], si: "R" }];

    const viaRight = applyOps(applyOps(doc, right), transformOps(left, right, "left"));
    const viaLeft = applyOps(applyOps(doc, left), transformOps(right, left, "right"));

    expect(viaRight.widgets.a!.name).toBe("aLRb");
    expect(viaLeft.widgets.a!.name).toBe("aLRb");
  });

  test("an edit inside a placement another op deleted is dropped", () => {
    const edit: Ops = [{ p: ["widgets", "a", "x"], od: 0, oi: 5 }];
    const remove: Ops = [{ p: ["widgets", "a"], od: placement() }];
    expect(transformOps(edit, remove, "left")).toEqual([]);
  });
});

describe("diff, apply, compose, invert", () => {
  test("diff then apply reproduces the target, and the inverse restores the source", () => {
    const from = sceneDoc({ a: placement({ name: "hello" }), b: placement({ x: 3 }) });
    const to = sceneDoc({ a: placement({ name: "help!", x: 9 }), c: placement() });
    to.layout.backgroundColor = "red";

    const ops = diffDocuments(from, to);
    const applied = applyOps(from, ops);

    expect(sameValue(applied, to)).toBe(true);
    expect(sameValue(applyOps(applied, invertOps(ops)), from)).toBe(true);
  });

  test("apply leaves its input unchanged", () => {
    const doc = sceneDoc({ a: placement() });
    const before = structuredClone(doc);
    applyOps(doc, [{ p: ["widgets", "a", "x"], od: 0, oi: 1 }]);
    expect(doc).toEqual(before);
  });

  test("text changes travel as one splice", () => {
    const from = sceneDoc({ a: placement({ name: "hello world" }) });
    const to = sceneDoc({ a: placement({ name: "hello there world" }) });
    expect(diffDocuments(from, to)).toEqual([{ p: ["widgets", "a", "name", 6], si: "there " }]);
  });

  test("compose has the effect of both ops in order", () => {
    const doc = sceneDoc({ a: placement() });
    const first: Ops = [{ p: ["widgets", "a", "x"], od: 0, oi: 1 }];
    const second: Ops = [{ p: ["widgets", "a", "x"], od: 1, oi: 2 }];
    expect(applyOps(doc, composeOps(first, second)).widgets.a!.x).toBe(2);
  });
});

describe("invalidOps", () => {
  test("accepts layout and placement field edits", () => {
    expect(invalidOps([{ p: ["layout", "width"], od: 1920, oi: 1280 }])).toBeNull();
    expect(invalidOps([{ p: ["widgets", "a", "settings", "color"], oi: "red" }])).toBeNull();
    expect(invalidOps([{ p: ["widgets", "a"], oi: placement() }])).toBeNull();
  });

  test("refuses ops outside the document's shape", () => {
    expect(invalidOps([])).toBe("ops must be a non-empty list");
    expect(invalidOps([{ p: ["other"], oi: 1 }])).toBe("a path must start at a layout key or a placement");
    expect(invalidOps([{ p: ["widgets", "a"], oi: { widget: "x" } }])).toBe("a placement must be inserted whole");
    expect(invalidOps([{ p: ["widgets", "a", "colour"], od: 1, oi: 2 }])).toBe("a placement has no field colour");
    expect(invalidOps([{ p: ["widgets", "a", "opacity"], od: 1, oi: 2 }])).toBe("invalid opacity");
  });

  const refused: Array<[string, unknown]> = [
    ["a placement field removed", { p: ["widgets", "a", "x"], od: 0 }],
    ["a placement field inserted without what it replaces", { p: ["widgets", "a", "x"], oi: 3 }],
    ["opacity out of range", { p: ["widgets", "a", "opacity"], od: 1, oi: -0.1 }],
    ["a number add", { p: ["widgets", "a", "x"], na: 5 }],
    ["a list insert", { p: ["widgets", "a", "settings", "items", 0], li: "x" }],
    ["a list delete", { p: ["widgets", "a", "settings", "items", 0], ld: "x" }],
    ["a list move", { p: ["widgets", "a", "settings", "items", 0], lm: 1 }],
    ["a subtype op", { p: ["widgets", "a", "name"], t: "text0", o: [{ p: 0, i: "x" }] }],
    ["a component with nothing to do", { p: ["layout", "width"] }],
    ["replacing the whole layout", { p: ["layout"], od: {}, oi: {} }],
    ["deleting the whole layout", { p: ["layout"], od: {} }],
    ["replacing every placement", { p: ["widgets"], od: {}, oi: {} }],
    ["an op inside a layout value", { p: ["layout", "grid", "size"], od: 8, oi: 16 }],
    ["text spliced into a layout value", { p: ["layout", "backgroundColor", 0], si: "#" }],
    ["text spliced into a placement", { p: ["widgets", "a", 0], si: "x" }],
    ["text spliced into z", { p: ["widgets", "a", "z", 1], si: "0" }],
    ["text spliced into the widget id", { p: ["widgets", "a", "widget", 0], si: "x" }],
    ["text spliced into a number field", { p: ["widgets", "a", "x", 0], si: "1" }],
    ["text spliced deeper than the name", { p: ["widgets", "a", "name", 0, 1], si: "x" }],
    ["a key under a plain field", { p: ["widgets", "a", "x", "deep"], oi: 1 }],
    ["a path into a list in settings", { p: ["widgets", "a", "settings", "items", 0, "label"], oi: "x" }],
    ["text spliced into settings itself", { p: ["widgets", "a", "settings", 0], si: "x" }],
    ["a splice that also replaces", { p: ["widgets", "a", "name", 0], si: "x", oi: "y" }],
    ["a splice that both inserts and deletes", { p: ["widgets", "a", "name", 0], si: "x", sd: "y" }],
    ["an empty splice", { p: ["widgets", "a", "name", 0], si: "" }],
    ["a fractional index", { p: ["widgets", "a", "name", 0.5], si: "x" }],
  ];
  for (const [name, component] of refused) {
    test(`refuses ${name}`, () => {
      expect(invalidOps([component])).not.toBeNull();
    });
  }

  test("accepts text splices in the name and in settings, and key changes at any depth of settings", () => {
    expect(invalidOps([{ p: ["widgets", "a", "name", 2], si: "x" }])).toBeNull();
    expect(invalidOps([{ p: ["widgets", "a", "name", 2], sd: "x" }])).toBeNull();
    expect(invalidOps([{ p: ["widgets", "a", "settings", "text", 0], si: "x" }])).toBeNull();
    expect(invalidOps([{ p: ["widgets", "a", "extra", "a", "b"], od: 1 }])).toBeNull();
    expect(invalidOps([{ p: ["widgets", "a", "settings", "font", "size"], od: 1, oi: 2 }])).toBeNull();
    expect(invalidOps([{ p: ["layout", "theme"], od: "dark" }])).toBeNull();
    expect(invalidOps([{ p: ["widgets", "a"], od: placement() }])).toBeNull();
  });

  test("invalidResult refuses text spliced past a field's length limit", () => {
    const doc = sceneDoc({ a: placement({ name: "x".repeat(256) }) });
    const ops: Ops = [{ p: ["widgets", "a", "name", 0], si: "y" }];
    expect(invalidOps(ops)).toBeNull();
    expect(invalidResult(applyOps(doc, ops), ops)).toBe("placement a would not be valid");
    expect(invalidResult(doc, [{ p: ["widgets", "a", "x"], od: 0, oi: 1 }])).toBeNull();
  });
});

describe("diffDocuments makes only shapes invalidOps accepts", () => {
  const base = sceneDoc({
    a: placement({ name: "Title", z: "a0000", settings: { text: "hello", font: { size: 12 }, items: [1, 2] } }),
    b: placement({ z: "a0001" }),
  });
  base.layout.backgroundColor = "#000000";

  const canvasEdits: Array<[string, (doc: SceneDocument) => void]> = [
    ["move", (d) => Object.assign(d.widgets.a!, { x: 40, y: 60 })],
    ["resize", (d) => Object.assign(d.widgets.a!, { width: 300, height: 90 })],
    ["rotate", (d) => Object.assign(d.widgets.a!, { rotation: 45 })],
    ["fade", (d) => Object.assign(d.widgets.a!, { opacity: 0.25 })],
    ["hide", (d) => Object.assign(d.widgets.a!, { visible: false })],
    ["lock", (d) => Object.assign(d.widgets.a!, { locked: true })],
    ["rename", (d) => Object.assign(d.widgets.a!, { name: "Main title" })],
    ["restack", (d) => Object.assign(d.widgets.a!, { z: "a0001" }) && Object.assign(d.widgets.b!, { z: "a0000" })],
    ["change a setting's text", (d) => Object.assign(d.widgets.a!.settings, { text: "hello there" })],
    ["change a nested setting", (d) => Object.assign(d.widgets.a!.settings, { font: { size: 14, weight: "bold" } })],
    ["change a list setting", (d) => Object.assign(d.widgets.a!.settings, { items: [1, 2, 3] })],
    ["remove a setting", (d) => delete d.widgets.a!.settings.text],
    ["change the background", (d) => Object.assign(d.layout, { backgroundColor: "#ffffff" })],
    ["resize the canvas", (d) => Object.assign(d.layout, { width: 1280, height: 720 })],
    ["add a placement", (d) => Object.assign(d.widgets, { c: placement({ z: "a0002" }) })],
    ["remove a placement", (d) => delete d.widgets.b],
    ["swap a placement's widget", (d) => Object.assign(d.widgets.a!, { widget: "other.widget" })],
  ];
  for (const [name, change] of canvasEdits) {
    test(name, () => {
      const to = structuredClone(base);
      change(to);
      const ops = diffDocuments(base, to);
      expect(ops.length).toBeGreaterThan(0);
      expect(invalidOps(ops)).toBeNull();
      const applied = applyOps(base, ops);
      expect(sameValue(applied, to)).toBe(true);
      expect(invalidResult(applied, ops)).toBeNull();
      expect(sameValue(applyOps(applied, invertOps(ops)), base)).toBe(true);
    });
  }

  test("z and the widget id are replaced whole, never spliced", () => {
    const to = structuredClone(base);
    to.widgets.a!.z = "a0002";
    expect(diffDocuments(base, to)).toEqual([{ p: ["widgets", "a", "z"], od: "a0000", oi: "a0002" }]);
  });

  test("a layout value is replaced whole", () => {
    const to = structuredClone(base);
    to.layout.backgroundColor = "#000001";
    expect(diffDocuments(base, to)).toEqual([{ p: ["layout", "backgroundColor"], od: "#000000", oi: "#000001" }]);
  });

  test("a placement with a field removed is replaced whole, which is refused", () => {
    const to = structuredClone(base);
    delete (to.widgets.a as unknown as Record<string, unknown>).rotation;
    const ops = diffDocuments(base, to);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.p).toEqual(["widgets", "a"]);
    expect(invalidOps(ops)).toBe("a placement must be inserted whole");
  });
});
