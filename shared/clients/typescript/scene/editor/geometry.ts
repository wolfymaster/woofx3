// Canvas geometry for the editor: zoom, snapping, and the math of moving,
// resizing and rotating a placement.
//
// Everything here is in canvas pixels unless a name says screen; the zoom
// the canvas is shown at never reaches a stored value. A placement is stored
// by its top-left corner and size, which is what an overlay frames, and
// rotates about its centre, so the math below works in centres and converts
// back.
//
// Pure functions only: the editor composes them, and a UI may call them
// directly for read-outs (the X/Y fields show a centre).

import { assert } from "../model/composition";

/** A point on the canvas, or on screen where a name says so. */
export interface Point {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/** A placement's box: its top-left corner, size, and rotation in degrees clockwise about its centre. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** The zoom levels the zoom-in and zoom-out commands step through. */
export const ZOOM_STEPS = [0.2, 0.25, 0.3, 0.36, 0.5, 0.75, 1] as const;

/** The zoom shown before the stage has been measured. */
export const DEFAULT_ZOOM = 0.36;

/** Room left around the canvas when it is fitted to the stage. */
export const FIT_PADDING = 32;

/** How close, in canvas pixels, an edge or centre must come to a guide to snap onto it; farther on touch. */
export const SNAP_DISTANCE = 20;
export const SNAP_DISTANCE_TOUCH = 40;

/** The smallest side a resize leaves a placement with. */
export const MIN_NODE_SIZE = 50;

/** Rotation snaps to multiples of this, in degrees, while Shift is held. */
export const ROTATION_SNAP_DEGREES = 15;

/** Media keep a 16:9 box: height is width times this. */
export const MEDIA_ASPECT = 9 / 16;

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? (ZOOM_STEPS[ZOOM_STEPS.length - 1] as number);
}

export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6) ?? ZOOM_STEPS[0];
}

/** The zoom that fits the whole canvas in a box, leaving `padding` on every side. */
export function fitZoom(box: CanvasSize, canvas: CanvasSize, padding: number): number {
  const zoom = Math.min((box.width - padding * 2) / canvas.width, (box.height - padding * 2) / canvas.height);
  return Math.max(ZOOM_STEPS[0] / 4, zoom);
}

export function centerOf(box: Pick<Box, "x" | "y" | "width" | "height">): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** `box` moved so its centre is at `center`, kept on whole pixels. */
export function withCenter<T extends Pick<Box, "x" | "y" | "width" | "height">>(box: T, center: Point): T {
  return {
    ...box,
    x: Math.round(center.x - box.width / 2),
    y: Math.round(center.y - box.height / 2),
  };
}

/** A centre kept on the canvas. A placement may hang over the edge; its centre may not. */
export function clampCenter(center: Point, canvas: CanvasSize): Point {
  return {
    x: Math.min(canvas.width, Math.max(0, center.x)),
    y: Math.min(canvas.height, Math.max(0, center.y)),
  };
}

/**
 * How tall a Text widget's box must be not to clip its text: it grows with
 * the font size and the line count. Wrapping inside the box is not predicted;
 * the width is the user's to set.
 */
export function textBoxHeight(fontSize: number, text: string): number {
  const lines = Math.max(1, text.split("\n").length);
  return Math.ceil(lines * fontSize * 1.25 + 16);
}

