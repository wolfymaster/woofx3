// Live layout for the dashboard's scene editor preview.
//
// The editor embeds this overlay as its canvas preview. The overlay only
// knows the scene as last saved, so while a widget is being dragged the
// editor posts its draft layout here and the page moves its widget
// elements to match -- without saving and without reloading any widget.
// Nothing is persisted: a reload renders the saved scene again.
//
// The message shape must match `buildPreviewLayoutMessage` in the
// dashboard (woofx3-ui client/src/lib/scene-preview-layout.ts).

export const PREVIEW_LAYOUT_MESSAGE = "woofx3.scene-preview.layout";

export interface PreviewWidgetLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
  return { id: w.id, x: w.x, y: w.y, width: w.width, height: w.height };
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
 * Place each rendered widget where the layout puts it. A widget the layout
 * leaves out has been removed in the editor, so it is hidden rather than
 * left standing where it was saved.
 */
export function applyPreviewLayout(elements: ReadonlyMap<string, HTMLElement>, layout: PreviewWidgetLayout[]): void {
  const byId = new Map(layout.map((widget) => [widget.id, widget]));
  for (const [id, element] of elements) {
    const widget = byId.get(id);
    if (!widget) {
      element.style.display = "none";
      continue;
    }
    element.style.display = "";
    element.style.left = `${widget.x}px`;
    element.style.top = `${widget.y}px`;
    element.style.width = `${widget.width}px`;
    element.style.height = `${widget.height}px`;
  }
}
