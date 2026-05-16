import type { AlertPayload, LegacyAlertPayload } from "../types";

export interface WidgetInput {
  /**
   * Stable envelope id from the alert payload. Widgets should use this
   * as the rendered LegacyAlertPayload.id so React keys / effect deps
   * downstream don't churn on every parent re-render.
   */
  id: string;
  parameters: Record<string, unknown>;
  event: AlertPayload["event"];
}

export interface Widget {
  id: string;
  render(input: WidgetInput): LegacyAlertPayload | null;
}

/**
 * Central widget registry. Widgets are registered at bootstrap time:
 * - Built-in widgets are registered by `initBuiltinWidgets()` (fetches
 *   definitions from `/api/builtin-widgets` and resolves renderers).
 * - Module-packaged widgets register here when the UI receives a
 *   `module.widget.registered` webhook event (future).
 *
 * The record is keyed by widget id (which matches the `manifestId` from
 * the backend WidgetDefinition). `lookupWidget()` is the sole access
 * path and returns `undefined` for unknown ids — the caller should fall
 * through gracefully rather than crashing the overlay.
 */
export const WIDGETS: Record<string, Widget> = {};

/**
 * Register a single widget renderer. Overwrites any existing entry with
 * the same id (last-write-wins). Returns `true` when the id is new to
 * the registry, `false` when it replaced an existing entry.
 */
export function registerWidget(widget: Widget): boolean {
  const isNew = !(widget.id in WIDGETS);
  WIDGETS[widget.id] = widget;
  return isNew;
}

export function lookupWidget(id: unknown): Widget | undefined {
  if (typeof id !== "string") {
    return undefined;
  }
  return WIDGETS[id];
}
