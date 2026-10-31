/**
 * The canvas a composition is drawn on when its layout names no usable size:
 * what the overlay renders, and what every editor shows and fits to.
 */
export const DEFAULT_CANVAS_SIZE = { width: 1920, height: 1080 } as const;

export interface CanvasDimensions {
  width: number;
  height: number;
}

function dimensionOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * A layout's canvas size. Each dimension that is not a positive number falls
 * back to the default on its own, so a stored layout missing its size (or one
 * half of it) is drawn, edited and fitted the same everywhere.
 */
export function canvasSizeOfLayout(layout: Record<string, unknown>): CanvasDimensions {
  return {
    width: dimensionOr(layout.width, DEFAULT_CANVAS_SIZE.width),
    height: dimensionOr(layout.height, DEFAULT_CANVAS_SIZE.height),
  };
}
