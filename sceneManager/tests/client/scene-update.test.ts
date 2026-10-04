import { describe, expect, it } from "bun:test";
import {
  parseSceneConfig,
  planSceneUpdate,
  sameValue,
  type WidgetPlacementConfig,
} from "../../public/scene-manager/scene-update";

function placement(id: string, overrides: Partial<WidgetPlacementConfig> = {}): WidgetPlacementConfig {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:counter",
    moduleId: "woofx3",
    position: { x: 0, y: 0, width: 100, height: 50 },
    settings: { label: "Deaths", style: { color: "#fff", size: 12 } },
    hostsSurface: "",
    frameUrl: `/scene/s1/widget/${id}`,
    ...overrides,
  };
}

describe("planSceneUpdate", () => {
  it("only re-places a widget that moved or was resized", () => {
    const plan = planSceneUpdate(
      [placement("a")],
      [placement("a", { position: { x: 40, y: 10, width: 200, height: 80 } })]
    );
    expect(plan.remove).toEqual([]);
    expect(plan.mount).toEqual([]);
    expect(plan.place.map((p) => p.position)).toEqual([{ x: 40, y: 10, width: 200, height: 80 }]);
  });

  it("mounts again only the widget whose settings changed", () => {
    const plan = planSceneUpdate(
      [placement("a"), placement("b")],
      [placement("a"), placement("b", { settings: { label: "Wins", style: { color: "#fff", size: 12 } } })]
    );
    expect(plan.remove).toEqual(["b"]);
    expect(plan.mount.map((p) => p.id)).toEqual(["b"]);
    expect(plan.place.map((p) => p.id)).toEqual(["a"]);
  });

  it("treats settings saved with their keys in another order as unchanged", () => {
    const plan = planSceneUpdate(
      [placement("a")],
      [placement("a", { settings: { style: { size: 12, color: "#fff" }, label: "Deaths" } })]
    );
    expect(plan.mount).toEqual([]);
  });

  it("keeps a frame when only its source changes, as when a save matches the draft on screen", () => {
    const plan = planSceneUpdate(
      [placement("a", { frameUrl: "/scene/s1/draft-widget/a?draft=abc" })],
      [placement("a")]
    );
    expect(plan.mount).toEqual([]);
    expect(plan.place.map((p) => p.id)).toEqual(["a"]);
  });

  it("mounts again a placement pointed at another widget", () => {
    const plan = planSceneUpdate([placement("a")], [placement("a", { widgetCanonicalId: "woofx3:widget:timer" })]);
    expect(plan.remove).toEqual(["a"]);
    expect(plan.mount.map((p) => p.id)).toEqual(["a"]);
  });

  it("removes placements gone from the scene and mounts new ones", () => {
    const plan = planSceneUpdate([placement("a"), placement("b")], [placement("b"), placement("c")]);
    expect(plan.remove).toEqual(["a"]);
    expect(plan.mount.map((p) => p.id)).toEqual(["c"]);
    expect(plan.place.map((p) => p.id)).toEqual(["b"]);
  });

  it("orders the stack by the saved scene, bottom first", () => {
    const plan = planSceneUpdate([placement("a"), placement("b")], [placement("b"), placement("a")]);
    expect(plan.order).toEqual(["b", "a"]);
    expect(plan.mount).toEqual([]);
  });
});

describe("sameValue", () => {
  it("compares arrays by position and objects by key", () => {
    expect(sameValue([1, { a: 1 }], [1, { a: 1 }])).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue({ a: [] }, { a: {} })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
  });
});

describe("parseSceneConfig", () => {
  it("reads the scene out of a config response", () => {
    const scene = { id: "s1", name: "Main", layout: {}, widgets: [placement("a")] };
    expect(parseSceneConfig({ scene })).toEqual(scene);
  });

  it("is null for anything that is not a scene", () => {
    expect(parseSceneConfig({ scene: null })).toBeNull();
    expect(parseSceneConfig({ error: "invalid_session" })).toBeNull();
    expect(parseSceneConfig({ scene: { id: "s1", layout: {} } })).toBeNull();
    expect(parseSceneConfig("nope")).toBeNull();
  });
});
