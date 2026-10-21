// What the editor shows in its preview frame: the document as the canvas
// shows it, mid-gesture included, and the playhead.
//
// The overlay page embedded as the preview takes the editor's draft as a
// `woofx3.scene-preview.layout` message, so it moves widgets as they are
// dragged and shows unsaved placements without saving anything. The shape
// must match `parsePreviewLayout` and `parsePreviewPlacements` in
// sceneManager/public/scene-manager/preview-layout.ts. Placements go in the
// form the dashboard stores a scene's widgets, since the engine parses them
// exactly as it parses a saved scene.

import type { CompositionDocument, NodeId } from "../model/types";

export const PREVIEW_LAYOUT_MESSAGE = "woofx3.scene-preview.layout";

/** One frame of the preview. */
export interface PreviewFrame {
  /** The committed document with any gesture in progress applied. */
  doc: CompositionDocument;
  /** Placement ids bottom first. */
  order: readonly NodeId[];
  playheadMs: number;
  playing: boolean;
}

/** One placement in the form the dashboard stores a scene's widgets (see `storedOfPlacement` in model/stored-placement.ts). */
export interface PreviewPlacement {
  id: string;
  widgetCanonicalId: string;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  opacity: number;
  /** Rank in the stack, bottom 0. */
  zIndex: number;
  locked: boolean;
  visible: boolean;
  settings: Record<string, unknown>;
}

/**
 * Where one widget is drawn. The box is what every overlay reads; rotation,
 * opacity, visibility and rank were added later, so an overlay that does not
 * know them ignores them and keeps drawing the box.
 */
export interface PreviewWidgetLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise about the box's centre. */
  rotation: number;
  /** 0 to 1. */
  opacity: number;
  visible: boolean;
  /** Rank in the stack, bottom 0: the same as the widget's index in `widgets`. */
  zIndex: number;
}

export interface PreviewLayoutMessage {
  type: typeof PREVIEW_LAYOUT_MESSAGE;
  widgets: PreviewWidgetLayout[];
  /** Absent when the overlay follows the draft from the engine instead. */
  placements?: PreviewPlacement[];
}

/**
 * The layout message for a frame. Widgets go bottom first: the overlay
 * stacks placements in the order they arrive.
 */
export function buildPreviewLayoutMessage(
  frame: Pick<PreviewFrame, "doc" | "order">,
  options: { placements?: boolean } = {}
): PreviewLayoutMessage {
  const placed = frame.order.flatMap((id) => {
    const placement = frame.doc.widgets[id];
    return placement === undefined ? [] : [{ id, placement }];
  });
  const widgets = placed.map(({ id, placement }, zIndex) => ({
    id,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotation: placement.rotation,
    opacity: placement.opacity,
    visible: placement.visible,
    zIndex,
  }));
  if (options.placements === false) {
    return { type: PREVIEW_LAYOUT_MESSAGE, widgets };
  }
  return {
    type: PREVIEW_LAYOUT_MESSAGE,
    widgets,
    placements: placed.map(({ id, placement }, zIndex) => ({
      id,
      widgetCanonicalId: placement.widget,
      name: placement.name,
      position: { x: placement.x, y: placement.y },
      size: { width: placement.width, height: placement.height },
      rotation: placement.rotation,
      opacity: placement.opacity,
      zIndex,
      locked: placement.locked,
      visible: placement.visible,
      settings: placement.settings,
    })),
  };
}
