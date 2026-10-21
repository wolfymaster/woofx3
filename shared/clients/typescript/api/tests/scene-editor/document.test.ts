import { afterEach, describe, expect, test } from "bun:test";
import { STRICT_REGISTRY, TOLERANT_REGISTRY, withoutWidget } from "../../../scene/model";
import {
  applyOps,
  composeOps,
  diffDocuments,
  invalidExternalOps,
  invalidOps,
  invalidResult,
  invertOps,
  isSceneDocument,
  type Json0Component,
  KEY_MAX_LENGTH,
  type Ops,
  parseSnapshot,
  type SceneDocument,
  sameValue,
  transformOps,
} from "../../scene-editor/document";
import { parseServerMessage } from "../../scene-editor/protocol";
import { behavior, placement, sceneDoc } from "./test-support";

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
    expect(invalidOps([{ p: ["other"], oi: 1 }])).toBe("a path must start at a layout key, a placement or a behavior");
    expect(invalidOps([{ p: ["widgets", "a"], oi: { widget: "x" } }])).toContain("a placement must be inserted whole");
    expect(invalidOps([{ p: ["widgets", "a", "colour"], od: 1, oi: 2 }])).toBe("a placement has no field colour");
    expect(invalidOps([{ p: ["widgets", "a", "opacity"], od: 1, oi: 2 }])).toBe("invalid placement opacity");
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

  test("the canvas size stays a positive number and is never removed", () => {
    expect(invalidOps([{ p: ["layout", "height"], od: 1080, oi: 720 }])).toBeNull();
    expect(invalidOps([{ p: ["layout", "width"], od: 1920, oi: 0 }])).toBe("a canvas width is a positive number");
    expect(invalidOps([{ p: ["layout", "height"], oi: -1 }])).toBe("a canvas height is a positive number");
    expect(invalidOps([{ p: ["layout", "width"], od: 1920, oi: "1280" }])).toBe("a canvas width is a positive number");
    expect(invalidOps([{ p: ["layout", "width"], od: 1920 }])).toBe("a canvas keeps its width");
    expect(invalidOps([{ p: ["layout", "backgroundColor"], oi: 0 }])).toBe("a canvas backgroundColor is a string");
    expect(invalidOps([{ p: ["layout", "backgroundColor"], od: "#000" }])).toBeNull();
  });

  test("invalidResult refuses text spliced past a field's length limit", () => {
    const doc = sceneDoc({ a: placement({ name: "x".repeat(256) }) });
    const ops: Ops = [{ p: ["widgets", "a", "name", 0], si: "y" }];
    expect(invalidOps(ops)).toBeNull();
    expect(invalidResult(applyOps(doc, ops), ops)).toBe("placement a would not be valid: invalid placement name");
    expect(invalidResult(doc, [{ p: ["widgets", "a", "x"], od: 0, oi: 1 }])).toBeNull();
  });
});

