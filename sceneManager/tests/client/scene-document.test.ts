import { describe, expect, it } from "bun:test";
import {
  type SceneDocument,
  type SceneSnapshot,
  applyOps,
  configOfSnapshot,
  diffDocuments,
  mergeMeta,
  parseSnapshot,
  stackOrder,
  zKey,
} from "../../public/scene-manager/scene-document";

function placement(z: string, settings: Record<string, unknown> = {}) {
  return {
    widget: "woofx3:widget:text",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    visible: true,
    z,
    settings,
    name: "Text",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
  };
}

function doc(widgets: SceneDocument["widgets"], layout: Record<string, unknown> = {}): SceneDocument {
  return { layout, widgets };
}

describe("diffDocuments + applyOps", () => {
  const cases: Array<[string, SceneDocument, SceneDocument]> = [
    ["a move", doc({ a: placement("a0") }), doc({ a: { ...placement("a0"), x: 40, y: 10 } })],
    ["hiding", doc({ a: placement("a0") }), doc({ a: { ...placement("a0"), visible: false } })],
    [
      "a setting added, changed and removed",
      doc({ a: placement("a0", { color: "#fff", old: 1 }) }),
      doc({ a: placement("a0", { color: "#000", size: 3 }) }),
    ],
    [
      "nested settings and arrays",
      doc({ a: placement("a0", { goals: [1, 2], style: { a: 1 } }) }),
      doc({ a: placement("a0", { goals: [1, 2, 3], style: { a: 2, b: 1 } }) }),
    ],
    ["a widget added and one removed", doc({ a: placement("a0") }), doc({ b: placement("a1") })],
    ["the background", doc({}, { backgroundColor: "#000" }), doc({}, { backgroundColor: "transparent" })],
    [
      "text edited in the middle",
      doc({ a: placement("a0", { text: "Thanks for the raid!" }) }),
      doc({ a: placement("a0", { text: "Thanks for the big raid, Wolfy!" }) }),
    ],
  ];

  for (const [name, from, to] of cases) {
    it(`turns one document into the other: ${name}`, () => {
      expect(applyOps(from, diffDocuments(from, to))).toEqual(to);
    });
  }

  it("sends a text edit as one splice, not the whole text", () => {
    const from = doc({ a: placement("a0", { text: "Thanks for the raid!" }) });
    const to = doc({ a: placement("a0", { text: "Thanks for the big raid!" }) });
    expect(diffDocuments(from, to)).toEqual([{ p: ["widgets", "a", "settings", "text", 15], si: "big " }]);
  });

  it("sends nothing for documents that only differ in key order", () => {
    const from = doc({ a: placement("a0", { b: 1, a: 2 }) });
    const to = doc({ a: placement("a0", { a: 2, b: 1 }) });
    expect(diffDocuments(from, to)).toEqual([]);
  });

  it("leaves the document it was given as it was", () => {
    const from = doc({ a: placement("a0") });
    const before = structuredClone(from);
    applyOps(from, [{ p: ["widgets", "a", "x"], od: 0, oi: 9 }]);
    expect(from).toEqual(before);
  });
});

describe("stacking", () => {
  it("keys sort in stacking order past ten and past thirty-six", () => {
    const keys = [0, 1, 9, 10, 35, 36, 1000].map(zKey);
    expect([...keys].sort()).toEqual(keys);
  });

  it("orders placements bottom first", () => {
    expect(stackOrder(doc({ top: placement("a0002"), bottom: placement("a0000"), mid: placement("a0001") }))).toEqual([
      "bottom",
      "mid",
      "top",
    ]);
  });
});

describe("configOfSnapshot", () => {
  const snapshot: SceneSnapshot = {
    sceneId: "s1",
    name: "Main",
    seq: 2,
    doc: doc(
      { b: { ...placement("a0001"), visible: false }, a: placement("a0000", { text: "hi" }) },
      { backgroundColor: "#000" }
    ),
    meta: {
      a: { moduleId: "woofx3", hostsSurface: "", frameUrl: "/frames/woofx3/text?v=1", linkedResources: { t: "x" } },
      b: { moduleId: "woofx3", hostsSurface: "", frameUrl: "/frames/woofx3/text?v=1", linkedResources: {} },
    },
  };

  it("builds the page's config in stacking order", () => {
    const config = configOfSnapshot(snapshot);
    expect(config.layout).toEqual({ backgroundColor: "#000" });
    expect(config.widgets.map((w) => w.id)).toEqual(["a", "b"]);
    expect(config.widgets[0]).toEqual({
      id: "a",
      widgetCanonicalId: "woofx3:widget:text",
      moduleId: "woofx3",
      position: { x: 0, y: 0, width: 100, height: 50 },
      settings: { text: "hi" },
      hostsSurface: "",
      frameUrl: "/frames/woofx3/text?v=1",
      linkedResources: { t: "x" },
      visible: true,
    });
    expect(config.widgets[1]!.visible).toBe(false);
  });

  it("leaves out a placement whose meta has not arrived", () => {
    const { b: _b, ...meta } = snapshot.meta;
    expect(configOfSnapshot({ ...snapshot, meta }).widgets.map((w) => w.id)).toEqual(["a"]);
  });

  it("round-trips through parseSnapshot, which refuses anything else", () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ sceneId: "s1", seq: "2", doc: {}, meta: {} })).toBeNull();
  });
});

describe("mergeMeta", () => {
  it("adds, replaces and removes", () => {
    const m = { moduleId: "m", hostsSurface: "", frameUrl: "/f", linkedResources: {} };
    expect(mergeMeta({ a: m, b: m }, { a: { ...m, frameUrl: "/g" }, b: null, c: m })).toEqual({
      a: { ...m, frameUrl: "/g" },
      c: m,
    });
  });
});
