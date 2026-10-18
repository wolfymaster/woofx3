// The scene config the scene manager hands an overlay page, inlined in the
// shell (`window.__WOOFX3_SCENE__`) and answered by `GET /scene/{sceneId}/config`,
// and what the page reads back from a scene snapshot. Both ends import it.

import type { SceneSnapshot } from "@woofx3/api/scene-editor/document";
import { stackOrder } from "@woofx3/api/scene-editor/document";
import { THEME_SETTING_ID } from "@woofx3/api/ui-schema";
import type { DeclaredBehaviorKinds } from "@woofx3/scene/model";

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
  /** The engine's media proxy URL prefix, for a widget whose frame runs
   *  under the theme policy (see `PlacementMeta.mediaProxyBase`). */
  mediaProxyBase?: string;
  /** The kinds the widget declares it plays itself (see
   *  `PlacementMeta.behaviorKinds`); absent means none. */
  behaviorKinds?: DeclaredBehaviorKinds;
  /** False for a placement hidden in the editor; absent means shown. */
  visible?: boolean;
}

export interface SceneConfig {
  id: string;
  name: string;
  layout: Record<string, unknown>;
  widgets: WidgetPlacementConfig[];
}

/** The theme a placement's settings select, "" for none: the one reading of the theme setting. */
export function themeOf(settings: Record<string, unknown>): string {
  const value = settings[THEME_SETTING_ID];
  return typeof value === "string" ? value.trim() : "";
}

/** The page's config for a snapshot: placements in stacking order. A
 *  placement with no meta is left out until its meta arrives. */
export function configOfSnapshot(snapshot: SceneSnapshot): SceneConfig {
  const widgets: WidgetPlacementConfig[] = [];
  for (const id of stackOrder(snapshot.doc)) {
    const placement = snapshot.doc.widgets[id]!;
    const meta = snapshot.meta[id];
    if (!meta) {
      continue;
    }
    widgets.push({
      id,
      widgetCanonicalId: placement.widget,
      moduleId: meta.moduleId,
      position: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
      settings: placement.settings,
      hostsSurface: meta.hostsSurface,
      frameUrl: meta.frameUrl,
      linkedResources: meta.linkedResources,
      ...(meta.mediaProxyBase === undefined ? {} : { mediaProxyBase: meta.mediaProxyBase }),
      ...(meta.behaviorKinds === undefined ? {} : { behaviorKinds: meta.behaviorKinds }),
      visible: placement.visible,
    });
  }
  return { id: snapshot.sceneId, name: snapshot.name, layout: snapshot.doc.layout, widgets };
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
