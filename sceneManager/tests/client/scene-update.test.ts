import { describe, expect, it } from "bun:test";
import { sameValue } from "@woofx3/scene/model";
import { parseSceneConfig, type WidgetPlacementConfig } from "../../contract/scene-config";
import { planSceneUpdate } from "../../public/scene-manager/scene-update";

function placement(id: string, overrides: Partial<WidgetPlacementConfig> = {}): WidgetPlacementConfig {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:counter",
    moduleId: "woofx3",
    position: { x: 0, y: 0, width: 100, height: 50 },
    settings: { label: "Deaths", style: { color: "#fff", size: 12 } },
    hostsSurface: "",
    frameUrl: "/frames/woofx3/counter?v=abc",
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

  it("keeps the frame of a widget whose settings changed: the page hands them over", () => {
    const plan = planSceneUpdate(
      [placement("a"), placement("b")],
      [placement("a"), placement("b", { settings: { label: "Wins", style: { color: "#fff", size: 12 } } })]
    );
    expect(plan.remove).toEqual([]);
    expect(plan.replace).toEqual([]);
    expect(plan.place.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("swaps the frame of a placement whose document changed: a new version or theme", () => {
    const plan = planSceneUpdate([placement("a")], [placement("a", { frameUrl: "/frames/woofx3/counter?v=def" })]);
    expect(plan.remove).toEqual([]);
    expect(plan.replace.map((p) => p.id)).toEqual(["a"]);
  });

  it("swaps the frame of a placement pointed at another widget", () => {
    const plan = planSceneUpdate([placement("a")], [placement("a", { widgetCanonicalId: "woofx3:widget:timer" })]);
    expect(plan.replace.map((p) => p.id)).toEqual(["a"]);
    expect(plan.mount).toEqual([]);
  });

  it("mounts an alert area again for any change of settings, since the page draws it from them", () => {
    const area = placement("a", { hostsSurface: "alert", frameUrl: "" });
    const plan = planSceneUpdate([area], [{ ...area, settings: { label: "Raids" } }]);
    expect(plan.replace.map((p) => p.id)).toEqual(["a"]);
  });

  it("removes placements gone from the scene and mounts new ones", () => {
    const plan = planSceneUpdate([placement("a"), placement("b")], [placement("b"), placement("c")]);
    expect(plan.remove).toEqual(["a"]);
    expect(plan.mount.map((p) => p.id)).toEqual(["c"]);
    expect(plan.place.map((p) => p.id)).toEqual(["b"]);
    expect(plan.replace).toEqual([]);
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
