// The scene as a document, and the ops that change it.
//
// sceneManager holds each scene's documents and stamps every change to a
// version with that version's next sequence number; each overlay applies the
// same ops in the same order, so every copy of the scene (OBS, the editor
// preview) ends up identical without reloading. The document, its json0 ops
// and their wire shapes are shared with the dashboard's scene editor, so they
// live in the api package; this module adds what only the page needs.

import { type SceneDocument, type SceneSnapshot, stackOrder } from "@woofx3/api/scene-editor/document";
import { evenKeys, type PlacementDocument } from "@woofx3/scene/model";
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
      ...(meta.behaviorKinds === undefined ? {} : { behaviorKinds: meta.behaviorKinds }),
      visible: placement.visible,
    });
  }
  return { id: snapshot.sceneId, name: snapshot.name, layout: snapshot.doc.layout, widgets };
}

/**
 * The composition the page plays for a config: the config's placements, in
 * its order, where it puts them and with its settings and visibility, which
 * are what the page fetched last (the saved scene, or the editor's draft).
 * What a config does not carry (rotation, opacity, name, behaviors) comes
 * from the scene's document, `base`, and a placement it does not hold yet
 * takes the defaults, or the rotation and opacity the editor's draft
 * placement (`drafts`) gives.
 */
export function compositionOfConfig(
  config: SceneConfig,
  base: SceneDocument | null,
  drafts: readonly unknown[] | null = null
): SceneDocument {
  const draftById = new Map<string, Record<string, unknown>>();
  for (const raw of drafts ?? []) {
    if (typeof raw === "object" && raw !== null && typeof (raw as { id?: unknown }).id === "string") {
      draftById.set((raw as { id: string }).id, raw as Record<string, unknown>);
    }
  }
  const zKeys = evenKeys(config.widgets.length);
  const widgets: Record<string, PlacementDocument> = {};
  config.widgets.forEach((instance, index) => {
    const saved = base && Object.hasOwn(base.widgets, instance.id) ? base.widgets[instance.id] : undefined;
    const draft = draftById.get(instance.id);
    widgets[instance.id] = {
      name: saved?.name ?? "",
      locked: saved?.locked ?? false,
      extra: saved?.extra ?? {},
      widget: instance.widgetCanonicalId,
      x: instance.position.x,
      y: instance.position.y,
      width: instance.position.width,
      height: instance.position.height,
      visible: instance.visible !== false,
      z: zKeys[index] as string,
      settings: instance.settings,
      rotation: finiteOr(draft?.rotation, saved?.rotation ?? 0),
      opacity: opacityOr(draft?.opacity, saved?.opacity ?? 1),
    };
  });
  return { layout: config.layout, widgets, behaviors: base?.behaviors ?? {} };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function opacityOr(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 0 && value <= 1 ? value : fallback;
}
