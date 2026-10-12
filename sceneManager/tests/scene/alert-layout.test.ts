import { describe, expect, it } from "bun:test";
import {
  type AlertLayoutParse,
  alertTarget,
  alertWidgetsNamed,
  parseAlertDelivery,
  parseAlertLayout,
} from "../../src/scene/alert-layout";
import type { BehaviorDocument } from "@woofx3/scene/model";
import type { OverlayWidgetDefinition, OverlayWidgetInstance } from "../../src/scene/scene-host";

function definition(
  manifestId: string,
  surfaces: string[],
  behaviorKinds: OverlayWidgetDefinition["behaviorKinds"] = { transitions: [], effects: [] }
): OverlayWidgetDefinition {
  return { moduleKey: "woofx3", manifestId, entry: "index.html", surfaces, hostsSurface: "", behaviorKinds };
}

const catalog = [
  definition("text", ["scene", "alert"], { transitions: ["typewriter"], effects: [] }),
  definition("audio", ["alert"]),
  definition("clock", ["scene"]),
];

function layoutWidget(id: string, manifestId: string) {
  return {
    id,
    widgetCanonicalId: `woofx3:widget:${manifestId}`,
    position: { x: 10, y: 20 },
    size: { width: 300, height: 100 },
    settings: { text: "hi" },
  };
}

/** Narrows to the usable branch, surfacing the reason when a case regresses. */
function usable(parse: AlertLayoutParse) {
  if (!parse.ok) {
    throw new Error(`expected a usable layout, got: ${parse.reason}`);
  }
  return parse;
}

/** A placement as the editor saves it in a composition-shaped layout. */
function placementOf(manifestId: string, z: string, overrides: Record<string, unknown> = {}) {
  return {
    widget: `woofx3:widget:${manifestId}`,
    x: 10,
    y: 20,
    width: 300,
    height: 100,
    visible: true,
    z,
    settings: { text: "hi" },
    name: manifestId,
    rotation: 15,
    opacity: 0.5,
    locked: false,
    extra: {},
    ...overrides,
  };
}

function fade(target: string, phase: "in" | "out"): BehaviorDocument {
  return {
    type: "transition",
    kind: "fade",
    target,
    order: "a0",
    timing: { anchor: phase === "in" ? "enter" : "exit", offsetMs: 0, durationMs: 400, easing: "ease-out" },
    params: { phase },
  };
}

