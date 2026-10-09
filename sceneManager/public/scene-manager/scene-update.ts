// What a saved scene change means for the widgets already on the page.
//
// A save used to reload the whole overlay, restarting every widget on stream
// to apply a change to one. The page instead fetches the saved config and
// works out, per placement, the least it has to do. A placement whose frame
// document is the same keeps its frame: it is moved, and its settings are
// patched in or, when the widget's script read a changed one, it is swapped
// for a fresh frame once that has painted. Only a different frame document
// (another widget, version or theme) means a new frame for that reason.

import type { PlacementTransition } from "@woofx3/module-sdk";

export interface WidgetPlacementConfig {
  id: string;
  widgetCanonicalId: string;
  moduleId: string;
  position: { x: number; y: number; width: number; height: number };
  settings: Record<string, unknown>;
  /** "alert" for an alert widget, which the page draws itself; "" otherwise. */
  hostsSurface: string;
  frameUrl: string;
  /** The resource instances the widget's module links, handed to the frame. */
  linkedResources?: Record<string, string>;
  /** False for a placement hidden in the editor; absent means shown. */
  visible?: boolean;
  /** How the placement enters and leaves; absent means it simply appears
   *  and disappears. */
  transitionIn?: PlacementTransition;
  transitionOut?: PlacementTransition;
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
  /** New placements. */
  mount: WidgetPlacementConfig[];
  /** Placements whose frame document differs: swapped for a new frame. */
  replace: WidgetPlacementConfig[];
  /** Placements whose frame stays: re-placed, and their settings brought up to date. */
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
    replace: [],
    place: [],
    order: next.map((placement) => placement.id),
  };
  for (const placement of next) {
    const existing = currentById.get(placement.id);
    if (!existing) {
      plan.mount.push(placement);
    } else if (sameFrame(existing, placement)) {
      plan.place.push(placement);
    } else {
      plan.replace.push(placement);
    }
  }
  return plan;
}

/**
 * Whether two placements load the same frame document. The frame URL names
 * exactly that (widget, version, theme); settings are not part of it, since
 * the page hands them to the frame. An alert area has no frame of its own and
 * is drawn from its settings, so for one they are part of it.
 */
function sameFrame(a: WidgetPlacementConfig, b: WidgetPlacementConfig): boolean {
  return (
    a.widgetCanonicalId === b.widgetCanonicalId &&
    a.moduleId === b.moduleId &&
    a.hostsSurface === b.hostsSurface &&
    a.frameUrl === b.frameUrl &&
    (a.hostsSurface === "" || sameValue(a.settings, b.settings))
  );
}

/** The settings a widget's script has read; `all` when it read every one. */
export interface SettingsReads {
  all: boolean;
  keys: ReadonlySet<string>;
}

/**
 * What a change of settings takes for a widget whose frame stays. `patch`
 * hands them over and the shim updates the widget's bindings in place;
 * `reload` swaps in a fresh frame, needed when the widget's script read a
 * setting that changed, or when what it read is not known yet.
 */
export function settingsUpdate(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  reads: SettingsReads | null
): "none" | "patch" | "reload" {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  const changed = [...keys].filter((key) => !sameValue(current[key], next[key]));
  if (changed.length === 0) {
    return "none";
  }
  if (reads === null || reads.all || changed.some((key) => reads.keys.has(key))) {
    return "reload";
  }
  return "patch";
}

/** The setting a widget's theme is chosen by. Matches THEME_SETTING_ID on the server. */
const THEME_SETTING_ID = "theme";

/** The theme a set of settings selects, "" for none. */
export function themeOf(settings: Record<string, unknown>): string {
  const value = settings[THEME_SETTING_ID];
  return typeof value === "string" ? value.trim() : "";
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
