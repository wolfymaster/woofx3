import { describe, expect, it, mock } from "bun:test";
import { OverlayHost } from "../../src/scene/scene-host";
import { OverlayTokenResolver } from "../../src/scene/token-resolver";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

function host(): OverlayHost {
  const db = {
    getScene: mock(async () => ({
      status: { code: "OK" as const, message: "" },
      scene: {
        id: "scene-1",
        name: "Main",
        widgetsJson: JSON.stringify([
          { id: "text-1", widgetCanonicalId: "woofx3:widget:text", position: {}, settings: { text: "saved" } },
        ]),
        layoutJson: JSON.stringify({ backgroundColor: "#000" }),
      },
    })),
    listWidgets: mock(async () => ({
      status: { code: "OK" as const, message: "" },
      widgets: [
        { moduleId: "woofx3", manifestId: "text", entry: "", surfaces: ["scene"], hostsSurface: "" },
        { moduleId: "woofx3", manifestId: "alerts", entry: "", surfaces: ["scene"], hostsSurface: "alert" },
      ],
    })),
  };
  const resolver = new OverlayTokenResolver(
    { resolveOverlayToken: async () => ({ status: { code: "OK" } }) } as any,
    fakeLogger()
  );
  return new OverlayHost(resolver, db as any, fakeLogger());
}

describe("OverlayHost.buildDraftConfig", () => {
  it("serves the saved layout with the draft's placements, framed like saved ones", async () => {
    const config = (await host().buildDraftConfig("scene-1", [
      { id: "text-1", widgetCanonicalId: "woofx3:widget:text", position: { x: 5, y: 6 }, settings: { text: "draft" } },
      { id: "alerts-1", widgetCanonicalId: "woofx3:widget:alerts", position: {}, settings: {} },
      { id: "", widgetCanonicalId: "woofx3:widget:text" },
    ])) as { scene: { layout: unknown; widgets: Record<string, unknown>[] } };

    expect(config.scene.layout).toEqual({ backgroundColor: "#000" });
    expect(config.scene.widgets.map((w) => w.id)).toEqual(["text-1", "alerts-1"]);
    const [text, alerts] = config.scene.widgets;
    expect(text?.settings).toEqual({ text: "draft" });
    // The page hands a placement its settings, so a draft's frame is the widget's own.
    expect(text?.frameUrl).toBe("/frames/woofx3/text?v=unavailable");
    // The catalog, not the draft, decides that a placement is an alert area.
    expect(alerts?.hostsSurface).toBe("alert");
  });
});