describe("parseAlertLayout, list shape", () => {
  it("converts to a composition: widgets keyed by id, list order as z, shown, no behaviors", () => {
    const parsed = usable(
      parseAlertLayout(
        { width: 1920, height: 1080, widgets: [layoutWidget("t1", "text"), layoutWidget("a1", "audio")] },
        catalog
      )
    );
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rejectedBehaviors).toEqual([]);
    expect(parsed.layout.layout).toEqual({ width: 1920, height: 1080 });
    expect(parsed.layout.behaviors).toEqual({});
    expect(Object.keys(parsed.layout.widgets)).toEqual(["t1", "a1"]);
    expect(parsed.layout.widgets.t1).toMatchObject({
      widget: "woofx3:widget:text",
      x: 10,
      y: 20,
      width: 300,
      height: 100,
      visible: true,
      settings: { text: "hi" },
      rotation: 0,
      opacity: 1,
    });
    expect(parsed.layout.widgets.t1!.z < parsed.layout.widgets.a1!.z).toBe(true);
  });

  it("drops a scene-only widget, an unknown widget, a duplicate id and an unsafe id, reporting each", () => {
    const parsed = usable(
      parseAlertLayout(
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
      )
    );
    expect(Object.keys(parsed.layout.widgets)).toEqual(["t1"]);
    expect(parsed.rejected.map((r) => [r.index, r.reason])).toEqual([
      [0, "the widget cannot be placed in an alert"],
      [1, "no such widget"],
      [3, 'duplicate id "t1"'],
      [4, "`id` must be 1-64 letters, digits, '-' or '_'"],
    ]);
  });

  it("strips a version from a stored module key", () => {
    const parsed = usable(
      parseAlertLayout(
        {
          width: 10,
          height: 10,
          widgets: [{ ...layoutWidget("t1", "text"), widgetCanonicalId: "woofx3:0.5.0:abc1234:widget:text" }],
        },
        catalog
      )
    );
    expect(parsed.layout.widgets.t1?.widget).toBe("woofx3:widget:text");
  });

  // An unusable layout means an alert never plays and the operator sees only a
  // log line, so the message has to say which field was at fault.
  it("refuses a layout envelope it cannot use, naming the field at fault", () => {
    expect(parseAlertLayout(undefined, catalog)).toEqual({
      ok: false,
      reason: "layout must be an object, got nothing",
    });
    expect(parseAlertLayout({ width: 0, height: 100, widgets: [] }, catalog)).toEqual({
      ok: false,
      reason: "layout.width must be a positive number, got number 0",
    });
    expect(parseAlertLayout({ width: 100, height: 0, widgets: [] }, catalog)).toEqual({
      ok: false,
      reason: "layout.height must be a positive number, got number 0",
    });
    expect(parseAlertLayout({ width: 100, height: 100 }, catalog)).toEqual({
      ok: false,
      reason: "layout.widgets must be an array, got nothing",
    });
  });

  // The failure that reads as correct in a payload: a dimension serialized as a
  // string. Quoting it in the reason is the difference between a one-line fix
  // and an afternoon.
  it("names a dimension that arrived as a string rather than a number", () => {
    expect(parseAlertLayout({ width: "1920", height: 1080, widgets: [] }, catalog)).toEqual({
      ok: false,
      reason: 'layout.width must be a positive number, got the string "1920"',
    });
  });

  it("frames nothing when the catalog could not be loaded", () => {
    const parsed = usable(parseAlertLayout({ width: 10, height: 10, widgets: [layoutWidget("t1", "text")] }, []));
    expect(parsed.layout.widgets).toEqual({});
  });
});

