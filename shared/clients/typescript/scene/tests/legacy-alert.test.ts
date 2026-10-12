import { describe, expect, test } from "bun:test";
import {
  alertCompositionOf,
  compositionOfLegacyAlert,
  isLegacyAlertLayout,
  orderByKey,
  STRICT_REGISTRY,
} from "../model";

function legacyWidget(id: string, manifestId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    widgetCanonicalId: `woofx3:widget:${manifestId}`,
    position: { x: 10, y: 20 },
    size: { width: 300, height: 100 },
    settings: { text: "hi" },
    ...extra,
  };
}

describe("compositionOfLegacyAlert", () => {
  test("keys widgets by id, stacks them in list order, shows them all, and adds no behaviors", () => {
    const { doc, indexOf, skipped } = compositionOfLegacyAlert({
      width: 1920,
      height: 1080,
      backgroundColor: "#000",
      widgets: [legacyWidget("bottom", "image"), legacyWidget("top", "text")],
    });
    expect(skipped).toEqual([]);
    expect(doc.layout).toEqual({ width: 1920, height: 1080, backgroundColor: "#000" });
    expect(doc.behaviors).toEqual({});
    expect(orderByKey(doc.widgets, (placement) => placement.z)).toEqual(["bottom", "top"]);
    expect(indexOf).toEqual({ bottom: 0, top: 1 });
    expect(doc.widgets.top).toEqual({
      widget: "woofx3:widget:text",
      x: 10,
      y: 20,
      width: 300,
      height: 100,
      visible: true,
      z: doc.widgets.top.z,
      settings: { text: "hi" },
      name: "",
      rotation: 0,
      opacity: 1,
      locked: false,
      extra: {},
    });
    for (const id of Object.keys(doc.widgets)) {
      expect(STRICT_REGISTRY.invalidEntry("widgets", doc.widgets[id])).toBeNull();
    }
  });

  test("reads a size given inside position, as stored deliveries hold it, before one in size", () => {
    const { doc } = compositionOfLegacyAlert({
      width: 100,
      height: 100,
      widgets: [
        { id: "a", widgetCanonicalId: "m:widget:a", position: { x: 1, y: 2, width: 3, height: 4 }, size: { width: 9 } },
      ],
    });
    expect(doc.widgets.a).toMatchObject({ x: 1, y: 2, width: 3, height: 4 });
  });

  test("fills what is missing or mistyped with zero and empty settings", () => {
    const { doc } = compositionOfLegacyAlert({
      width: 100,
      height: 100,
      widgets: [{ id: "a", widgetCanonicalId: "m:widget:a", position: { x: "5" }, settings: [] }],
    });
    expect(doc.widgets.a).toMatchObject({ x: 0, y: 0, width: 0, height: 0, settings: {} });
  });

  test("skips and reports entries that cannot be keyed by their id", () => {
    const { doc, indexOf, skipped } = compositionOfLegacyAlert({
      width: 100,
      height: 100,
      widgets: [legacyWidget("a", "text"), "junk", legacyWidget("", "text"), legacyWidget("a", "image")],
    });
    expect(Object.keys(doc.widgets)).toEqual(["a"]);
    expect(doc.widgets.a.widget).toBe("woofx3:widget:text");
    expect(indexOf).toEqual({ a: 0 });
    expect(skipped).toEqual([
      { index: 1, widgetCanonicalId: "", reason: "a layout widget must be an object" },
      { index: 2, widgetCanonicalId: "woofx3:widget:text", reason: "a layout widget needs an `id`" },
      { index: 3, widgetCanonicalId: "woofx3:widget:image", reason: 'duplicate id "a"' },
    ]);
  });

  test("reads the fields the dashboard writes into each entry", () => {
    const { doc } = compositionOfLegacyAlert({
      width: 100,
      height: 100,
      widgets: [
        legacyWidget("a", "text", {
          name: "Headline",
          visible: false,
          rotation: -15,
          opacity: 0.4,
          locked: true,
          zIndex: 1,
        }),
      ],
    });
    expect(doc.widgets.a).toMatchObject({
      name: "Headline",
      visible: false,
      rotation: -15,
      opacity: 0.4,
      locked: true,
      extra: {},
    });
    expect(STRICT_REGISTRY.invalidEntry("widgets", doc.widgets.a)).toBeNull();
  });

  test("gives the placement default for a dashboard field that is mistyped or out of range", () => {
    const { doc } = compositionOfLegacyAlert({
      width: 100,
      height: 100,
      widgets: [
        legacyWidget("a", "text", {
          name: "x".repeat(257),
          visible: "no",
          rotation: Number.NaN,
          opacity: 1.5,
          locked: 1,
        }),
        legacyWidget("b", "text", { name: 7, opacity: -0.1 }),
      ],
    });
    for (const id of ["a", "b"]) {
      expect(doc.widgets[id]).toMatchObject({ name: "", visible: true, rotation: 0, opacity: 1, locked: false });
      expect(STRICT_REGISTRY.invalidEntry("widgets", doc.widgets[id])).toBeNull();
    }
  });

  test("stacks by zIndex when every entry has one, ties keeping list order", () => {
    const { doc, indexOf } = compositionOfLegacyAlert({
      width: 100,
      height: 100,
      widgets: [
        legacyWidget("top", "text", { zIndex: 3 }),
        legacyWidget("tie-first", "text", { zIndex: 1 }),
        legacyWidget("tie-second", "text", { zIndex: 1 }),
      ],
    });
    expect(orderByKey(doc.widgets, (placement) => placement.z)).toEqual(["tie-first", "tie-second", "top"]);
    expect(indexOf).toEqual({ top: 0, "tie-first": 1, "tie-second": 2 });
  });

  test("stacks in list order when any entry lacks a numeric zIndex", () => {
    const { doc } = compositionOfLegacyAlert({
      width: 100,
      height: 100,
      widgets: [legacyWidget("bottom", "text", { zIndex: 9 }), legacyWidget("top", "text", { zIndex: "1" })],
    });
    expect(orderByKey(doc.widgets, (placement) => placement.z)).toEqual(["bottom", "top"]);
  });

  test("agrees with the dashboard's writer, which sorts by zIndex and numbers it by rank", () => {
    const written = [legacyWidget("a", "text", { zIndex: 1 }), legacyWidget("b", "text", { zIndex: 2 })];
    const byZIndex = compositionOfLegacyAlert({ width: 10, height: 10, widgets: written }).doc;
    const byList = compositionOfLegacyAlert({
      width: 10,
      height: 10,
      widgets: [legacyWidget("a", "text"), legacyWidget("b", "text")],
    }).doc;
    const order = (doc: typeof byZIndex) => orderByKey(doc.widgets, (placement) => placement.z);
    expect(order(byZIndex)).toEqual(["a", "b"]);
    expect(order(byList)).toEqual(order(byZIndex));
  });

  test("keeps an entry's unknown fields in extra, and nothing it read", () => {
    const { doc } = compositionOfLegacyAlert({
      width: 100,
      height: 100,
      widgets: [legacyWidget("a", "text", { zIndex: 1, name: "A", groupId: "g1", tint: { r: 1 } })],
    });
    expect(doc.widgets.a.extra).toEqual({ groupId: "g1", tint: { r: 1 } });
    expect(STRICT_REGISTRY.invalidEntry("widgets", doc.widgets.a)).toBeNull();
  });

  test("is deterministic, so converting a stored delivery twice gives the same document", () => {
    const legacy = { width: 10, height: 10, widgets: [legacyWidget("a", "text"), legacyWidget("b", "text")] };
    expect(compositionOfLegacyAlert(legacy)).toEqual(compositionOfLegacyAlert(legacy));
  });
});

describe("alertCompositionOf", () => {
  test("reads both shapes, and nothing else", () => {
    const legacy = { width: 10, height: 10, widgets: [legacyWidget("a", "text")] };
    expect(isLegacyAlertLayout(legacy)).toBe(true);
    expect(alertCompositionOf(legacy)).toEqual(compositionOfLegacyAlert(legacy).doc);

    const composition = { layout: { width: 10, height: 10 }, widgets: {} };
    expect(isLegacyAlertLayout(composition)).toBe(false);
    expect(alertCompositionOf(composition)).toEqual({ ...composition, behaviors: {} });

    expect(alertCompositionOf(null)).toBeNull();
    expect(alertCompositionOf({ width: 10, height: 10 })).toBeNull();
  });
});
