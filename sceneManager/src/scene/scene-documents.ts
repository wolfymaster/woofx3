import type { Logger } from "@woofx3/common/runtime";
// The document is the page's wire format, so it lives with the page.
import {
  type PlacementMeta,
  type SceneDocument,
  type SceneOpsEvent,
  type SceneSnapshot,
  diffDocuments,
  stackOrder,
  zKey,
} from "../../public/scene-manager/scene-document";
import { sameValue } from "../../public/scene-manager/scene-update";
import type { OverlaySceneState } from "./scene-host";

/** SSE event carrying a `SceneOpsEvent` to every overlay open on the scene. */
export const SCENE_OPS_EVENT = "scene-ops";

/** The slice of `OverlayHost` the documents load scenes through. */
export interface SceneLoader {
  loadFramedSceneById(sceneId: string): Promise<OverlaySceneState | null>;
}

/** The slice of `DeliveryStore` that pushes to a scene's open overlays. */
export interface SceneBroadcaster {
  broadcast(sceneId: string, event: string, data: unknown): void;
  connectedSceneIds(): string[];
}

/** The fields of a stored placement the document models; the rest go to `extra`. */
const MODELED_FIELDS = new Set([
  "id",
  "widgetCanonicalId",
  "widgetDefinitionRef",
  "name",
  "position",
  "size",
  "rotation",
  "opacity",
  "zIndex",
  "locked",
  "visible",
  "settings",
]);

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A scene state as a document: placements keyed by id, stacked as saved. */
export function documentOf(state: OverlaySceneState): SceneDocument {
  const widgets: SceneDocument["widgets"] = {};
  state.instances.forEach((instance, index) => {
    const stored = instance.stored ?? {};
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (!MODELED_FIELDS.has(key)) {
        extra[key] = value;
      }
    }
    widgets[instance.id] = {
      // As stored, so writing the scene back does not rewrite the id.
      widget: typeof stored.widgetCanonicalId === "string" ? stored.widgetCanonicalId : instance.widgetCanonicalId,
      x: instance.position.x,
      y: instance.position.y,
      width: instance.position.width,
      height: instance.position.height,
      visible: instance.visible,
      z: zKey(index),
      settings: instance.settings,
      name: typeof stored.name === "string" ? stored.name : "",
      rotation: numberOr(stored.rotation, 0),
      opacity: numberOr(stored.opacity, 1),
      locked: stored.locked === true,
      extra,
    };
  });
  return { layout: { ...state.layout }, widgets };
}

/**
 * A document in the shapes the database stores and the editor reads:
 * `widgets_json` is the placements in stacking order, each as the editor
 * writes one, and `layout_json` the layout.
 */
export function storedSceneOf(doc: SceneDocument): { widgetsJson: string; layoutJson: string } {
  const widgets = stackOrder(doc).map((id, index) => {
    const p = doc.widgets[id]!;
    return {
      ...p.extra,
      id,
      widgetCanonicalId: p.widget,
      name: p.name,
      position: { x: p.x, y: p.y },
      size: { width: p.width, height: p.height },
      rotation: p.rotation,
      opacity: p.opacity,
      zIndex: index,
      locked: p.locked,
      visible: p.visible,
      settings: p.settings,
    };
  });
  return { widgetsJson: JSON.stringify(widgets), layoutJson: JSON.stringify(doc.layout) };
}

/** What each placement of a framed scene state needs beyond the document. */
export function metaOf(state: OverlaySceneState): Record<string, PlacementMeta> {
  const meta: Record<string, PlacementMeta> = {};
  for (const instance of state.instances) {
    meta[instance.id] = {
      moduleId: instance.moduleId,
      hostsSurface: instance.hostsSurface,
      frameUrl: instance.frameUrl,
      linkedResources: instance.linkedResources ?? {},
    };
  }
  return meta;
}

/**
 * The scene documents of this process, and their sequencer.
 *
 * Each scene an overlay opens is held here as a document with a sequence
 * number. A saved change is diffed against it into json0 ops, stamped with
 * the next number and pushed to every overlay open on the scene, which
 * applies them in order. Nothing here is persisted: a scene is loaded again
 * from the database when an overlay opens it after a restart, and overlays
 * reload on a restart anyway (see the stream's boot id).
 */
export class SceneDocuments {
  private readonly scenes = new Map<string, SceneSnapshot>();
  /** One refresh at a time per scene, in the order saves arrive. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly loader: SceneLoader,
    private readonly broadcaster: SceneBroadcaster,
    private readonly logger: Logger
  ) {}

  /** The scene as it stands, loading it when no overlay has opened it yet. */
  async snapshot(sceneId: string): Promise<SceneSnapshot | null> {
    await this.queues.get(sceneId);
    const held = this.scenes.get(sceneId);
    if (held) {
      return held;
    }
    const state = await this.loader.loadFramedSceneById(sceneId);
    if (!state) {
      return null;
    }
    // A save may have landed while this loaded; the one that did wins.
    const raced = this.scenes.get(sceneId);
    if (raced) {
      return raced;
    }
    const snapshot: SceneSnapshot = {
      sceneId,
      name: state.name,
      seq: 0,
      doc: documentOf(state),
      meta: metaOf(state),
    };
    this.scenes.set(sceneId, snapshot);
    return snapshot;
  }

  /** The sequence number overlays of the scene should be at; 0 when none is held. */
  seqOf(sceneId: string): number {
    return this.scenes.get(sceneId)?.seq ?? 0;
  }

  /** The scene was saved: push what changed to its open overlays as ops. */
  refresh(sceneId: string): Promise<void> {
    const next = (this.queues.get(sceneId) ?? Promise.resolve())
      .then(() => this.applySave(sceneId))
      .catch((err) => {
        this.logger.warn("scene documents: applying a save failed", {
          sceneId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    this.queues.set(sceneId, next);
    void next.finally(() => {
      if (this.queues.get(sceneId) === next) {
        this.queues.delete(sceneId);
      }
    });
    return next;
  }

  private async applySave(sceneId: string): Promise<void> {
    const held = this.scenes.get(sceneId);
    if (!held) {
      // Nobody has it open; the next overlay to open it loads the save.
      return;
    }
    if (!this.broadcaster.connectedSceneIds().includes(sceneId)) {
      // Its overlays have all gone: drop it rather than keep it current.
      this.scenes.delete(sceneId);
      return;
    }
    const state = await this.loader.loadFramedSceneById(sceneId);
    if (!state) {
      return;
    }
    const doc = documentOf(state);
    const meta = metaOf(state);
    const ops = diffDocuments(held.doc, doc);
    const metaChanges: SceneOpsEvent["meta"] = {};
    for (const id of new Set([...Object.keys(held.meta), ...Object.keys(meta)])) {
      if (!sameValue(held.meta[id], meta[id])) {
        metaChanges[id] = meta[id] ?? null;
      }
    }
    if (ops.length === 0 && Object.keys(metaChanges).length === 0) {
      return;
    }
    const seq = held.seq + 1;
    this.scenes.set(sceneId, { sceneId, name: state.name, seq, doc, meta });
    const event: SceneOpsEvent = { seq, ops, meta: metaChanges };
    this.broadcaster.broadcast(sceneId, SCENE_OPS_EVENT, event);
  }
}
