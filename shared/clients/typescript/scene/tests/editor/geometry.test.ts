import { describe, expect, test } from "bun:test";
import {
  clampCenter,
  fitZoom,
  MIN_NODE_SIZE,
  resizeBox,
  rotationAt,
  SNAP_DISTANCE,
  snapBox,
  snapTargets,
  textBoxHeight,
  ZOOM_STEPS,
  zoomIn,
  zoomOut,
} from "../../editor";

const canvas = { width: 1920, height: 1080 };

describe("zoom", () => {
  test("steps through the zoom levels and stops at the ends", () => {
    expect(zoomIn(0.36)).toBe(0.5);
    expect(zoomOut(0.36)).toBe(0.3);
    expect(zoomIn(1)).toBe(1);
    expect(zoomOut(0.2)).toBe(0.2);
    expect(zoomIn(0.4)).toBe(0.5);
    expect(ZOOM_STEPS).toContain(0.36);
  });

  test("fit leaves the padding free and never drops below a floor", () => {
    expect(fitZoom({ width: 1024, height: 2000 }, canvas, 32)).toBeCloseTo(960 / 1920);
    expect(fitZoom({ width: 10, height: 10 }, canvas, 32)).toBe(0.05);
  });
});

describe("snapping", () => {
  test("a centre near the canvas centre lines snaps onto them", () => {
    const targets = snapTargets(canvas, []);
    const snapped = snapBox({ x: 960 - 50 + 12, y: 540 - 50 - 15, width: 100, height: 100 }, targets, SNAP_DISTANCE);
    expect(snapped.x).toBe(910);
    expect(snapped.y).toBe(490);
    expect(snapped.guides).toContainEqual({ axis: "vertical", position: 960, source: "canvas" });
    expect(snapped.guides).toContainEqual({ axis: "horizontal", position: 540, source: "canvas" });
  });

  test("an edge near another box's edge snaps to it; far away nothing snaps", () => {
    const targets = snapTargets(canvas, [
      { id: "other", box: { x: 300, y: 300, width: 200, height: 100, rotation: 0 } },
    ]);
    const near = snapBox({ x: 507, y: 700, width: 100, height: 100 }, targets, SNAP_DISTANCE);
    expect(near.x).toBe(500);
    expect(near.guides).toEqual([{ axis: "vertical", position: 500, source: "other" }]);
    const far = snapBox({ x: 600, y: 700, width: 100, height: 100 }, targets, SNAP_DISTANCE);
    expect(far).toEqual({ x: 600, y: 700, guides: [] });
  });

  test("a centre stays on the canvas", () => {
    expect(clampCenter({ x: -40, y: 2000 }, canvas)).toEqual({ x: 0, y: 1080 });
  });
});

describe("resize", () => {
  const start = { x: 100, y: 100, width: 400, height: 200, rotation: 0 };

  test("the opposite corner stays put", () => {
    const box = resizeBox(start, "se", { x: 100, y: 50 }, { keepAspect: false, minSize: MIN_NODE_SIZE });
    expect(box).toEqual({ x: 100, y: 100, width: 500, height: 250, rotation: 0 });
    const nw = resizeBox(start, "nw", { x: 100, y: 50 }, { keepAspect: false, minSize: MIN_NODE_SIZE });
    expect(nw).toEqual({ x: 200, y: 150, width: 300, height: 150, rotation: 0 });
  });

  test("never shrinks below the minimum", () => {
    const box = resizeBox(start, "e", { x: -1000, y: 0 }, { keepAspect: false, minSize: MIN_NODE_SIZE });
    expect(box.width).toBe(MIN_NODE_SIZE);
    expect(box.x).toBe(100);
  });

  test("keeping the aspect scales both sides, from an edge too", () => {
    const corner = resizeBox(start, "se", { x: 200, y: 0 }, { keepAspect: true, minSize: MIN_NODE_SIZE });
    expect(corner.width / corner.height).toBeCloseTo(2);
    expect(corner.width).toBe(600);
    const edge = resizeBox(start, "s", { x: 0, y: 100 }, { keepAspect: true, minSize: MIN_NODE_SIZE });
    expect(edge).toEqual({ x: 0, y: 100, width: 600, height: 300, rotation: 0 });
  });

  test("a rotated box resizes along its own axes, its opposite edge fixed", () => {
    const rotated = { x: 0, y: 0, width: 200, height: 100, rotation: 90 };
    // Turned a quarter, the box's own right edge faces down the screen.
    const box = resizeBox(rotated, "e", { x: 0, y: 40 }, { keepAspect: false, minSize: MIN_NODE_SIZE });
    expect(box.width).toBe(240);
    expect(box.height).toBe(100);
    // Its left edge (top on screen) stayed where it was: the centre moved down by half the growth.
    expect(box.y + box.height / 2).toBeCloseTo(50 + 20);
  });
});

describe("rotate", () => {
  const center = { x: 0, y: 0 };

  test("turns by the angle swept about the centre", () => {
    expect(rotationAt(center, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, false)).toBe(90);
    expect(rotationAt(center, { x: 10, y: 0 }, { x: 10, y: 1 }, 30, false)).toBeCloseTo(35.71, 1);
  });

  test("Shift snaps to 15 degrees", () => {
    const angle = (deg: number) => ({
      x: Math.cos((deg * Math.PI) / 180) * 10,
      y: Math.sin((deg * Math.PI) / 180) * 10,
    });
    expect(rotationAt(center, angle(0), angle(22), 0, true)).toBe(15);
    expect(rotationAt(center, angle(0), angle(23), 0, true)).toBe(30);
    expect(rotationAt(center, angle(0), angle(200), 0, true)).toBe(-165);
  });
});

test("a text box grows with its lines and font size", () => {
  expect(textBoxHeight(48, "New text")).toBe(76);
  expect(textBoxHeight(48, "a\nb")).toBe(136);
});