describe("parseAlertLayout, composition shape", () => {
  it("keeps placements and behaviors the strict registry accepts, under canonical widget ids", () => {
    const layout = {
      layout: { width: 1280, height: 720, backgroundColor: "#000" },
      widgets: {
        title: placementOf("text", "a1"),
        sound: placementOf("audio", "a0", { widget: "woofx3:0.5.0:abc1234:widget:audio", visible: false }),
      },
      behaviors: { "title-in": fade("title", "in"), "title-out": fade("title", "out") },
    };
    const parsed = usable(parseAlertLayout(layout, catalog));
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rejectedBehaviors).toEqual([]);
    expect(parsed.layout).toEqual({
      ...layout,
      widgets: { ...layout.widgets, sound: { ...layout.widgets.sound, widget: "woofx3:widget:audio" } },
    });
  });

  it("drops what the strict registry or the catalog refuses, a widget taking its behaviors with it", () => {
    const parsed = usable(
      parseAlertLayout(
        {
          layout: { width: 100, height: 100 },
          widgets: {
            title: placementOf("text", "a0"),
            clock: placementOf("clock", "a1"),
            odd: placementOf("text", "a2", { unknownField: 1 }),
            "bad id": placementOf("text", "a3"),
          },
          behaviors: {
            "clock-in": fade("clock", "in"),
            ghost: fade("nobody", "in"),
            typo: { ...fade("title", "in"), params: { phase: "in", speed: 2 } },
            typewriter: { ...fade("title", "in"), kind: "typewriter" },
          },
        },
        catalog
      )
    );
    expect(Object.keys(parsed.layout.widgets)).toEqual(["title"]);
    expect(Object.keys(parsed.layout.behaviors)).toEqual(["typewriter"]);
    expect(parsed.rejected).toEqual([
      {
        id: "bad id",
        widgetCanonicalId: "woofx3:widget:text",
        reason: "`id` must be 1-64 letters, digits, '-' or '_'",
      },
      { id: "clock", widgetCanonicalId: "woofx3:widget:clock", reason: "the widget cannot be placed in an alert" },
      { id: "odd", widgetCanonicalId: "woofx3:widget:text", reason: "a placement has no field unknownField" },
    ]);
    expect(parsed.rejectedBehaviors).toEqual([
      { id: "ghost", reason: 'targets no widget: "nobody"' },
      { id: "typo", reason: "a fade transition has no param speed" },
    ]);
  });

  it("drops a widget kind its widget does not declare, keeping host kinds and declared ones", () => {
    const parsed = usable(
      parseAlertLayout(
        {
          layout: { width: 100, height: 100 },
          widgets: { title: placementOf("text", "a0"), sound: placementOf("audio", "a1") },
          behaviors: {
            typewriter: { ...fade("title", "in"), kind: "typewriter" },
            wave: { ...fade("title", "in"), kind: "wave" },
            sparkle: { ...fade("title", "in"), type: "effect", kind: "typewriter", params: {} },
            "sound-in": { ...fade("sound", "in"), kind: "typewriter" },
            "sound-fade": fade("sound", "in"),
          },
        },
        catalog
      )
    );
    expect(Object.keys(parsed.layout.behaviors).sort()).toEqual(["sound-fade", "typewriter"]);
    expect(parsed.rejectedBehaviors).toEqual([
      { id: "sound-in", reason: 'the widget woofx3:widget:audio does not play the transition "typewriter"' },
      { id: "sparkle", reason: 'the widget woofx3:widget:text does not play the effect "typewriter"' },
      { id: "wave", reason: 'the widget woofx3:widget:text does not play the transition "wave"' },
    ]);
  });

  it("lifts transitions stored on a placement into behaviors, as the registry migrates them", () => {
    const parsed = usable(
      parseAlertLayout(
        {
          layout: { width: 100, height: 100 },
          widgets: { title: placementOf("text", "a0", { extra: { transitionIn: { type: "fade", durationMs: 300 } } }) },
        },
        catalog
      )
    );
    expect(parsed.layout.widgets.title?.extra).toEqual({});
    expect(Object.values(parsed.layout.behaviors)).toMatchObject([
      { type: "transition", kind: "fade", target: "title", params: { phase: "in" } },
    ]);
  });

  it("refuses an envelope it cannot use, naming the field at fault", () => {
    expect(parseAlertLayout({ layout: { width: 0, height: 10 }, widgets: {} }, catalog)).toEqual({
      ok: false,
      reason: "layout.layout.width must be a positive number, got number 0",
    });
    expect(parseAlertLayout({ layout: { width: 10, height: 10 }, widgets: [] }, catalog)).toEqual({
      ok: false,
      reason: "layout.widgets must be an object keyed by id, got an array",
    });
    expect(parseAlertLayout({ layout: { width: 10, height: 10 }, widgets: {}, behaviors: [] }, catalog)).toEqual({
      ok: false,
      reason: "layout.behaviors must be an object keyed by id, got an array",
    });
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
      hostsSurface,
      frameUrl: "",
      resolved: true,
      visible: true,
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
    const delivery = {
      alertId: "a1",
      layout: { layout: { width: 10, height: 10 }, widgets: { t1: placementOf("text", "a0") }, behaviors: {} },
      event: null,
    };
    expect(parseAlertDelivery(delivery)).toEqual(delivery);
    expect(parseAlertDelivery({ layout: delivery.layout })).toBeNull();
    expect(parseAlertDelivery({ alertId: "a1", layout: { width: 10 } })).toBeNull();
    expect(parseAlertDelivery("nope")).toBeNull();
  });

  it("converts a delivery recorded with a list-shaped layout", () => {
    const stored = {
      alertId: "a1",
      layout: {
        width: 10,
        height: 10,
        widgets: [{ ...layoutWidget("t1", "text"), position: { x: 1, y: 2, width: 3, height: 4 } }],
      },
      event: null,
    };
    expect(parseAlertDelivery(stored)?.layout.widgets.t1).toMatchObject({
      widget: "woofx3:widget:text",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });
});
