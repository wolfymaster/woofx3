// The names alerts are routed by. An alert widget placement answers to its
// `name` setting, an Alert workflow step plays on its `target` parameter, and
// sceneManager plays a step on every alert widget whose name equals the
// step's target. A blank name or target on either side means the default, so
// a step nobody configured reaches the alert widget nobody renamed.
//
// sceneManager (sceneManager/src/scene/alert-layout.ts), this package's
// editor, and the dashboard all read names through these functions, so they
// cannot disagree about which widget an alert reaches.

/** What a scene's first alert widget is called, and what a step with no target plays on. */
export const DEFAULT_ALERT_WIDGET_NAME = "default";

/** The surface an alert widget hosts (a widget definition's `hostsSurface`). */
export const ALERT_SURFACE = "alert";

/** A name or target as alerts are routed by it: trimmed, and the default when blank or not text. */
export function alertRouteName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  return name || DEFAULT_ALERT_WIDGET_NAME;
}

/** The name an alert widget placement answers to: its `name` setting, or the default when blank. */
export function alertWidgetName(settings: Record<string, unknown> | undefined): string {
  return alertRouteName(settings?.name);
}

/**
 * A name for a new alert widget among alert widgets that already answer to
 * `existing`: the default for the first, then the first free `alert-N`, so
 * two never share a name by accident.
 */
export function nextAlertWidgetName(existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(DEFAULT_ALERT_WIDGET_NAME)) {
    return DEFAULT_ALERT_WIDGET_NAME;
  }
  for (let n = 2; ; n++) {
    const candidate = `alert-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
