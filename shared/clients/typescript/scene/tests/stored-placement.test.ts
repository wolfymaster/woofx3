import { describe, expect, it } from "bun:test";
import {
  moduleIdOfCanonicalId,
  parseWidgetCanonicalId,
  placementOfStored,
  stableCanonicalId,
  stableModuleKey,
  storedOfPlacement,
} from "../model";

describe("placementOfStored and storedOfPlacement", () => {
  const stored = {
    id: "w1",
    widgetCanonicalId: "woofx3:widget:text",
    name: "Title",
    position: { x: 10, y: 20 },
    size: { width: 300, height: 80 },
    rotation: 5,
    opacity: 0.5,
    zIndex: 0,
    locked: true,
    visible: false,
    settings: { text: "hi" },
    transitionIn: { kind: "fade" },
  };

  it("round-trips an entry, keeping fields the placement does not model", () => {
    const placement = placementOfStored(stored, "a0");
    expect(placement).toMatchObject({ widget: "woofx3:widget:text", x: 10, width: 300, opacity: 0.5, locked: true });
    expect(placement.extra).toEqual({ transitionIn: { kind: "fade" } });
    expect(storedOfPlacement("w1", placement, 0)).toEqual(stored);
  });

  it("reads missing or out-of-range fields as the placement's defaults", () => {
    const placement = placementOfStored(
      { position: { x: Number.NaN, width: 40 }, opacity: 3, name: "x".repeat(500), settings: [1], visible: "no" },
      "a0"
    );
    expect(placement).toMatchObject({
      widget: "",
      x: 0,
      width: 40,
      opacity: 1,
      name: "",
      settings: {},
      visible: true,
    });
  });

  it("reads the older widgetDefinitionRef and writes it back as widgetCanonicalId", () => {
    const placement = placementOfStored({ widgetDefinitionRef: "woofx3:widget:image" }, "a0");
    expect(placement.widget).toBe("woofx3:widget:image");
    expect(placement.extra).toEqual({});
    expect(storedOfPlacement("w1", placement, 0).widgetCanonicalId).toBe("woofx3:widget:image");
  });
});

describe("canonical widget ids", () => {
  it("split on the last :widget: marker", () => {
    expect(parseWidgetCanonicalId("woofx3:widget:media_alert")).toEqual({
      moduleKey: "woofx3",
      manifestId: "media_alert",
    });
    expect(parseWidgetCanonicalId("spotify:1.0.0:df18e02:widget:now_playing")?.moduleKey).toBe("spotify:1.0.0:df18e02");
    expect(parseWidgetCanonicalId("my:widget:module:widget:foo")?.moduleKey).toBe("my:widget:module");
  });

  it("refuse ids without a module key or manifest id", () => {
    for (const id of ["no-separator-here", ":widget:foo", "mod:widget:", ""]) {
      expect(parseWidgetCanonicalId(id)).toBeNull();
    }
  });

  it("make the module key stable by dropping its version segments", () => {
    expect(stableModuleKey("woofx3")).toBe("woofx3");
    expect(stableModuleKey("spotify:1.0.0:df18e02")).toBe("spotify");
    expect(stableCanonicalId("spotify:1.0.0:df18e02:widget:now_playing")).toBe("spotify:widget:now_playing");
    expect(moduleIdOfCanonicalId("spotify:1.0.0:abc:widget:x")).toBe("spotify");
    expect(moduleIdOfCanonicalId("lottie")).toBeNull();
  });
});
