/// <reference path="./ot-json0.d.ts" />
// The scene as a document, and the json0 ops that change it.
//
// sceneManager holds each scene as two documents, the published scene that
// overlays show and the editor's draft. Every change to either is a list of
// json0 components (the `ot-json0` type ShareDB uses): a path into the
// document and what changes there, so ops work for any widget's settings,
// and text changes travel as splices that merge with concurrent ones.
//
// This module is the wire format shared by sceneManager (server and overlay
// page) and the dashboard's scene editor.

import json0Module from "ot-json0";

const json0 = json0Module.type;

/** The scene's two documents: what overlays show, and what the editor stages. */
export type Version = "draft" | "published";

export const VERSIONS: readonly Version[] = ["draft", "published"];

export function isVersion(value: unknown): value is Version {
  return value === "draft" || value === "published";
}

/**
 * One placement. Widgets are keyed by placement id, so moving or editing one
 * never shifts another's path.
 */
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

/**
 * What a placement needs on the page that the document does not hold: the
 * server works it out from what is installed.
 */
export interface PlacementMeta {
  moduleId: string;
  hostsSurface: string;
  frameUrl: string;
  linkedResources: Record<string, string>;
}

/** Placements whose meta changed: the new meta, or null for one removed. */
export type MetaChanges = Record<string, PlacementMeta | null>;

/** One json0 op component. */
export interface Json0Component {
  p: (string | number)[];
  oi?: unknown;
  od?: unknown;
  si?: string;
  sd?: string;
}

/** A change to one document: components applied in order. */
export type Ops = Json0Component[];

/**
 * Identifies one entry of a scene's editor log: `${epoch}.${v}`. `epoch` is
 * drawn at random each time a process loads the scene, so an entry lost in a
 * crash and the entry later committed at the same `v` have different ids.
 */
export type EntryId = string;

export type EntryKind = "edit" | "publish" | "discard" | "external";

/** The editor and item an entry came from; null for a change the engine made. */
export interface EntrySource {
  clientId: string;
  seq: number;
}

/**
 * One committed change to a scene, numbered scene-wide. A change that touches
 * both documents (a live edit and its copy into the draft, a publish, a
 * discard) is one entry, so it is applied, sent and acknowledged atomically.
 */
export interface Entry {
  v: number;
  id: EntryId;
  src: EntrySource | null;
  kind: EntryKind;
  changes: Partial<Record<Version, Ops>>;
  meta: Partial<Record<Version, MetaChanges>>;
  /** Whether the draft differs from the published scene after this entry. */
  hasDraft: boolean;
}

/** A version of the scene as an overlay starts from it, or resyncs to. */
export interface SceneSnapshot {
  sceneId: string;
  name: string;
  seq: number;
  doc: SceneDocument;
  meta: Record<string, PlacementMeta>;
}

/**
 * The SSE `scene-ops` event: the ops for one overlay sequence number, and
 * the placements whose meta changed (null for one removed).
 */
export interface SceneOpsEvent {
  seq: number;
  ops: Ops;
  meta: MetaChanges;
  /** Which of the scene's versions changed; absent means published. */
  version?: Version;
}

/** Largest ops one item may carry, measured by `opsSize`. */
export const MAX_OPS_BYTES = 64 * 1024;
/** Largest a document may grow, measured as its JSON length. */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

/**
 * The size the limits are measured in: the JSON length in UTF-16 units. The
 * server and the client must measure alike, or the client would split its
 * queue at a size the server refuses.
 */
export function opsSize(ops: readonly Json0Component[]): number {
  return JSON.stringify(ops).length;
}

export function entryIdOf(epoch: string, v: number): EntryId {
  return `${epoch}.${v}`;
}

/** `doc` with `ops` applied; `doc` itself is left as it was. Throws when the ops do not apply. */
export function applyOps(doc: SceneDocument, ops: readonly Json0Component[]): SceneDocument {
  return json0.apply(structuredClone(doc), structuredClone([...ops])) as SceneDocument;
}

/**
 * `ops` rewritten to apply after `against`, both made on the same document.
 *
 * `side` breaks ties between the two, and json0 breaks them differently by
 * component:
 * - Both setting the same key (`oi`/`od`): the `"left"` side wins. Its
 *   rewritten op replaces whatever `against` set, and the `"right"` side's
 *   becomes a no-op.
 * - Both inserting text at the same index: the `"left"` side's text lands
 *   first (before the other's), nothing is lost.
 *
 * The server transforms an incoming op as `"left"` against what was committed
 * before it, so on a replace the later op in commit order wins. A client
 * transforms its pending ops as `"left"` and the server's op as `"right"`,
 * which agrees with the server's choice: its pending op is committed after.
 */
export function transformOps(
  ops: readonly Json0Component[],
  against: readonly Json0Component[],
  side: "left" | "right"
): Ops {
  return json0.transform(structuredClone([...ops]), structuredClone([...against]), side) as Ops;
}

