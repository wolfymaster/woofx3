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
// page) and the dashboard's scene editor. Which entries are valid, and the
// grain each of their fields is edited at, come from the scene model's type
// registry: the engine passes nothing and validates with the strict one,
// and an editor passes the tolerant one (see registry.ts).
//
// Every document past a parse point (`parseSnapshot`, the protocol's welcome
// snapshot, the sequencer's initial state) has a `behaviors` collection: one
// stored or sent without it gets an empty one (`normalizeComposition`).

import json0Module from "ot-json0";
import { isCompositionShape, isPlainObject, normalizeComposition, sameValue } from "../../scene/model/composition";
import { type DeclaredBehaviorKinds, ENTRY_ID_MAX_LENGTH } from "../../scene/model/entity-types";
import { stackOrder } from "../../scene/model/keys";
import { type CollectionName, STRICT_REGISTRY, type TypeRegistry } from "../../scene/model/registry";
import type { BehaviorDocument, CompositionDocument, PlacementDocument } from "../../scene/model/types";

const json0 = json0Module.type;

/** The scene's two documents: what overlays show, and what the editor stages. */
export type Version = "draft" | "published";

export const VERSIONS: readonly Version[] = ["draft", "published"];

export function isVersion(value: unknown): value is Version {
  return value === "draft" || value === "published";
}

/**
 * The document a scene's two versions are: a composition. The shape and
 * what a valid entry of each collection is live in the scene package's
 * model, so the editor, the overlay and the engine read one definition.
 */
export type SceneDocument = CompositionDocument;

export type { BehaviorDocument, CompositionDocument, PlacementDocument };

/**
 * What a placement needs on the page that the document does not hold: the
 * server works it out from what is installed.
 */