function rotate(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/** Degrees in [-180, 180), so a stored rotation never creeps past a full turn. */
export function normalizeDegrees(degrees: number): number {
  const turned = (((degrees + 180) % 360) + 360) % 360;
  return turned - 180;
}

// ---------------------------------------------------------------------------
// Snapping

/** A snap line drawn while dragging. `vertical` lines sit at an x, `horizontal` at a y. */
export interface Guide {
  axis: "vertical" | "horizontal";
  position: number;
  /** What the line belongs to: the canvas, or the id of the placement it was taken from. */
  source: string;
}

/** Lines a moving box may snap to, per axis. */
export interface SnapTargets {
  vertical: ReadonlyArray<{ position: number; source: string }>;
  horizontal: ReadonlyArray<{ position: number; source: string }>;
}

export const CANVAS_GUIDE_SOURCE = "canvas";

/**
 * The canvas's edges and centre lines, and every other box's edges and
 * centres. Rotated boxes contribute their unrotated lines: snapping is a
 * placement aid, and a rotated box's bounds rarely line up with anything
 * anyway.
 */
export function snapTargets(canvas: CanvasSize, others: ReadonlyArray<{ id: string; box: Box }>): SnapTargets {
  const vertical = [0, canvas.width / 2, canvas.width].map((position) => ({
    position,
    source: CANVAS_GUIDE_SOURCE,
  }));
  const horizontal = [0, canvas.height / 2, canvas.height].map((position) => ({
    position,
    source: CANVAS_GUIDE_SOURCE,
  }));
  for (const { id, box } of others) {
    vertical.push(
      { position: box.x, source: id },
      { position: box.x + box.width / 2, source: id },
      { position: box.x + box.width, source: id }
    );
    horizontal.push(
      { position: box.y, source: id },
      { position: box.y + box.height / 2, source: id },
      { position: box.y + box.height, source: id }
    );
  }
  return { vertical, horizontal };
}

/**
 * The shift along one axis that brings the nearest of `lines` (a box's
 * edges and centre on that axis) onto a target within `distance`, and the
 * guides that shift lines up with. Zero shift and no guides when nothing is
 * close enough.
 */
function snapAxis(
  lines: readonly number[],
  targets: ReadonlyArray<{ position: number; source: string }>,
  distance: number,
  axis: Guide["axis"]
): { shift: number; guides: Guide[] } {
  let best: number | null = null;
  for (const line of lines) {
    for (const target of targets) {
      const shift = target.position - line;
      if (Math.abs(shift) <= distance && (best === null || Math.abs(shift) < Math.abs(best))) {
        best = shift;
      }
    }
  }
  if (best === null) {
    return { shift: 0, guides: [] };
  }
  const shift = best;
  const guides: Guide[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const target of targets) {
      const key = `${target.position}:${target.source}`;
      if (Math.abs(line + shift - target.position) < 0.5 && !seen.has(key)) {
        seen.add(key);
        guides.push({ axis, position: target.position, source: target.source });
      }
    }
  }
  return { shift, guides };
}

/**
 * `box` moved onto the nearest guide on each axis within `distance`: its
 * left, centre or right onto a vertical line, its top, middle or bottom onto
 * a horizontal one.
 */
export function snapBox(
  box: Pick<Box, "x" | "y" | "width" | "height">,
  targets: SnapTargets,
  distance: number
): { x: number; y: number; guides: Guide[] } {
  const vertical = snapAxis([box.x, box.x + box.width / 2, box.x + box.width], targets.vertical, distance, "vertical");
  const horizontal = snapAxis(
    [box.y, box.y + box.height / 2, box.y + box.height],
    targets.horizontal,
    distance,
    "horizontal"
  );
  return { x: box.x + vertical.shift, y: box.y + horizontal.shift, guides: [...vertical.guides, ...horizontal.guides] };
}

// ---------------------------------------------------------------------------
// Resize and rotate

/** A resize handle, by the compass point it sits at. */
export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const RESIZE_HANDLES: readonly ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/** Which way a handle pulls each side: -1 the left or top side, 1 the right or bottom, 0 neither. */
function handleDirection(handle: ResizeHandle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  return {
    x: handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0,
    y: handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0,
  };
}

export interface ResizeOptions {
  /** Keep the width-to-height ratio the box started with. */
  keepAspect: boolean;
  minSize: number;
}

/**
 * `start` resized by dragging `handle` by `delta` (canvas pixels, unrotated
 * screen axes). The side opposite the handle stays where it was on the
 * canvas, rotated or not: the drag is measured along the box's own axes,
 * and the box is placed back so the opposite side's midpoint (or corner)
 * does not move. A handle on an edge keeps its aspect by growing the other
 * side about the centre line.
 */
