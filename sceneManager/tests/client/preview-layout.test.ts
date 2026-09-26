import { describe, expect, it } from "bun:test";
import {
  applyPreviewLayout,
  PREVIEW_LAYOUT_MESSAGE,
  parsePreviewLayout,
} from "../../public/scene-manager/preview-layout";

function element(): HTMLElement {
  return { style: {} as CSSStyleDeclaration } as HTMLElement;
}

describe("parsePreviewLayout", () => {
  it("reads the widgets of a layout message", () => {
    const layout = parsePreviewLayout({
      type: PREVIEW_LAYOUT_MESSAGE,
      widgets: [{ id: "w1", x: 10, y: 20, width: 300, height: 200 }],
    });
    expect(layout).toEqual([{ id: "w1", x: 10, y: 20, width: 300, height: 200 }]);
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

describe("applyPreviewLayout", () => {
  it("moves listed widgets and hides the ones the editor removed", () => {
    const kept = element();
    const removed = element();
    applyPreviewLayout(
      new Map([
        ["kept", kept],
        ["removed", removed],
      ]),
      [{ id: "kept", x: 5, y: 6, width: 70, height: 80 }]
    );
    expect(kept.style.left).toBe("5px");
    expect(kept.style.top).toBe("6px");
    expect(kept.style.width).toBe("70px");
    expect(kept.style.height).toBe("80px");
    expect(kept.style.display).toBe("");
    expect(removed.style.display).toBe("none");
  });

  it("shows a widget again once the layout includes it", () => {
    const widget = element();
    const elements = new Map([["w", widget]]);
    applyPreviewLayout(elements, []);
    applyPreviewLayout(elements, [{ id: "w", x: 0, y: 0, width: 10, height: 10 }]);
    expect(widget.style.display).toBe("");
  });
});