export interface PlacementMeta {
  moduleId: string;
  hostsSurface: string;
  frameUrl: string;
  linkedResources: Record<string, string>;
  /**
   * The engine's media proxy URL prefix, for a widget whose frame runs under
   * the theme policy: overlays get external media in its settings pointed
   * there. Absent for every other placement, whose frames load external
   * media directly.
   */
  mediaProxyBase?: string;
  /**
   * The transition and effect kinds the placement's widget declares it plays
   * itself, from the widget catalog. The overlay hands the widget only
   * these; any other widget kind on it is skipped. Absent when the server
   * does not report them, which a page reads as declaring none.
   */
  behaviorKinds?: DeclaredBehaviorKinds;
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

/**
 * Largest edit a client queues as one item, measured by `opsSize`. The client
 * cuts a larger edit into items of at most this size, and refuses an edit
 * holding a single component larger than this when it is made.
 */
export const MAX_OPS_BYTES = 64 * 1024;
/** Largest a document may grow, measured as its JSON length. */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
/**
 * Largest item the server takes, measured by `opsSize`. Larger than
 * `MAX_OPS_BYTES` because an item that was within it when made can grow
 * before it is sent: transforming it updates the values it removes (`od`) to
 * what others changed them to, and moving it onto a snapshot sets whole
 * fields. Either way it is still a change between two documents within
 * `MAX_DOCUMENT_BYTES`, so what it removes and what it inserts are each at
 * most that size; the third share covers paths and JSON punctuation.
 */
export const MAX_ITEM_BYTES = 3 * MAX_DOCUMENT_BYTES;

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

export { isPlainObject, sameValue };

/**
 * The ops that turn `from` into `to`, as small as their shape allows, and
 * only in the shapes `invalidOps` accepts: a layout key is set or removed
 * whole; an entry of a collection (a placement, a behavior) is inserted,
 * removed or replaced whole; an entry's field changes at its grain in the
 * registry (replaced whole; text as one splice; settings and extra key by
 * key with text spliced; params key by key; timing field by field). Every
 * component carries what it removes, so the result can be inverted.
 *
 * An entry in `to` with a field removed or added, or a different `type`, is
 * replaced whole, and a field of the wrong type is replaced as it is;
 * `invalidOps` refuses both, so such a change is turned down where it was
 * made. So is a change to `inputs` or `base`, which are not edited through
 * the scene editor.
 */
export function diffDocuments(from: SceneDocument, to: SceneDocument, registry: TypeRegistry = STRICT_REGISTRY): Ops {
  const ops: Ops = [];
  if (!isPlainObject(from.layout) || !isPlainObject(to.layout)) {
    pushReplace(["layout"], from.layout, to.layout, ops);
  } else {
    diffKeys(["layout"], from.layout, to.layout, ops, pushReplace);
  }
  for (const collection of registry.collectionNames()) {
    const fromEntries: unknown = from[collection];
    const toEntries: unknown = to[collection];
    if (!isPlainObject(fromEntries) || !isPlainObject(toEntries)) {
      pushReplace([collection], fromEntries, toEntries, ops);
    } else {
      diffKeys([collection], fromEntries, toEntries, ops, (path, a, b, out) =>
        diffEntry(registry, collection, path, a, b, out)
      );
    }
  }
  for (const key of UNEDITED_ROOTS) {
    if (!sameValue(from[key], to[key])) {
      ops.push({
        p: [key],
        ...(from[key] === undefined ? {} : { od: from[key] }),
        ...(to[key] === undefined ? {} : { oi: to[key] }),
      });
    }
  }
  return ops;
}

/** Document keys outside the layout and the collections, which no editor op may change. */
const UNEDITED_ROOTS = ["inputs", "base"] as const;

export type UneditedRoot = (typeof UNEDITED_ROOTS)[number];

export function isUneditedRoot(value: unknown): value is UneditedRoot {
  return (UNEDITED_ROOTS as readonly unknown[]).includes(value);
}

type DiffValue = (path: (string | number)[], from: unknown, to: unknown, ops: Ops) => void;

/** Keys only `from` has are removed, keys only `to` has are inserted, and shared keys are compared by `diffValue`. */
function diffKeys(
  path: (string | number)[],
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  ops: Ops,
  diffValue: DiffValue
): void {
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
}

function pushReplace(path: (string | number)[], from: unknown, to: unknown, ops: Ops): void {
  if (!sameValue(from, to)) {
    ops.push({ p: path, od: from, oi: to });
  }
}

function diffEntry(
  registry: TypeRegistry,
  collection: CollectionName,
  path: (string | number)[],
  from: unknown,
  to: unknown,
  ops: Ops
): void {
  if (sameValue(from, to)) {
    return;
  }
  if (!registry.hasExactFields(collection, from) || !registry.hasExactFields(collection, to)) {
    pushReplace(path, from, to, ops);
    return;
  }
  const fields = Object.entries(registry.collection(collection).fields);
  if (fields.some(([field, spec]) => spec.grain === "fixed" && !sameValue(from[field], to[field]))) {
    pushReplace(path, from, to, ops);
    return;
  }
  for (const [field, spec] of fields) {
    const fieldPath = [...path, field];
    const fromValue = from[field];
    const toValue = to[field];
    switch (spec.grain) {
      case "fixed":
      case "value": {
        pushReplace(fieldPath, fromValue, toValue, ops);
        break;
      }
      case "text": {
        if (typeof fromValue === "string" && typeof toValue === "string") {
          diffText(fieldPath, fromValue, toValue, ops);
        } else {
          pushReplace(fieldPath, fromValue, toValue, ops);
        }
        break;
      }
      case "freeform": {
        diffFreeform(fieldPath, fromValue, toValue, ops);
        break;
      }
      case "keyed": {
        diffKeyed(fieldPath, fromValue, toValue, ops);
        break;
      }
      case "struct": {
        const subfields = spec.subfields ?? {};
        const ownShape = (value: unknown): value is Record<string, unknown> =>
          isPlainObject(value) && Object.keys(value).every((key) => Object.hasOwn(subfields, key));
        if (ownShape(fromValue) && ownShape(toValue)) {
          diffKeys(fieldPath, fromValue, toValue, ops, pushReplace);
        } else {
          pushReplace(fieldPath, fromValue, toValue, ops);
        }
        break;
      }
    }
  }
}

function diffFreeform(path: (string | number)[], from: unknown, to: unknown, ops: Ops): void {
  if (sameValue(from, to)) {
    return;
  }
  if (isPlainObject(from) && isPlainObject(to)) {
    diffKeys(path, from, to, ops, diffFreeform);
    return;
  }
  if (typeof from === "string" && typeof to === "string") {
    diffText(path, from, to, ops);
    return;
  }
  pushReplace(path, from, to, ops);
}

function diffKeyed(path: (string | number)[], from: unknown, to: unknown, ops: Ops): void {
  if (sameValue(from, to)) {
    return;
  }
  if (isPlainObject(from) && isPlainObject(to)) {
    diffKeys(path, from, to, ops, diffKeyed);
    return;
  }
  pushReplace(path, from, to, ops);
}

/** One splice: what lies between the common prefix and the common suffix is deleted, then inserted. */
function diffText(path: (string | number)[], from: string, to: string, ops: Ops): void {
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
}

/** A stacking key for the placement at `index`, bottom first. */
export function zKey(index: number): string {
  return `a${index.toString(36).padStart(4, "0")}`;
}

export { stackOrder };

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

/** The snapshot in a scene config response, or null when there is none. Its document is normalized (`normalizeComposition`). */
export function parseSnapshot(value: unknown): SceneSnapshot | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const doc = normalizeComposition(value.doc);
  if (
    typeof value.sceneId !== "string" ||
    typeof value.seq !== "number" ||
    doc === null ||
    !isPlainObject(value.meta)
  ) {
    return null;
  }
  return { ...(value as unknown as SceneSnapshot), doc };
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

/** A document's outer shape; see `isCompositionShape`. */
export const isSceneDocument: (value: unknown) => value is SceneDocument = isCompositionShape;

export { normalizeComposition };

const COMPONENT_KEYS: ReadonlySet<string> = new Set(["p", "oi", "od", "si", "sd"]);

export function isPlacement(value: unknown, registry: TypeRegistry = STRICT_REGISTRY): value is PlacementDocument {
  return registry.isEntry("widgets", value);
}

export function isBehavior(value: unknown, registry: TypeRegistry = STRICT_REGISTRY): value is BehaviorDocument {
  return registry.isEntry("behaviors", value);
}

/**
 * Why ops may not be applied to a scene document, or null when they may.
 * Each component must be one of these shapes, which are all `diffDocuments`
 * makes and all that transforming them can turn them into (`<collection>`
 * is `widgets` or `behaviors`, and a field's grain is the registry's):
 *
 * - `layout.<key>`: insert, remove or replace (`oi`, `od`, or both) with
 *   a value the registry's `invalidLayoutKey` takes: the canvas size stays
 *   positive and is never removed.
 * - `<collection>.<id>`: insert, remove or replace a whole, valid entry.
 * - `<collection>.<id>.<field>`: replace (`od` and `oi`) with a valid value.
 *   A field is never inserted or removed alone: an entry has all of them. A
 *   `fixed` field (a behavior's `type`) only changes with its entry.
 * - `.<field>.<index>` of a `text` field (a placement's name): insert or
 *   delete text (`si` or `sd`).
 * - `.<field>.<key>...` of a `freeform` field (settings, extra): insert,
 *   remove or replace a value under string keys, or insert or delete text
 *   in one (`...<index>`).
 * - `.<field>.<key>...` of a `keyed` field (a behavior's params): insert,
 *   remove or replace a value under string keys.
 * - `.<field>.<subfield>` of a `struct` field (a behavior's timing):
 *   replace a subfield, or insert or remove an optional one.
 *
 * Anything else (number adds, list and subtype ops, replacing the layout or
 * a whole collection at once, changing `inputs` or `base`, paths into
 * lists) is refused. Size is checked by the caller, against its own limit.
 * What these shapes cannot rule out (text spliced past a field's length
 * limit, a field valid alone but not with the rest of its entry) is checked
 * on the result by `invalidResult`, and whether the ops apply at all by
 * applying them.
 */
export function invalidOps(ops: unknown, registry: TypeRegistry = STRICT_REGISTRY): string | null {
  if (!Array.isArray(ops) || ops.length === 0) {
    return "ops must be a non-empty list";
  }
  for (const component of ops) {
    const invalid = invalidComponent(component, registry);
    if (invalid !== null) {
      return invalid;
    }
  }
  return null;
}

function invalidComponent(component: unknown, registry: TypeRegistry): string | null {
  if (!isPlainObject(component) || !Array.isArray(component.p) || component.p.length === 0) {
    return "every op needs a path";
  }
  if (!Object.keys(component).every((key) => COMPONENT_KEYS.has(key))) {
    return "an op may only insert, remove or replace a value, or splice text";
  }
  const p = component.p as unknown[];
  if (
    !p.every((segment) => typeof segment === "string" || (Number.isSafeInteger(segment) && (segment as number) >= 0))
  ) {
    return "a path is made of keys and indexes";
  }
  const isSplice = "si" in component || "sd" in component;
  if (isSplice) {
    const text = "si" in component ? component.si : component.sd;
    if (("si" in component && "sd" in component) || "oi" in component || "od" in component) {
      return "a text splice either inserts or deletes, and nothing else";
    }
    if (typeof text !== "string" || text.length === 0) {
      return "a text splice carries non-empty text";
    }
  } else if (!("oi" in component) && !("od" in component)) {
    return "an op must change something";
  }
  const root = p[0];
  if (root === "layout") {
    if (p.length !== 2 || typeof p[1] !== "string" || isSplice) {
      return "the layout changes one key at a time, replaced whole";
    }
    return registry.invalidLayoutKey(p[1], "oi" in component ? component.oi : undefined);
  }
  if (
    !registry.isCollection(root) ||
    p.length < 2 ||
    typeof p[1] !== "string" ||
    p[1].length === 0 ||
    p[1].length > ENTRY_ID_MAX_LENGTH
  ) {
    return "a path must start at a layout key, a placement or a behavior";
  }
  const noun = registry.collection(root).noun;
  if (p.length === 2) {
    if (isSplice) {
      return `a ${noun} is not text`;
    }
    if ("oi" in component && registry.invalidEntry(root, component.oi) !== null) {
      return `a ${noun} must be inserted whole: ${registry.invalidEntry(root, component.oi)}`;
    }
    return null;
  }
  const field = p[2];
  const spec = typeof field === "string" ? registry.field(root, field) : undefined;
  if (typeof field !== "string" || spec === undefined) {
    return `a ${noun} has no field ${String(field)}`;
  }
  if (p.length === 3) {
    if (isSplice || !("oi" in component) || !("od" in component)) {
      return `${field} can only be replaced`;
    }
    return registry.invalidField(root, field, component.oi);
  }
  switch (spec.grain) {
    case "text": {
      if (p.length !== 4 || !isSplice || typeof p[3] !== "number") {
        return `${field} changes by text splices`;
      }
      return null;
    }
    case "freeform":
    case "keyed": {
      const keys = isSplice ? p.slice(3, -1) : p.slice(3);
      if (keys.length === 0 || !keys.every((key) => typeof key === "string")) {
        return `${field} changes key by key`;
      }
      if (isSplice && spec.grain === "keyed") {
        return `the values in ${field} are replaced whole`;
      }
      if (isSplice && typeof p[p.length - 1] !== "number") {
        return `a text splice in ${field} ends at an index`;
      }
      return null;
    }
    case "struct": {
      if (p.length !== 4 || typeof p[3] !== "string" || isSplice) {
        return `${field} changes one field at a time, replaced whole`;
      }
      return registry.invalidSubfield(root, field, p[3], {
        inserts: "oi" in component,
        removes: "od" in component,
        value: component.oi,
      });
    }
    case "fixed":
    case "value": {
      return `${field} can only be replaced`;
    }
  }
}

/**
 * Why ops may not be applied as an `external` change, or null when they
 * may. An external change (a save made elsewhere, a workflow step) may make
 * any change an edit may (`invalidOps`), and may also replace the
 * document's `inputs` whole: `{ p: ["inputs"] }` with `od`, `oi` or both.
 * Inputs are set where the composition is managed, never by an editor, and
 * reach the editors that have the composition open this way.
 */
export function invalidExternalOps(ops: unknown, registry: TypeRegistry = STRICT_REGISTRY): string | null {
  if (!Array.isArray(ops) || ops.length === 0) {
    return "ops must be a non-empty list";
  }
  const edits: unknown[] = [];
  for (const component of ops) {
    if (!isPlainObject(component) || !Array.isArray(component.p) || component.p.length !== 1) {
      edits.push(component);
      continue;
    }
    if (component.p[0] !== "inputs") {
      edits.push(component);
      continue;
    }
    if (!Object.keys(component).every((key) => key === "p" || key === "oi" || key === "od")) {
      return "inputs are replaced whole";
    }
    if (!("oi" in component) && !("od" in component)) {
      return "an op must change something";
    }
    if ("oi" in component) {
      const invalid = invalidInputs(component.oi);
      if (invalid !== null) {
        return invalid;
      }
    }
  }
  return edits.length === 0 ? null : invalidOps(edits, registry);
}

/**
 * Why `value` is not a composition's `inputs`, or null when it is: a list
 * of input fields, each with a non-empty `id` (unique among them) and
 * `type` and a text `label`. Must match `invalidInputs` in
 * db/app/services/scene_service.go, which refuses the same values on write.
 */
export function invalidInputs(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return "inputs must be a list";
  }
  const ids = new Set<string>();
  for (const [index, field] of value.entries()) {
    if (
      !isPlainObject(field) ||
      typeof field.id !== "string" ||
      field.id === "" ||
      typeof field.type !== "string" ||
      field.type === "" ||
      typeof field.label !== "string"
    ) {
      return `input ${index} needs a non-empty id and type and a text label`;
    }
    if (ids.has(field.id)) {
      return `input id ${field.id} is declared twice`;
    }
    ids.add(field.id);
  }
  return null;
}

/**
 * Why `doc`, the result of applying `ops`, is not a valid scene, or null
 * when it is. Only what `ops` touched is checked: every entry they reached
 * must still be a valid entry of its collection.
 */
export function invalidResult(
  doc: SceneDocument,
  ops: readonly Json0Component[],
  registry: TypeRegistry = STRICT_REGISTRY
): string | null {
  const checked = new Set<string>();
  for (const component of ops) {
    const [root, id] = component.p;
    if (!registry.isCollection(root) || typeof id !== "string") {
      continue;
    }
    const key = `${root}.${id}`;
    if (checked.has(key)) {
      continue;
    }
    checked.add(key);
    const entries = doc[root] as Record<string, unknown>;
    const result = entries[id];
    if (result === undefined) {
      continue;
    }
    const invalid = registry.invalidEntry(root, result);
    if (invalid !== null) {
      return `${registry.collection(root).noun} ${id} would not be valid: ${invalid}`;
    }
  }
  return null;
}
