import { describe, expect, it } from "bun:test";
import { PlacementVisibility } from "../../src/scene/placement-visibility";
import { OverlayHost } from "../../src/scene/scene-host";
import { OverlayTokenResolver } from "../../src/scene/token-resolver";

describe("PlacementVisibility", () => {
  it("shows each placement as saved until a workflow changes it", () => {
    const visibility = new PlacementVisibility();
    expect(visibility.visibleOf("scene-1", { id: "a", hidden: false })).toBe(true);
    expect(visibility.visibleOf("scene-1", { id: "b", hidden: true })).toBe(false);
  });

  it("keeps a workflow's change per scene and placement", () => {
    const visibility = new PlacementVisibility();
    visibility.set("scene-1", { id: "a", hidden: true }, true);
    expect(visibility.visibleOf("scene-1", { id: "a", hidden: true })).toBe(true);
    expect(visibility.visibleOf("scene-2", { id: "a", hidden: true })).toBe(false);
    expect(visibility.visibleOf("scene-1", { id: "b", hidden: true })).toBe(false);
  });

  it("drops a workflow's change once the saved default it was made against changes", () => {
    const visibility = new PlacementVisibility();
    visibility.set("scene-1", { id: "a", hidden: true }, true);
    expect(visibility.visibleOf("scene-1", { id: "a", hidden: false })).toBe(true);

    visibility.set("scene-1", { id: "a", hidden: false }, false);
    expect(visibility.visibleOf("scene-1", { id: "a", hidden: true })).toBe(false);
    // Dropped for good: saving the old default again does not bring it back.
    expect(visibility.visibleOf("scene-1", { id: "a", hidden: false })).toBe(true);
  });
});

describe("OverlayHost with PlacementVisibility", () => {
  function fakeLogger() {
    return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
  }

  function host(visibility: PlacementVisibility): OverlayHost {
    const db = {
      getScene: async () => ({
        status: { code: "OK" as const, message: "" },
        scene: {
          id: "scene-1",
          name: "Main",
          widgetsJson: JSON.stringify([
            { id: "shown-1", widgetCanonicalId: "woofx3:widget:text", position: {}, settings: {} },
            { id: "hidden-1", widgetCanonicalId: "woofx3:widget:text", position: {}, settings: {}, hidden: true },
          ]),
          layoutJson: "{}",
        },
      }),
      listWidgets: async () => ({
        status: { code: "OK" as const, message: "" },
        widgets: [{ moduleId: "woofx3", manifestId: "text", entry: "", surfaces: ["scene"], hostsSurface: "" }],
      }),
    };
    const resolver = new OverlayTokenResolver({ resolveOverlayToken: async () => ({}) } as any, fakeLogger());
    return new OverlayHost(resolver, db as any, fakeLogger(), { visibility });
  }

  function visibleById(config: Record<string, unknown>): Record<string, unknown> {
    const widgets = (config.scene as { widgets: { id: string; visible: unknown }[] }).widgets;
    return Object.fromEntries(widgets.map((widget) => [widget.id, widget.visible]));
  }

  it("serves each placement's saved default, then a workflow's change, in the overlay's config", async () => {
    const visibility = new PlacementVisibility();
    const h = host(visibility);
    expect(visibleById(await h.buildConfigById("scene-1"))).toEqual({ "shown-1": true, "hidden-1": false });

    visibility.set("scene-1", { id: "hidden-1", hidden: true }, true);
    visibility.set("scene-1", { id: "shown-1", hidden: false }, false);
    expect(visibleById(await h.buildConfigById("scene-1"))).toEqual({ "shown-1": false, "hidden-1": true });
    expect(
      visibleById(
        await h.buildDraftConfig("scene-1", [{ id: "hidden-1", widgetCanonicalId: "woofx3:widget:text", hidden: true }])
      )
    ).toEqual({ "hidden-1": true });
  });
});
