import { describe, expect, test } from "bun:test";
import {
  applyOps,
  composeOps,
  diffDocuments,
  invalidOps,
  invertOps,
  MAX_OPS_BYTES,
  type Ops,
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
    expect(invalidOps([{ p: ["other"] }])).toBe("a path must start at the layout or a placement");
    expect(invalidOps([{ p: ["widgets", "a"], oi: { widget: "x" } }])).toBe("a placement must be inserted whole");
    expect(invalidOps([{ p: ["widgets", "a", "colour"], oi: 1 }])).toBe("a placement has no field colour");
    expect(invalidOps([{ p: ["widgets", "a", "opacity"], oi: 2 }])).toBe("invalid opacity");
  });

  test("refuses ops over the size limit", () => {
    expect(invalidOps([{ p: ["layout", "note"], oi: "x".repeat(MAX_OPS_BYTES) }])).toBe("ops too large");
  });
});
