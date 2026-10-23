// One alert as the scene manager records it on a scene event and pushes it to
// an overlay page, which plays it. Both ends import it.

import { alertCompositionOf, type CompositionDocument, moduleIdOfCanonicalId, type NodeId } from "@woofx3/scene/model";

/**
 * Where one widget of an alert loads from and what boots it, as a scene
 * placement's config says for a placement: the widget's frame document, shared
 * by every placement and alert that shows the widget and cached by the
 * browser, and the linked resources the page hands it in the frame URL's
 * fragment with the widget's settings.
 */
export interface AlertWidgetFrame {
  /** `/frames/{moduleId}/{manifestId}?theme={id}&v={version}`. */
  frameUrl: string;
  linkedResources: Record<string, string>;
  /**
   * Set for a widget whose frame runs under the theme policy: the engine's
   * media proxy prefix its external media is signed under as the delivery is
   * sent to a page, never as it is stored.
   */
  mediaProxyBase?: string;
}

export interface AlertDelivery {
  alertId: string;
  /**
   * The engine's alert log row for this play, which lifecycle reports name.
   * Absent when the engine recorded no row.
   */
  rowId?: string;
  /**
   * The alert as a composition, every widget one the catalog lets play in an
   * alert, under its canonical id (`{moduleId}:widget:{manifestId}`).
   */
  layout: CompositionDocument;
  /** How each widget of `layout` is framed, by its id in the layout. */
  frames: Record<NodeId, AlertWidgetFrame>;
  /** The CloudEvent that triggered the workflow; null when nothing did (a manual or scheduled run). */
  event: { type: string; data: unknown } | null;
}

/**
 * The alert in a delivery's value, or null for one that cannot be played: no
 * layout, a canvas with no size, or a widget with no canonical id or no frame
 * to load. A layout in the older list shape is converted.
 */
export function parseAlertDelivery(raw: unknown): AlertDelivery | null {
  if (!isRecord(raw) || typeof raw.alertId !== "string") {
    return null;
  }
  const layout = alertCompositionOf(raw.layout);
  if (layout === null || !isPositive(layout.layout.width) || !isPositive(layout.layout.height)) {
    return null;
  }
  if (!isRecord(raw.frames)) {
    return null;
  }
  const frames: Record<NodeId, AlertWidgetFrame> = {};
  for (const [widgetId, placement] of Object.entries(layout.widgets)) {
    // A widget's frame, status and files are all keyed by its module.
    if (moduleIdOfCanonicalId(placement.widget) === null) {
      return null;
    }
    const frame = parseWidgetFrame(raw.frames[widgetId]);
    if (frame === null) {
      return null;
    }
    frames[widgetId] = frame;
  }
  return {
    alertId: raw.alertId,
    ...(typeof raw.rowId === "string" ? { rowId: raw.rowId } : {}),
    layout,
    frames,
    event: parseEvent(raw.event),
  };
}

function parseWidgetFrame(raw: unknown): AlertWidgetFrame | null {
  if (!isRecord(raw) || typeof raw.frameUrl !== "string" || raw.frameUrl === "") {
    return null;
  }
  const linkedResources: Record<string, string> = {};
  if (isRecord(raw.linkedResources)) {
    for (const [settingId, canonicalId] of Object.entries(raw.linkedResources)) {
      if (typeof canonicalId === "string") {
        linkedResources[settingId] = canonicalId;
      }
    }
  }
  return {
    frameUrl: raw.frameUrl,
    linkedResources,
    ...(typeof raw.mediaProxyBase === "string" ? { mediaProxyBase: raw.mediaProxyBase } : {}),
  };
}

function parseEvent(raw: unknown): AlertDelivery["event"] {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    return null;
  }
  return { type: raw.type, data: raw.data ?? null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
