import type { AlertPayload, LegacyAlertPayload } from "../types";
import { mediaWidget } from "./media-widget";

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

export const WIDGETS: Record<string, Widget> = {
  [mediaWidget.id]: mediaWidget,
};

export function lookupWidget(id: unknown): Widget | undefined {
  if (typeof id !== "string") {
    return undefined;
  }
  return WIDGETS[id];
}
