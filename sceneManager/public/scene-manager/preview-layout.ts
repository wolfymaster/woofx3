// Live layout for the dashboard's scene editor preview.
//
// The editor embeds this overlay as its canvas preview. The overlay only
// knows the scene as last saved, so while a widget is being dragged the
// editor posts its draft layout here and the page lays it over the scene as
// the runtime's transient state (`transientOfPreviewLayout`) -- without
// saving and without reloading any widget.
// The message also carries the draft placements themselves, so a widget
// added or reconfigured in the editor shows before it is saved; only that
// widget reloads, into a frame rendering the draft. Nothing is persisted: a
// reload renders the saved scene again.
//
// The message shape must match `buildPreviewLayoutMessage` in the
// dashboard (woofx3-ui client/src/lib/scene-preview-layout.ts).

import { evenKeys, type NodeId } from "@woofx3/scene/model";
import type { TransientOverrides } from "@woofx3/scene/runtime";
import { themeOf } from "./scene-update";

export const PREVIEW_LAYOUT_MESSAGE = "woofx3.scene-preview.layout";

export interface PreviewWidgetLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise; absent from an editor that does not send it. */
  rotation?: number;
  /** 0 to 1; absent from an editor that does not send it. */
  opacity?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseWidget(raw: unknown): PreviewWidgetLayout | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== "string" || w.id.length === 0) {
    return null;
  }
  if (!isFiniteNumber(w.x) || !isFiniteNumber(w.y) || !isFiniteNumber(w.width) || !isFiniteNumber(w.height)) {
    return null;
  }
  const widget: PreviewWidgetLayout = { id: w.id, x: w.x, y: w.y, width: w.width, height: w.height };
  if (isFiniteNumber(w.rotation)) {
    widget.rotation = w.rotation;
  }
  if (isFiniteNumber(w.opacity) && w.opacity >= 0 && w.opacity <= 1) {
    widget.opacity = w.opacity;
  }
  return widget;
}

/** The widgets of a layout message, or null for anything else posted to the page. */
export function parsePreviewLayout(data: unknown): PreviewWidgetLayout[] | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const message = data as Record<string, unknown>;
  if (message.type !== PREVIEW_LAYOUT_MESSAGE || !Array.isArray(message.widgets)) {
    return null;
  }
  const widgets: PreviewWidgetLayout[] = [];
  for (const raw of message.widgets) {
    const widget = parseWidget(raw);
    if (widget) {
      widgets.push(widget);
    }
  }
  return widgets;
}

/**
 * The editor's unsaved placements a layout message carries, as the editor
 * stores them, or null when it carries none. They are not validated here: the
 * server parses them exactly as it parses a saved scene (see
 * `POST /scene/{sceneId}/draft-config`).
 */
export function parsePreviewPlacements(data: unknown): unknown[] | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const message = data as Record<string, unknown>;
  if (message.type !== PREVIEW_LAYOUT_MESSAGE || !Array.isArray(message.placements)) {
    return null;
  }
  return message.placements;
}

/**
 * What decides the frames of a set of placements: which widgets there are and
 * their themes. A drag changes only positions, which the layout applies on its
 * own, and other settings are handed to the widgets directly, so only a change
 * to this needs the server. A placement the page draws itself (an alert area,
 * `drawnByPage`) is mounted again for any change, so all its settings count.
 */
export function draftFrameKey(
  placements: readonly unknown[],
  drawnByPage: (id: string) => boolean = () => false
): string {
  return JSON.stringify(
    placements.map((raw) => {
      const placement = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      const drawn = typeof placement.id === "string" && drawnByPage(placement.id);
      return [placement.id, placement.widgetCanonicalId, drawn ? placement.settings : themeOf(settingsOf(placement))];
    })
  );
}

/** A placement's settings as the server reads them: an object, or none. */
export function settingsOf(placement: Record<string, unknown>): Record<string, unknown> {
  const settings = placement.settings;
  return typeof settings === "object" && settings !== null && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : {};
}

/**
 * The editor's draft layout as transient state over the scene's widgets
 * (`ids`): each listed widget where the layout puts it, stacked in the
 * layout's order (bottom first). A widget the layout leaves out has been
 * removed in the editor, so it is made fully transparent rather than left
 * standing where it was saved; its frame keeps running in case the removal
 * is undone.
 */
export function transientOfPreviewLayout(layout: PreviewWidgetLayout[], ids: Iterable<NodeId>): TransientOverrides {
  const transient: Record<NodeId, TransientOverrides[NodeId]> = {};
  const zKeys = evenKeys(layout.length);
  layout.forEach((widget, index) => {
    transient[widget.id] = {
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
      z: zKeys[index] as string,
      ...(widget.rotation === undefined ? {} : { rotation: widget.rotation }),
      ...(widget.opacity === undefined ? {} : { opacity: widget.opacity }),
    };
  });
  for (const id of ids) {
    if (!Object.hasOwn(transient, id)) {
      transient[id] = { opacity: 0 };
    }
  }
  return transient;
}