/** One op with the effect of `first` then `second`. */
export function composeOps(first: readonly Json0Component[], second: readonly Json0Component[]): Ops {
  return json0.compose(structuredClone([...first]), structuredClone([...second])) as Ops;
}

/**
 * The op that undoes `ops`, applied to the document `ops` produced. Every
 * component must carry what it removed (`od`, `sd`), which `diffDocuments`
 * always does.
 */
export function invertOps(ops: readonly Json0Component[]): Ops {
  return json0.invert(structuredClone([...ops])) as Ops;
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

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The ops that turn `from` into `to`, as small as their shape allows: an
 * object is compared key by key, text changes as one splice, and anything
 * else is replaced whole. Every component carries what it removes, so the
 * result can be inverted.
 */
export function diffDocuments(from: SceneDocument, to: SceneDocument): Ops {
  const ops: Ops = [];
  diffValue([], from, to, ops);
  return ops;
}

function diffValue(path: (string | number)[], from: unknown, to: unknown, ops: Ops): void {
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
    if (za !== zb) {
      return za < zb ? -1 : 1;
    }
    if (a !== b) {
      return a < b ? -1 : 1;
    }
    return 0;
  });
}

/** `meta` with a change's meta merged in. */
export function mergeMeta(meta: Record<string, PlacementMeta>, changes: MetaChanges): Record<string, PlacementMeta> {
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

/** The snapshot in a scene config response, or null when there is none. */
export function parseSnapshot(value: unknown): SceneSnapshot | null {
  if (!isPlainObject(value)) {
    return null;
  }
  if (
    typeof value.sceneId !== "string" ||
    typeof value.seq !== "number" ||
    !isSceneDocument(value.doc) ||
    !isPlainObject(value.meta)
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
  if (typeof value.seq !== "number" || !Array.isArray(value.ops) || !isPlainObject(value.meta)) {
    return null;
  }
  if (value.version !== undefined && !isVersion(value.version)) {
    return null;
  }
  return value as unknown as SceneOpsEvent;
}

/** A document's outer shape: a layout object and placements keyed by id. Placements are not checked. */
export function isSceneDocument(value: unknown): value is SceneDocument {
  return isPlainObject(value) && isPlainObject(value.layout) && isPlainObject(value.widgets);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const PLACEMENT_FIELDS: Record<keyof PlacementDocument, (value: unknown) => boolean> = {
  widget: (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
  x: isFiniteNumber,
  y: isFiniteNumber,
  width: (v) => isFiniteNumber(v) && v >= 0,
  height: (v) => isFiniteNumber(v) && v >= 0,
  visible: (v) => typeof v === "boolean",
  z: (v) => typeof v === "string" && v.length > 0 && v.length <= 64,
  settings: isPlainObject,
  name: (v) => typeof v === "string" && v.length <= 256,
  rotation: isFiniteNumber,
  opacity: (v) => isFiniteNumber(v) && v >= 0 && v <= 1,
  locked: (v) => typeof v === "boolean",
  extra: isPlainObject,
};

export function isPlacement(value: unknown): value is PlacementDocument {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === Object.keys(PLACEMENT_FIELDS).length &&
    Object.entries(PLACEMENT_FIELDS).every(([field, valid]) => valid(value[field]))
  );
}

/**
 * Why ops may not be applied to a scene document, or null when they may:
 * every path stays inside the layout or a placement, a placement inserted
 * whole is complete, and a placement's own fields keep their types. Settings
 * and layout values are the widget's and the editor's business. Whether the
 * ops apply to a given document is checked by applying them.
 */
export function invalidOps(ops: unknown): string | null {
  if (!Array.isArray(ops) || ops.length === 0) {
    return "ops must be a non-empty list";
  }
  if (opsSize(ops) > MAX_OPS_BYTES) {
    return "ops too large";
  }
  for (const component of ops) {
    if (!isPlainObject(component) || !Array.isArray(component.p) || component.p.length === 0) {
      return "every op needs a path";
    }
    const p = component.p as unknown[];
    if (!p.every((segment) => typeof segment === "string" || (typeof segment === "number" && segment >= 0))) {
      return "a path is made of keys and indexes";
    }
    if (p[0] === "layout") {
      continue;
    }
    if (p[0] !== "widgets" || p.length < 2 || typeof p[1] !== "string" || p[1].length === 0 || p[1].length > 128) {
      return "a path must start at the layout or a placement";
    }
    if (p.length === 2) {
      if ("oi" in component && !isPlacement(component.oi)) {
        return "a placement must be inserted whole";
      }
      continue;
    }
    const field = p[2];
    if (typeof field !== "string" || !Object.hasOwn(PLACEMENT_FIELDS, field)) {
      return `a placement has no field ${String(field)}`;
    }
    if (p.length === 3 && "oi" in component && !PLACEMENT_FIELDS[field as keyof PlacementDocument](component.oi)) {
      return `invalid ${field}`;
    }
  }
  return null;
}
