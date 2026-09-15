import { describe, expect, it } from "bun:test";
import {
  alertTarget,
  alertWidgetsNamed,
  parseAlertDelivery,
  parseAlertLayout,
} from "../../src/scene/alert-layout";
import type { OverlayWidgetDefinition, OverlayWidgetInstance } from "../../src/scene/scene-host";

function definition(manifestId: string, surfaces: string[]): OverlayWidgetDefinition {
  return { moduleKey: "woofx3", manifestId, entry: "index.html", acceptedEvents: [], surfaces, hostsSurface: "" };
}

const catalog = [definition("text", ["scene", "alert"]), definition("audio", ["alert"]), definition("clock", ["scene"])];

function layoutWidget(id: string, manifestId: string) {
  return {
    id,
    widgetCanonicalId: `woofx3:widget:${manifestId}`,
    position: { x: 10, y: 20 },
    size: { width: 300, height: 100 },
    settings: { text: "hi" },
  };
}

describe("parseAlertLayout", () => {
  it("keeps widgets that can play in an alert, positioned from position and size", () => {
    const parsed = parseAlertLayout(
      { width: 1920, height: 1080, widgets: [layoutWidget("t1", "text"), layoutWidget("a1", "audio")] },
      catalog
    );
    expect(parsed?.rejected).toEqual([]);
    expect(parsed?.layout.width).toBe(1920);
    expect(parsed?.layout.height).toBe(1080);
    expect(parsed?.layout.widgets).toEqual([
      {
        id: "t1",
        widgetCanonicalId: "woofx3:widget:text",
        moduleId: "woofx3",
        manifestId: "text",
        position: { x: 10, y: 20, width: 300, height: 100 },
        settings: { text: "hi" },
      },
      {
        id: "a1",
        widgetCanonicalId: "woofx3:widget:audio",
        moduleId: "woofx3",
        manifestId: "audio",
        position: { x: 10, y: 20, width: 300, height: 100 },
        settings: { text: "hi" },
      },
    ]);
  });

  it("drops a scene-only widget, an unknown widget, a duplicate id and an unsafe id, reporting each", () => {
    const parsed = parseAlertLayout(
      {
        width: 100,
        height: 100,
        widgets: [
          layoutWidget("c1", "clock"),
          layoutWidget("m1", "missing"),
          layoutWidget("t1", "text"),
          layoutWidget("t1", "text"),
          layoutWidget("../x", "text"),
        ],
      },
      catalog
    );
    expect(parsed?.layout.widgets.map((w) => w.id)).toEqual(["t1"]);
    expect(parsed?.rejected.map((r) => r.index)).toEqual([0, 1, 3, 4]);
  });

  it("strips a version from a stored module key", () => {
    const parsed = parseAlertLayout(
      {
        width: 10,
        height: 10,
        widgets: [{ ...layoutWidget("t1", "text"), widgetCanonicalId: "woofx3:0.5.0:abc1234:widget:text" }],
      },
      catalog
    );
    expect(parsed?.layout.widgets[0]?.widgetCanonicalId).toBe("woofx3:widget:text");
  });

  it("refuses a layout without a canvas size or a widget list", () => {
    expect(parseAlertLayout(undefined, catalog)).toBeNull();
    expect(parseAlertLayout({ width: 0, height: 100, widgets: [] }, catalog)).toBeNull();
    expect(parseAlertLayout({ width: 100, height: 100 }, catalog)).toBeNull();
  });

  it("frames nothing when the catalog could not be loaded", () => {
    const parsed = parseAlertLayout({ width: 10, height: 10, widgets: [layoutWidget("t1", "text")] }, []);
    expect(parsed?.layout.widgets).toEqual([]);
  });
});

describe("alert widget targeting", () => {
  function instance(id: string, hostsSurface: string, settings: Record<string, unknown> = {}): OverlayWidgetInstance {
    return {
      id,
      widgetCanonicalId: "woofx3:widget:alert",
      moduleId: "woofx3",
      manifestId: "alert",
      position: { x: 0, y: 0, width: 0, height: 0 },
      settings,
      acceptedEvents: [],
      hostsSurface,
      frameUrl: "",
      resolved: true,
    };
  }

  it("targets the alert widget named default when a step names none", () => {
    expect(alertTarget({})).toBe("default");
    expect(alertTarget({ target: "  " })).toBe("default");
    expect(alertTarget({ target: " sidebar " })).toBe("sidebar");
  });

  it("matches alert widgets by name, an unnamed one answering to default", () => {
    const instances = [
      instance("a", "alert"),
      instance("b", "alert", { name: "sidebar" }),
      instance("c", "alert", { name: "default" }),
      instance("d", "", { name: "default" }),
    ];
    expect(alertWidgetsNamed(instances, "default").map((i) => i.id)).toEqual(["a", "c"]);
    expect(alertWidgetsNamed(instances, "sidebar").map((i) => i.id)).toEqual(["b"]);
    expect(alertWidgetsNamed(instances, "nowhere")).toEqual([]);
  });
});

describe("parseAlertDelivery", () => {
  it("restores a stored delivery and refuses anything else", () => {
    const delivery = { alertId: "a1", layout: { width: 10, height: 10, widgets: [] }, event: null };
    expect(parseAlertDelivery(delivery)).toEqual(delivery);
    expect(parseAlertDelivery({ layout: delivery.layout })).toBeNull();
    expect(parseAlertDelivery("nope")).toBeNull();
  });
});
