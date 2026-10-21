import { describe, expect, it } from "bun:test";
import { parseSceneConfig } from "../../contract/scene-config";

const placement = {
  id: "p1",
  widgetCanonicalId: "woofx3:widget:text",
  moduleId: "woofx3",
  position: { x: 0, y: 0, width: 100, height: 50 },
  settings: {},
  hostsSurface: "",
  frameUrl: "/frames/woofx3/text?v=1",
};
const body = (widgets: unknown[]) => ({ scene: { id: "s1", name: "Main", layout: {}, widgets } });

describe("parseSceneConfig", () => {
  it("reads a scene whose placements the page can place", () => {
    expect(parseSceneConfig(body([placement]))?.widgets).toEqual([placement]);
  });

  it("refuses a scene with a placement the page could not place", () => {
    const { position: _position, ...noPosition } = placement;
    for (const broken of [
      null,
      "p1",
      noPosition,
      { ...placement, id: 7 },
      { ...placement, settings: [] },
      { ...placement, frameUrl: undefined },
      { ...placement, position: { x: 0, y: 0, width: "100", height: 50 } },
    ]) {
      expect(parseSceneConfig(body([placement, broken]))).toBeNull();
    }
  });
});
