// What a saved scene change means for the widgets already on the page.
//
// A save used to reload the whole overlay, restarting every widget on stream
// to apply a change to one. The page instead fetches the saved config and
// works out, per placement, the least it has to do: a placement whose frame
// would come out the same is only moved, and only a placement whose frame
// would differ is mounted again.

export interface WidgetPlacementConfig {
  id: string;
  widgetCanonicalId: string;
  moduleId: string;
  position: { x: number; y: number; width: number; height: number };
  settings: Record<string, unknown>;
  /** "alert" for an alert widget, which the page draws itself; "" otherwise. */
  hostsSurface: string;
  frameUrl: string;
}

export interface SceneConfig {
  id: string;
  name: string;
  layout: Record<string, unknown>;
  widgets: WidgetPlacementConfig[];
}

export interface ScenePlan {
  /** Placements no longer on the scene. */
  remove: string[];
  /** Placements to mount: new ones, and changed ones after their old mount is removed. */
  mount: WidgetPlacementConfig[];
  /** Placements kept as they are, re-placed in case they moved. */
  place: WidgetPlacementConfig[];
  /** Every placement id, bottom of the stack first. */
  order: string[];
}

export function planSceneUpdate(
  current: readonly WidgetPlacementConfig[],
  next: readonly WidgetPlacementConfig[]
): ScenePlan {
  const currentById = new Map(current.map((placement) => [placement.id, placement]));
  const nextIds = new Set(next.map((placement) => placement.id));
  const plan: ScenePlan = {
    remove: current.filter((placement) => !nextIds.has(placement.id)).map((placement) => placement.id),
    mount: [],
    place: [],
    order: next.map((placement) => placement.id),
  };
  for (const placement of next) {
    const existing = currentById.get(placement.id);
    if (existing && sameFrame(existing, placement)) {
      plan.place.push(placement);
      continue;
    }
    if (existing) {
      plan.remove.push(placement.id);
    }
    plan.mount.push(placement);
  }
  return plan;
}

/**
 * Whether two placements render the same frame. Settings are part of it: the
 * server writes them into the frame document, so a frame never sees a change
 * to them without loading again. The frame URL is not: a saved frame and a
 * draft frame of the same placement and settings render the same thing, so a
 * save that matches the draft on screen reloads nothing.
 */
function sameFrame(a: WidgetPlacementConfig, b: WidgetPlacementConfig): boolean {
  return (
    a.widgetCanonicalId === b.widgetCanonicalId &&
    a.moduleId === b.moduleId &&
    a.hostsSurface === b.hostsSurface &&
    sameValue(a.settings, b.settings)
  );
}

/** The setting a widget's theme is chosen by. Matches THEME_SETTING_ID on the server. */
const THEME_SETTING_ID = "theme";

/** The theme a set of settings selects, "" for none. */
export function themeOf(settings: Record<string, unknown>): string {
  const value = settings[THEME_SETTING_ID];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Whether a widget that takes settings changes itself (`host.onSettings`) can
 * be handed `next` in place of `current` without loading again. Every setting
 * can but the theme, which the server applies to the frame before the widget
 * runs.
 */
export function canChangeSettingsLive(current: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return themeOf(current) === themeOf(next);
}

/** Structural equality for JSON values, ignoring object key order. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) {
    return false;
  }
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]));
}

/** The scene in a `GET /scene/{sceneId}/config` response, or null when the body is not one. */
export function parseSceneConfig(body: unknown): SceneConfig | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const scene = (body as { scene?: unknown }).scene;
  if (typeof scene !== "object" || scene === null) {
    return null;
  }
  const s = scene as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.layout !== "object" || s.layout === null || !Array.isArray(s.widgets)) {
    return null;
  }
  return {
    id: s.id,
    name: typeof s.name === "string" ? s.name : "",
    layout: s.layout as Record<string, unknown>,
    widgets: s.widgets as WidgetPlacementConfig[],
  };
}
