import { describe, expect, it } from "bun:test";
import {
  draftFrameKey,
  parsePreviewPlacements,
  transientOfPreviewLayout,
  PREVIEW_LAYOUT_MESSAGE,
  parsePreviewLayout,
} from "../../public/scene-manager/preview-layout";

describe("parsePreviewLayout", () => {
  it("reads the widgets of a layout message", () => {
    const layout = parsePreviewLayout({
      type: PREVIEW_LAYOUT_MESSAGE,
      widgets: [{ id: "w1", x: 10, y: 20, width: 300, height: 200 }],
    });
    expect(layout).toEqual([{ id: "w1", x: 10, y: 20, width: 300, height: 200 }]);
  });

  it("reads a rotation and an opacity when the editor sends them", () => {
    const layout = parsePreviewLayout({
      type: PREVIEW_LAYOUT_MESSAGE,
      widgets: [
        { id: "w1", x: 0, y: 0, width: 1, height: 1, rotation: -45, opacity: 0.25 },
        { id: "w2", x: 0, y: 0, width: 1, height: 1, rotation: "45", opacity: 2 },
      ],
    });
    expect(layout).toEqual([
      { id: "w1", x: 0, y: 0, width: 1, height: 1, rotation: -45, opacity: 0.25 },
      { id: "w2", x: 0, y: 0, width: 1, height: 1 },
    ]);
  });

  // Widget frames post their own protocol messages to this page; those
  // must never be mistaken for a layout.
  it("ignores anything that is not a layout message", () => {
    expect(parsePreviewLayout({ proto: "woofx3.widget", type: "hello" })).toBeNull();
    expect(parsePreviewLayout("layout")).toBeNull();
    expect(parsePreviewLayout(null)).toBeNull();
    expect(parsePreviewLayout({ type: PREVIEW_LAYOUT_MESSAGE })).toBeNull();
  });

  it("drops malformed widgets and keeps the rest", () => {
    const layout = parsePreviewLayout({
      type: PREVIEW_LAYOUT_MESSAGE,
      widgets: [
        { id: "", x: 0, y: 0, width: 1, height: 1 },
        { id: "w1", x: "10", y: 0, width: 1, height: 1 },
        { id: "w2", x: Number.NaN, y: 0, width: 1, height: 1 },
        { id: "w3", x: 1, y: 2, width: 3, height: 4 },
      ],
    });
    expect(layout).toEqual([{ id: "w3", x: 1, y: 2, width: 3, height: 4 }]);
  });
});

describe("transientOfPreviewLayout", () => {
  it("places listed widgets, stacks them in the layout's order, and makes the ones the editor removed transparent", () => {
    const transient = transientOfPreviewLayout(
      [
        { id: "top", x: 5, y: 6, width: 70, height: 80, rotation: 30, opacity: 0.5 },
        { id: "bottom", x: 1, y: 2, width: 3, height: 4 },
      ].reverse(),
      ["top", "bottom", "removed"]
    );
    expect(transient.top).toMatchObject({ x: 5, y: 6, width: 70, height: 80, rotation: 30, opacity: 0.5 });
    expect(transient.bottom).toEqual({ x: 1, y: 2, width: 3, height: 4, z: transient.bottom!.z });
    expect(transient.bottom!.z! < transient.top!.z!).toBe(true);
    expect(transient.removed).toEqual({ opacity: 0 });
  });

  it("leaves a widget listed again as the layout places it", () => {
    expect(transientOfPreviewLayout([], ["w"]).w).toEqual({ opacity: 0 });
    expect(
      transientOfPreviewLayout([{ id: "w", x: 0, y: 0, width: 10, height: 10 }], ["w"]).w?.opacity
    ).toBeUndefined();
  });
});

describe("parsePreviewPlacements", () => {
  it("returns the placements a layout message carries", () => {
    const placements = [{ id: "a", settings: { text: "hi" } }];
    expect(parsePreviewPlacements({ type: PREVIEW_LAYOUT_MESSAGE, widgets: [], placements })).toEqual(placements);
  });

  // An editor that posts only positions must keep working.
  it("is null for a message without placements, or another message", () => {
    expect(parsePreviewPlacements({ type: PREVIEW_LAYOUT_MESSAGE, widgets: [] })).toBeNull();
    expect(parsePreviewPlacements({ type: "other", placements: [] })).toBeNull();
    expect(parsePreviewPlacements(null)).toBeNull();
  });
});

describe("draftFrameKey", () => {
  const placement = (x: number, text: string) => ({
    id: "a",
    widgetCanonicalId: "woofx3:widget:text",
    position: { x, y: 0 },
    size: { width: 10, height: 10 },
    settings: { text },
  });

  it("ignores a drag", () => {
    expect(draftFrameKey([placement(0, "hi")])).toBe(draftFrameKey([placement(40, "hi")]));
  });

  it("ignores settings other than the theme: the page hands those to the widget", () => {
    expect(draftFrameKey([placement(0, "hi")])).toBe(draftFrameKey([placement(0, "hello")]));
  });

  it("changes with the theme, which picks the frame document", () => {
    const themed = (theme: string) => ({ ...placement(0, "hi"), settings: { text: "hi", theme } });
    expect(draftFrameKey([themed("a:theme:one")])).not.toBe(draftFrameKey([themed("a:theme:two")]));
  });

  it("counts every setting of a placement the page draws itself", () => {
    const drawn = () => true;
    expect(draftFrameKey([placement(0, "hi")], drawn)).not.toBe(draftFrameKey([placement(0, "hello")], drawn));
  });
});
