// The scene as a document, and the ops that change it.
//
// sceneManager holds each scene's documents and stamps every change to a
// version with that version's next sequence number; each overlay applies the
// same ops in the same order, so every copy of the scene (OBS, the editor
// preview) ends up identical without reloading. The document, its json0 ops
// and their wire shapes are shared with the dashboard's scene editor, so they
// live in the api package; this module adds what only the page needs.

import { type SceneSnapshot, stackOrder } from "@woofx3/api/scene-editor/document";
import type { SceneConfig, WidgetPlacementConfig } from "./scene-update";

export {
  applyOps,
  diffDocuments,
  type Json0Component,
  mergeMeta,
  type PlacementDocument,
  type PlacementMeta,
  parseSceneOpsEvent,
  parseSnapshot,
  type SceneDocument,
  type SceneOpsEvent,
  type SceneSnapshot,
  stackOrder,
  transformOps,
  zKey,
} from "@woofx3/api/scene-editor/document";

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
      visible: placement.visible,
    });
  }
  return { id: snapshot.sceneId, name: snapshot.name, layout: snapshot.doc.layout, widgets };
}