export function resizeBox(start: Box, handle: ResizeHandle, delta: Point, options: ResizeOptions): Box {
  assert(start.width > 0 && start.height > 0, "a box with no area cannot be resized");
  const direction = handleDirection(handle);
  const local = rotate(delta, -start.rotation);
  let width = start.width + direction.x * local.x;
  let height = start.height + direction.y * local.y;
  if (options.keepAspect) {
    const ratio = start.width / start.height;
    const minScale = Math.max(options.minSize / start.width, options.minSize / start.height);
    let scale: number;
    if (direction.x !== 0 && direction.y !== 0) {
      const scaleX = width / start.width;
      const scaleY = height / start.height;
      scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    } else if (direction.x !== 0) {
      scale = width / start.width;
    } else {
      scale = height / start.height;
    }
    scale = Math.max(minScale, scale);
    width = start.width * scale;
    height = width / ratio;
  } else {
    width = Math.max(options.minSize, width);
    height = Math.max(options.minSize, height);
  }
  const center = centerOf(start);
  const anchorOffset = rotate(
    { x: (-direction.x * start.width) / 2, y: (-direction.y * start.height) / 2 },
    start.rotation
  );
  const anchor = { x: center.x + anchorOffset.x, y: center.y + anchorOffset.y };
  const newOffset = rotate({ x: (-direction.x * width) / 2, y: (-direction.y * height) / 2 }, start.rotation);
  const newCenter = { x: anchor.x - newOffset.x, y: anchor.y - newOffset.y };
  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  return {
    x: Math.round(newCenter.x - roundedWidth / 2),
    y: Math.round(newCenter.y - roundedHeight / 2),
    width: roundedWidth,
    height: roundedHeight,
    rotation: start.rotation,
  };
}

/**
 * An unrotated `box` being resized by `handle`, with the sides the handle
 * moves snapped onto the nearest guide within `distance`. The sides it does
 * not move stay put, and neither side shrinks below `minSize`.
 */
export function snapResize(
  box: Box,
  handle: ResizeHandle,
  targets: SnapTargets,
  distance: number,
  minSize: number
): { box: Box; guides: Guide[] } {
  const direction = handleDirection(handle);
  let { x, y, width, height } = box;
  const guides: Guide[] = [];
  if (direction.x !== 0) {
    const edge = direction.x === 1 ? x + width : x;
    const snapped = snapAxis([edge], targets.vertical, distance, "vertical");
    const grown = width + direction.x * snapped.shift;
    if (snapped.guides.length > 0 && grown >= minSize) {
      width = grown;
      x = direction.x === 1 ? x : x + snapped.shift;
      guides.push(...snapped.guides);
    }
  }
  if (direction.y !== 0) {
    const edge = direction.y === 1 ? y + height : y;
    const snapped = snapAxis([edge], targets.horizontal, distance, "horizontal");
    const grown = height + direction.y * snapped.shift;
    if (snapped.guides.length > 0 && grown >= minSize) {
      height = grown;
      y = direction.y === 1 ? y : y + snapped.shift;
      guides.push(...snapped.guides);
    }
  }
  return { box: { ...box, x, y, width, height }, guides };
}

/**
 * The rotation after turning about `center` from where the pointer started
 * to where it is, added to `startRotation`. With `snap`, the result lands on
 * a multiple of `ROTATION_SNAP_DEGREES`.
 */
export function rotationAt(center: Point, from: Point, to: Point, startRotation: number, snap: boolean): number {
  const angleFrom = Math.atan2(from.y - center.y, from.x - center.x);
  const angleTo = Math.atan2(to.y - center.y, to.x - center.x);
  const turned = startRotation + ((angleTo - angleFrom) * 180) / Math.PI;
  const rotation = snap ? Math.round(turned / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES : turned;
  return normalizeDegrees(Math.round(rotation * 100) / 100);
}
