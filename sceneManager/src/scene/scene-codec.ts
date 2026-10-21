// A scene's stored state and its document, each way: the document the
// scene documents hold and the editor edits, built from what a load read,
// and the row columns a write stores it as.

import type { SceneDocument, Version } from "@woofx3/api/scene-editor";
import { stackOrder, zKey } from "@woofx3/api/scene-editor";
import { placementOfStored, STRICT_REGISTRY, storedOfPlacement } from "@woofx3/scene/model";
import type { OverlaySceneState } from "./scene-host";

/**
 * The canvas a scene stored without a usable size is drawn on. The dashboard
 * already shows such a scene at this size; the editor refuses every move,
 * resize and add on a canvas with no size, so the document must carry the
 * size the user is looking at.
 */
const DEFAULT_CANVAS = { width: 1920, height: 1080 } as const;

function canvasDimensionOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * A scene state as a document: placements keyed by id, stacked as saved,
 * with the version's behaviors as stored. `inputs` is present only when the
 * composition declares some, so a scene's document has no such key.
 *
 * A layout without a usable width or height gets the default canvas.
 *
 * Entries stored in an older shape are brought to the current one by the
 * registry's migrations (a placement's `transitionIn` / `transitionOut` in
 * `extra` become transition behaviors), so everything past this point sees
 * one shape. The stored row changes only when the document is next written.
 */
export function documentOf(state: OverlaySceneState): SceneDocument {
  const widgets: SceneDocument["widgets"] = {};
  state.instances.forEach((instance, index) => {
    // Read as stored, so writing the scene back keeps the canonical id and
    // every field the document does not model. An instance built without
    // its entry (tests, previews) reads as the entry its fields describe.
    const stored = instance.stored ?? {
      id: instance.id,
      widgetCanonicalId: instance.widgetCanonicalId,
      position: { x: instance.position.x, y: instance.position.y },
      size: { width: instance.position.width, height: instance.position.height },
      visible: instance.visible,
      settings: instance.settings,
    };
    const placement = placementOfStored(stored, zKey(index));
    widgets[instance.id] = placement.widget === "" ? { ...placement, widget: instance.widgetCanonicalId } : placement;
  });
  const layout = {
    ...state.layout,
    width: canvasDimensionOr(state.layout.width, DEFAULT_CANVAS.width),
    height: canvasDimensionOr(state.layout.height, DEFAULT_CANVAS.height),
  };
  const doc: SceneDocument = { layout, widgets, behaviors: structuredClone(state.behaviors) };
  if (state.inputs.length > 0) {
    doc.inputs = structuredClone(state.inputs);
  }
  return STRICT_REGISTRY.migrateDocument(doc);
}

/**
 * A document in the shapes the database stores and the editor reads, with
 * the placements a load could not read (`StoredUnread`) kept as stored:
 * `widgets_json` is the placements in stacking order, each as the editor
 * writes one, `layout_json` the layout and `behaviors_json` the behaviors.
 * Inputs are not among them: the editor never changes them, so they are
 * written only where they are set (the api), and a write from here never
 * races one there.
 */
export function storedSceneOf(
  doc: SceneDocument,
  unreadPlacements: readonly unknown[] = []
): { widgetsJson: string; layoutJson: string; behaviorsJson: string } {
  const widgets: unknown[] = stackOrder(doc).map((id, index) => storedOfPlacement(id, doc.widgets[id]!, index));
  // After the placements the document holds, so a placement the loader could
  // not read stays in the row instead of being deleted by this write.
  widgets.push(...unreadPlacements);
  return {
    widgetsJson: JSON.stringify(widgets),
    layoutJson: JSON.stringify(doc.layout),
    behaviorsJson: JSON.stringify(doc.behaviors),
  };
}

/**
 * A digest of both documents that does not depend on key order. Stored with
 * the editor state, so a load can tell whether the documents it read are the
 * ones the stored head describes (see `restoredEditorState`).
 */
export function documentsDigest(docs: Readonly<Record<Version, SceneDocument>>): string {
  return Bun.hash(canonicalJson({ draft: docs.draft, published: docs.published })).toString(36);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}