describe("keys that reach the prototype chain", () => {
  // Components are parsed from JSON, as they arrive over the wire, so a
  // `__proto__` key in a value is an own property rather than a prototype.
  const component = (json: string): Json0Component => JSON.parse(json) as Json0Component;
  const doc = (): SceneDocument =>
    sceneDoc({ a: placement({ settings: { font: {} } }) }, { b: behavior({ params: { phase: "in" } }) });
  const prototypeOf = (value: object) => Object.getPrototypeOf(value) as Record<string, unknown>;
  const polluted = () => ({}) as Record<string, unknown>;

  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).polluted;
    delete (Object.prototype.toString as unknown as Record<string, unknown>).polluted;
  });

  const refused: Array<[string, Json0Component]> = [
    ["a settings key", { p: ["widgets", "a", "settings", "__proto__", "polluted"], oi: "yes" }],
    ["a nested settings key", { p: ["widgets", "a", "settings", "font", "__proto__", "polluted"], oi: "yes" }],
    [
      "a settings key reaching a constructor",
      { p: ["widgets", "a", "settings", "constructor", "prototype", "polluted"], oi: "yes" },
    ],
    ["a params key", { p: ["behaviors", "b", "params", "__proto__", "polluted"], oi: "yes" }],
    ["a layout key", { p: ["layout", "__proto__"], oi: { polluted: "yes" } }],
    ["a placement id", { p: ["widgets", "__proto__"], oi: placement() }],
    ["a behavior id", { p: ["behaviors", "constructor"], oi: behavior() }],
    ["a placement field", { p: ["widgets", "a", "constructor"], od: {}, oi: {} }],
  ];
  for (const [name, op] of refused) {
    test(`refuses __proto__, prototype and constructor as ${name}, and applying it changes no prototype`, () => {
      expect(invalidOps([op])).not.toBeNull();
      expect(() => applyOps(doc(), [op])).toThrow("reserved key");
      expect(polluted().polluted).toBeUndefined();
    });
  }

  test("refuses a value holding an own __proto__ key, at any depth", () => {
    const shallow = component('{"p":["widgets","a","settings","font"],"oi":{"__proto__":{"polluted":"yes"}}}');
    const deep = component('{"p":["widgets","b"],"oi":{"settings":{"list":[{"__proto__":{"polluted":"yes"}}]}}}');
    expect(invalidOps([shallow])).toBe('a value may not hold the key "__proto__"');
    expect(invalidOps([deep])).toBe('a value may not hold the key "__proto__"');
    expect(invalidOps([{ p: ["widgets", "a", "settings", "font"], oi: { constructor: 1 } }])).toBe(
      'a value may not hold the key "constructor"'
    );
    const applied = applyOps(doc(), [shallow]);
    expect(prototypeOf(applied.widgets.a!.settings.font as object)).toBe(Object.prototype);
    expect(polluted().polluted).toBeUndefined();
  });

  test("refuses inputs holding an own __proto__ key", () => {
    const op = component('{"p":["inputs"],"oi":[{"id":"x","type":"text","label":"X","__proto__":{"polluted":1}}]}');
    expect(invalidExternalOps([op])).toBe('a value may not hold the key "__proto__"');
  });

  const badNames: Array<[string, Json0Component, string]> = [
    ["a layout key with a space", { p: ["layout", "bad key"], oi: 1 }, "a layout key is"],
    ["an empty layout key", { p: ["layout", ""], oi: 1 }, "a layout key is"],
    ["a placement id with a slash", { p: ["widgets", "a/b"], oi: placement() }, "a placement id is"],
    [
      "a placement id too long",
      { p: ["widgets", "a".repeat(KEY_MAX_LENGTH + 1)], oi: placement() },
      "a placement id is",
    ],
    [
      "a settings key too long",
      { p: ["widgets", "a", "settings", "k".repeat(KEY_MAX_LENGTH + 1)], oi: 1 },
      "a key in settings is",
    ],
    ["an empty settings key", { p: ["widgets", "a", "settings", ""], oi: 1 }, "a key in settings is"],
  ];
  for (const [name, op, message] of badNames) {
    test(`refuses ${name}`, () => {
      expect(invalidOps([op])).toStartWith(message);
    });
  }

  const accepted: Array<[string, Json0Component]> = [
    ["a generated placement id", { p: ["widgets", "w-0a1b2c3d"], oi: placement() }],
    ["an id with dots, colons and underscores", { p: ["behaviors", "b_1.x:y"], oi: behavior({ target: "a" }) }],
    ["a layout key", { p: ["layout", "backgroundColor"], oi: "#000" }],
    ["a settings key with spaces", { p: ["widgets", "a", "settings", "font colour"], oi: "red" }],
    ["a settings key at the length limit", { p: ["widgets", "a", "settings", "k".repeat(KEY_MAX_LENGTH)], oi: 1 }],
    ["a nested settings key", { p: ["widgets", "a", "settings", "font", "size"], oi: 12 }],
    ["a settings value holding objects and lists", { p: ["widgets", "a", "settings", "list"], oi: [{ a: [1] }] }],
  ];
  for (const [name, op] of accepted) {
    test(`accepts and applies ${name}`, () => {
      expect(invalidOps([op])).toBeNull();
      expect(() => applyOps(doc(), [op])).not.toThrow();
    });
  }

  test("applying refuses a path through an inherited property that invalidOps cannot see", () => {
    const op: Json0Component = { p: ["widgets", "a", "settings", "toString", "polluted"], oi: "yes" };
    expect(invalidOps([op])).toBeNull();
    expect(() => applyOps(doc(), [op])).toThrow("leaves the document");
    expect((Object.prototype.toString as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("applying walks each component against the document the earlier ones made", () => {
    const ops: Ops = [
      { p: ["widgets", "a", "settings", "theme"], oi: {} },
      { p: ["widgets", "a", "settings", "theme", "accent"], oi: "red" },
    ];
    expect(applyOps(doc(), ops).widgets.a!.settings).toEqual({ font: {}, theme: { accent: "red" } });
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
    expect(invalidOps(ops)).toContain("a placement must be inserted whole");
  });
});

describe("behaviors", () => {
  const base = sceneDoc(
    { a: placement(), b: placement({ z: "a0001" }) },
    {
      in: behavior(),
      out: behavior({
        kind: "slide",
        order: "a1",
        timing: { anchor: "exit", offsetMs: 0, durationMs: 300, easing: "ease-in" },
        params: { phase: "out", direction: "up" },
      }),
    }
  );

  const edits: Array<[string, (doc: SceneDocument) => void, Ops | null]> = [
    [
      "add a behavior",
      (d) => Object.assign(d.behaviors, { pulse: behavior({ type: "effect", kind: "pulse", params: {} }) }),
      null,
    ],
    ["remove a behavior", (d) => delete d.behaviors.in, [{ p: ["behaviors", "in"], od: behavior() }]],
    [
      "change its kind",
      (d) => Object.assign(d.behaviors.in!, { kind: "zoom" }),
      [{ p: ["behaviors", "in", "kind"], od: "fade", oi: "zoom" }],
    ],
    [
      "retarget it",
      (d) => Object.assign(d.behaviors.in!, { target: "b" }),
      [{ p: ["behaviors", "in", "target"], od: "a", oi: "b" }],
    ],
    [
      "reorder it",
      (d) => Object.assign(d.behaviors.in!, { order: "a2" }),
      [{ p: ["behaviors", "in", "order"], od: "a0", oi: "a2" }],
    ],
    [
      "delay it",
      (d) => Object.assign(d.behaviors.in!.timing, { offsetMs: 500 }),
      [{ p: ["behaviors", "in", "timing", "offsetMs"], od: 0, oi: 500 }],
    ],
    [
      "anchor it to another widget",
      (d) => Object.assign(d.behaviors.in!.timing, { anchor: "complete", node: "b" }),
      [
        { p: ["behaviors", "in", "timing", "anchor"], od: "enter", oi: "complete" },
        { p: ["behaviors", "in", "timing", "node"], oi: "b" },
      ],
    ],
    [
      "change a param",
      (d) => Object.assign(d.behaviors.out!.params, { direction: "left" }),
      [{ p: ["behaviors", "out", "params", "direction"], od: "up", oi: "left" }],
    ],
    [
      "remove a param",
      (d) => delete d.behaviors.out!.params.direction,
      [{ p: ["behaviors", "out", "params", "direction"], od: "up" }],
    ],
    ["change its type", (d) => Object.assign(d.behaviors.in!, { type: "effect", kind: "pulse", params: {} }), null],
  ];
  for (const [name, change, expected] of edits) {
    test(name, () => {
      const to = structuredClone(base);
      change(to);
      const ops = diffDocuments(base, to);
      if (expected !== null) {
        expect(ops).toEqual(expected);
      }
      expect(invalidOps(ops)).toBeNull();
      const applied = applyOps(base, ops);
      expect(sameValue(applied, to)).toBe(true);
      expect(invalidResult(applied, ops)).toBeNull();
      expect(sameValue(applyOps(applied, invertOps(ops)), base)).toBe(true);
    });
  }

  test("a change of type replaces the behavior whole", () => {
    const to = structuredClone(base);
    to.behaviors.in = behavior({ type: "effect", kind: "pulse", params: {} });
    expect(diffDocuments(base, to)).toEqual([{ p: ["behaviors", "in"], od: base.behaviors.in, oi: to.behaviors.in }]);
  });

  const refused: Array<[string, unknown]> = [
    ["replacing every behavior", { p: ["behaviors"], od: {}, oi: {} }],
    ["a behavior inserted without its fields", { p: ["behaviors", "x"], oi: { type: "transition" } }],
    ["a behavior of a type the engine does not know", { p: ["behaviors", "x"], oi: behavior({ type: "sound" }) }],
    ["its type replaced alone", { p: ["behaviors", "in", "type"], od: "transition", oi: "effect" }],
    ["a field it does not have", { p: ["behaviors", "in", "speed"], od: 1, oi: 2 }],
    ["text spliced into its kind", { p: ["behaviors", "in", "kind", 0], si: "x" }],
    ["text spliced into a param", { p: ["behaviors", "in", "params", "phase", 0], si: "x" }],
    ["a param path into a list", { p: ["behaviors", "in", "params", "steps", 0], oi: 1 }],
    ["a required timing field removed", { p: ["behaviors", "in", "timing", "anchor"], od: "enter" }],
    ["a timing field inserted", { p: ["behaviors", "in", "timing", "pace"], oi: 1 }],
    ["an invalid timing value", { p: ["behaviors", "in", "timing", "easing"], od: "ease-out", oi: "springy" }],
    ["a path deeper than a timing field", { p: ["behaviors", "in", "timing", "anchor", "x"], od: 1, oi: 2 }],
    ["the inputs replaced", { p: ["inputs"], oi: [] }],
  ];
  for (const [name, component] of refused) {
    test(`refuses ${name}`, () => {
      expect(invalidOps([component])).not.toBeNull();
    });
  }

  test("a param valid alone but not for the behavior's kind is refused on the result, by the engine only", () => {
    const ops: Ops = [{ p: ["behaviors", "in", "params", "direction"], oi: "left" }];
    expect(invalidOps(ops)).toBeNull();
    const applied = applyOps(base, ops);
    expect(invalidResult(applied, ops)).toContain("behavior in would not be valid");
    expect(invalidResult(applied, ops, TOLERANT_REGISTRY)).toBeNull();
  });

  test("a behavior of an unknown type is refused by the engine and kept by an editor", () => {
    const future = { ...behavior(), type: "sound", kind: "chime", params: { volume: 1 } };
    const ops: Ops = [{ p: ["behaviors", "chime"], oi: future }];
    expect(invalidOps(ops, STRICT_REGISTRY)).toContain("unknown behavior type");
    expect(invalidOps(ops, TOLERANT_REGISTRY)).toBeNull();
  });

  test("an editor's edit around a behavior it does not know leaves that behavior as it was", () => {
    const doc = structuredClone(base);
    (doc.behaviors as Record<string, unknown>).chime = { type: "sound", kind: "chime", target: "a", volume: 1 };
    const to = structuredClone(doc);
    to.behaviors.in!.order = "a5";
    const ops = diffDocuments(doc, to, TOLERANT_REGISTRY);
    expect(ops).toEqual([{ p: ["behaviors", "in", "order"], od: "a0", oi: "a5" }]);
    expect(invalidResult(applyOps(doc, ops), ops, TOLERANT_REGISTRY)).toBeNull();
  });

  test("deleting a widget removes its behaviors in the same ops", () => {
    const ops = diffDocuments(base, withoutWidget(base, "a"));
    expect(ops.map((component) => component.p)).toEqual([
      ["widgets", "a"],
      ["behaviors", "in"],
      ["behaviors", "out"],
    ]);
    expect(invalidOps(ops)).toBeNull();
    const applied = applyOps(base, ops);
    expect(applied.behaviors).toEqual({});
    expect(Object.keys(applied.widgets)).toEqual(["b"]);
  });

  test("a change to the inputs is diffed, and refused", () => {
    const to = { ...structuredClone(base), inputs: [{ id: "user", label: "User", type: "text" }] };
    const ops = diffDocuments(base, to);
    expect(ops).toEqual([{ p: ["inputs"], oi: to.inputs }]);
    expect(invalidOps(ops)).not.toBeNull();
  });
});

describe("documents from before behaviors", () => {
  const legacy = { layout: { width: 1920 }, widgets: { a: placement() } };

  test("are not scene documents until normalized", () => {
    expect(isSceneDocument(legacy)).toBe(false);
    expect(isSceneDocument({ ...legacy, behaviors: {} })).toBe(true);
  });

  test("parseSnapshot gives them an empty behaviors collection", () => {
    const snapshot = parseSnapshot({ sceneId: "s", name: "S", seq: 1, doc: legacy, meta: {} });
    expect(snapshot?.doc).toEqual({ ...legacy, behaviors: {} });
    expect(parseSnapshot({ sceneId: "s", name: "S", seq: 1, doc: { ...legacy, behaviors: [] }, meta: {} })).toBeNull();
  });

  test("a welcome snapshot gives both versions an empty behaviors collection", () => {
    const message = parseServerMessage({
      type: "welcome",
      protocol: 2,
      features: [],
      clientId: "me",
      last: null,
      diverged: false,
      snapshot: {
        v: 0,
        id: "",
        docs: { draft: legacy, published: legacy },
        meta: { draft: {}, published: {} },
        hasDraft: false,
        name: "S",
      },
    });
    expect(message?.type).toBe("welcome");
    if (message?.type !== "welcome" || !("snapshot" in message)) {
      throw new Error("not a snapshot welcome");
    }
    expect(message.snapshot.docs.draft.behaviors).toEqual({});
    expect(message.snapshot.docs.published.behaviors).toEqual({});
  });
});
