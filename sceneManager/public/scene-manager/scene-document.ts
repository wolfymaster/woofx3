// The scene as a document, and the ops that change it.
//
// sceneManager holds one document per scene and stamps every change to it
// with the next sequence number; each overlay applies the same ops in the
// same order, so every copy of the scene (OBS, the editor preview) ends up
// identical without reloading. Ops are json0 (the `ot-json0` type ShareDB
// uses): a path into the document and what changes there, so they work for
// any widget's settings, and text changes travel as splices.
//
// This module is the wire format, so the page and the server both use it
// (the server imports it from here).

import json0Module from "ot-json0";
import type { SceneConfig, WidgetPlacementConfig } from "./scene-update";
import { sameValue } from "./scene-update";

const json0 = json0Module.type;

/** One placement. Widgets are keyed by placement id, so moving or editing
 *  one never shifts another's path. */
export interface PlacementDocument {
  /** The widget's canonical id. */
  widget: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  /** Stacking, bottom first, as a key that sorts as text (see `zKey`). */
  z: string;
  settings: Record<string, unknown>;
  /** What only the editor reads: overlays ignore these. */
  name: string;
  rotation: number;
  opacity: number;
  locked: boolean;
  /** Any other field a placement was stored with, kept as it was. */
  extra: Record<string, unknown>;
}

export interface SceneDocument {
  layout: Record<string, unknown>;
  widgets: Record<string, PlacementDocument>;
}

/** What a placement needs on the page that the document does not hold: it
 *  is worked out by the server from what is installed. */
export interface PlacementMeta {
  moduleId: string;
  hostsSurface: string;
  frameUrl: string;
  linkedResources: Record<string, string>;
}

/** A scene as an overlay starts from it, or resyncs to. */
export interface SceneSnapshot {
  sceneId: string;
  name: string;
  seq: number;
  doc: SceneDocument;
  meta: Record<string, PlacementMeta>;
}

/** One json0 op component. */
export interface Json0Component {
  p: (string | number)[];
  oi?: unknown;
  od?: unknown;
  si?: string;
  sd?: string;
}

/** The SSE `scene-ops` event: the ops for one sequence number, and the
 *  placements whose meta changed (null for one removed). */
export interface SceneOpsEvent {
  seq: number;
  ops: Json0Component[];
  meta: Record<string, PlacementMeta | null>;
  /** Which of the scene's versions changed; absent means published. */
  version?: "published" | "draft";
}

/** `doc` with `ops` applied; `doc` itself is left as it was. */
export function applyOps(doc: SceneDocument, ops: readonly Json0Component[]): SceneDocument {
  return json0.apply(structuredClone(doc), structuredClone([...ops])) as SceneDocument;
}

/**
 * `ops` rewritten to apply after `against`, which was applied first. `left`
 * means `ops` loses a tie (both inserting at one text position, or both
 * setting one value): the server transforms an editor's op this way against
 * what was applied before it, so what is already on everyone's screen wins.
 */
export function transformOps(
  ops: readonly Json0Component[],
  against: readonly Json0Component[],
  side: "left" | "right"
): Json0Component[] {
  return json0.transform(structuredClone([...ops]), structuredClone([...against]), side) as Json0Component[];
}

/**
 * The ops that turn `from` into `to`, as small as their shape allows: an
 * object is compared key by key, text changes as one splice, and anything
 * else is replaced whole.
 */
export function diffDocuments(from: SceneDocument, to: SceneDocument): Json0Component[] {
  const ops: Json0Component[] = [];
  diffValue([], from, to, ops);
  return ops;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diffValue(path: (string | number)[], from: unknown, to: unknown, ops: Json0Component[]): void {
  if (sameValue(from, to)) {
    return;
  }
  if (isPlainObject(from) && isPlainObject(to)) {
    for (const key of Object.keys(from)) {
      if (!Object.hasOwn(to, key)) {
        ops.push({ p: [...path, key], od: from[key] });
      }
    }
    for (const key of Object.keys(to)) {
      if (!Object.hasOwn(from, key)) {
        ops.push({ p: [...path, key], oi: to[key] });
      } else {
        diffValue([...path, key], from[key], to[key], ops);
      }
    }
    return;
  }
  if (typeof from === "string" && typeof to === "string" && path.length > 0) {
    let start = 0;
    while (start < from.length && start < to.length && from[start] === to[start]) {
      start++;
    }
    let endFrom = from.length;
    let endTo = to.length;
    while (endFrom > start && endTo > start && from[endFrom - 1] === to[endTo - 1]) {
      endFrom--;
      endTo--;
    }
    if (endFrom > start) {
      ops.push({ p: [...path, start], sd: from.slice(start, endFrom) });
    }
    if (endTo > start) {
      ops.push({ p: [...path, start], si: to.slice(start, endTo) });
    }
    return;
  }
  ops.push({ p: path, od: from, oi: to });
}

/** A stacking key for the placement at `index`, bottom first. */
export function zKey(index: number): string {
  return `a${index.toString(36).padStart(4, "0")}`;
}

/** The placement ids, bottom of the stack first. */
export function stackOrder(doc: SceneDocument): string[] {
  return Object.keys(doc.widgets).sort((a, b) => {
    const za = doc.widgets[a]!.z;
    const zb = doc.widgets[b]!.z;
    return za < zb ? -1 : za > zb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
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
      visible: placement.visible,
    });
  }
  return { id: snapshot.sceneId, name: snapshot.name, layout: snapshot.doc.layout, widgets };
}

/** `meta` with an event's changes merged in. */
export function mergeMeta(
  meta: Record<string, PlacementMeta>,
  changes: Record<string, PlacementMeta | null>
): Record<string, PlacementMeta> {
  const next = { ...meta };
  for (const [id, value] of Object.entries(changes)) {
    if (value === null) {
      delete next[id];
    } else {
      next[id] = value;
    }
  }
  return next;
}

/** The snapshot in a `scene-ops`-era config response, or null when there is none. */
export function parseSnapshot(value: unknown): SceneSnapshot | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const s = value as Record<string, unknown>;
  if (
    typeof s.sceneId !== "string" ||
    typeof s.seq !== "number" ||
    !isPlainObject(s.doc) ||
    !isPlainObject((s.doc as Record<string, unknown>).widgets) ||
    !isPlainObject(s.meta)
  ) {
    return null;
  }
  return value as unknown as SceneSnapshot;
}

/** The `scene-ops` event's payload, or null for anything else. */
export function parseSceneOpsEvent(value: unknown): SceneOpsEvent | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const e = value as Record<string, unknown>;
  if (typeof e.seq !== "number" || !Array.isArray(e.ops) || !isPlainObject(e.meta)) {
    return null;
  }
  return value as unknown as SceneOpsEvent;
}
