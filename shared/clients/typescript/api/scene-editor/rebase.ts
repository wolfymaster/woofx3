// Copying what an edit touched from one document onto another, field by
// field, where its ops cannot be transformed.
//
// A client that reconnects after the server's log moved past it gets a
// snapshot instead of the entries it missed, so its pending ops have nothing
// to be transformed against. Each pending edit is replayed as "set every
// field it touched to the value it meant", which keeps the user's intent per
// field (last writer wins) at the cost of merging concurrent text edits. The
// sequencer copies a live edit into the draft the same way.

import { type CollectionName, STRICT_REGISTRY, type TypeRegistry } from "../../scene/model/registry";
import {
  applyOps,
  isUneditedRoot,
  type Json0Component,
  type Ops,
  type SceneDocument,
  sameValue,
  type UneditedRoot,
  type Version,
} from "./document";
import type { ItemBody } from "./protocol";

/**
 * `bodies`, made in order on `base`, remade in order on `target`.
 *
 * Each edit is replayed as `copyTouched` from the old chain onto the new one:
 * every field it touched is set to the value it has after the edit on the
 * old chain, as whole-field replacements (`replacementsBetween`). Commands
 * pass through unchanged.
 *
 * An edit comes back with empty ops when nothing of it is left, and as null
 * when its ops did not apply to the old chain, which only a corrupted queue
 * can cause.
 */
export function rebaseFieldwise(
  base: Readonly<Record<Version, SceneDocument>>,
  bodies: readonly ItemBody[],
  target: Readonly<Record<Version, SceneDocument>>
): Array<ItemBody | null> {
  const before: Record<Version, SceneDocument> = { draft: base.draft, published: base.published };
  const current: Record<Version, SceneDocument> = { draft: target.draft, published: target.published };
  const rebased: Array<ItemBody | null> = [];
  for (const body of bodies) {
    if (body.kind !== "edit") {
      rebased.push(body);
      continue;
    }
    const version = body.version;
    let after: SceneDocument;
    try {
      after = applyOps(before[version], body.ops);
    } catch {
      rebased.push(null);
      continue;
    }
    const next = copyTouched(before[version], after, current[version], body.ops);
    rebased.push({ kind: "edit", version, ops: replacementsBetween(current[version], next) });
    before[version] = after;
    current[version] = next;
  }
  return rebased;
}

/**
 * The ops that turn `from` into `to` by replacing whole fields: each layout
 * key set, inserted or removed whole; each entry of a collection inserted
 * or removed whole; each differing field of an entry both have replaced
 * whole, text included. An entry whose fields are not exactly its
 * collection's, or whose `fixed` field (a behavior's type) differs, is
 * replaced whole, since `invalidOps` takes no op on such a field. A rebased
 * edit must say "this field is now this value": as text splices (what
 * `diffDocuments` makes) it would be merged with concurrent splices
 * character by character when the server transforms it, making a value
 * neither side wrote, where a replacement is transformed as last writer
 * wins.
 */
export function replacementsBetween(
  from: SceneDocument,
  to: SceneDocument,
  registry: TypeRegistry = STRICT_REGISTRY
): Ops {
  const ops: Ops = [];
  replaceKeys(["layout"], from.layout, to.layout, ops, (path, a, b) => {
    ops.push({ p: path, od: a, oi: b });
  });
  for (const collection of registry.collectionNames()) {
    const fromEntries = from[collection] as Record<string, unknown>;
    const toEntries = to[collection] as Record<string, unknown>;
    replaceKeys([collection], fromEntries, toEntries, ops, (path, a, b) => {
      if (!fieldwise(registry, collection, a, b)) {
        ops.push({ p: path, od: a, oi: b });
        return;
      }
      const fromEntry = a as Record<string, unknown>;
      const toEntry = b as Record<string, unknown>;
      for (const field of Object.keys(toEntry)) {
        if (!sameValue(fromEntry[field], toEntry[field])) {
          ops.push({ p: [...path, field], od: fromEntry[field], oi: toEntry[field] });
        }
      }
    });
  }
  return ops;
}

/** Whether two entries of `collection` can be told apart by replacing fields. */
function fieldwise(registry: TypeRegistry, collection: CollectionName, a: unknown, b: unknown): boolean {
  if (!registry.hasExactFields(collection, a) || !registry.hasExactFields(collection, b)) {
    return false;
  }
  return Object.entries(registry.collection(collection).fields).every(
    ([field, spec]) => spec.grain !== "fixed" || sameValue(a[field], b[field])
  );
}

function replaceKeys<T>(
  path: string[],
  from: Record<string, T>,
  to: Record<string, T>,
  ops: Ops,
  replace: (path: string[], from: T, to: T) => void
): void {
  for (const key of Object.keys(from)) {
    if (!Object.hasOwn(to, key)) {
      ops.push({ p: [...path, key], od: from[key] });
    }
  }
  for (const [key, toValue] of Object.entries(to)) {
    if (!Object.hasOwn(from, key)) {
      ops.push({ p: [...path, key], oi: toValue });
    } else if (!sameValue(from[key], toValue)) {
      replace([...path, key], from[key] as T, toValue);
    }
  }
}

/**
 * `into` with every field `ops` touched set to its value in `after`, where
 * `ops` turned `before` into `after`. The sequencer uses it to copy a live
 * edit into the draft, and `rebaseFieldwise` to move pending edits onto a
 * snapshot, so both work at the same grain. A field is one of:
 *
 * - a layout key: set, or removed when `after` has no such key;
 * - an entry of a collection (an op on `widgets.<id>` or `behaviors.<id>`
 *   itself): removed when `after` has none; otherwise copied whole when
 *   `into` has it, or when `before` did not (the ops added it). An entry
 *   `before` had and `into` lacks was removed on `into`'s side, and stays
 *   removed;
 * - an entry's field (any op inside `<collection>.<id>.<field>`, so a
 *   placement's settings or a behavior's timing are copied whole): set when
 *   both `into` and `after` have the entry, else skipped, so an edit never
 *   brings back an entry `into` removed.
 *
 * - a document key outside the layout and the collections (`inputs`,
 *   replaced whole by an external change): set, or removed when `after`
 *   has no such key.
 *
 * Field paths are applied before entry paths, so an entry the ops replaced
 * or removed wins over the ops' own edits to its fields. Ops on a root this
 * build does not know are skipped.
 */
export function copyTouched(
  before: SceneDocument,
  after: SceneDocument,
  into: SceneDocument,
  ops: readonly Json0Component[]
): SceneDocument {
  const next: SceneDocument = structuredClone(into);
  for (const path of touchedPaths(ops)) {
    switch (path.kind) {
      case "layout": {
        next.layout = structuredClone(after.layout);
        break;
      }
      case "layoutKey": {
        if (Object.hasOwn(after.layout, path.key)) {
          next.layout[path.key] = structuredClone(after.layout[path.key]);
        } else {
          delete next.layout[path.key];
        }
        break;
      }
      case "entry": {
        const entries = next[path.collection] as Record<string, unknown>;
        const intended = (after[path.collection] as Record<string, unknown>)[path.id];
        const had = (before[path.collection] as Record<string, unknown>)[path.id];
        if (intended === undefined) {
          delete entries[path.id];
        } else if (entries[path.id] !== undefined || had === undefined) {
          entries[path.id] = structuredClone(intended);
        }
        break;
      }
      case "root": {
        if (after[path.key] === undefined) {
          delete next[path.key];
        } else {
          (next as Record<UneditedRoot, unknown>)[path.key] = structuredClone(after[path.key]);
        }
        break;
      }
      case "field": {
        const entry = (next[path.collection] as Record<string, unknown>)[path.id];
        const intended = (after[path.collection] as Record<string, unknown>)[path.id];
        if (entry === undefined || intended === undefined) {
          break;
        }
        (entry as Record<string, unknown>)[path.field] = structuredClone(
          (intended as Record<string, unknown>)[path.field]
        );
        break;
      }
    }
  }
  return next;
}

type TouchedPath =
  | { kind: "layout" }
  | { kind: "root"; key: UneditedRoot }
  | { kind: "layoutKey"; key: string }
  | { kind: "entry"; collection: CollectionName; id: string }
  | { kind: "field"; collection: CollectionName; id: string; field: string };

/** The fields `ops` touch, in the order `copyTouched` applies them. */
function touchedPaths(ops: readonly Json0Component[]): TouchedPath[] {
  const fields = new Map<string, TouchedPath>();
  const entries = new Map<string, TouchedPath>();
  for (const component of ops) {
    const [root, second, third] = component.p;
    if (isUneditedRoot(root) && component.p.length === 1) {
      entries.set(root, { kind: "root", key: root });
      continue;
    }
    if (root === "layout") {
      if (typeof second === "string") {
        fields.set(`layout.${second}`, { kind: "layoutKey", key: second });
      } else {
        entries.set("layout", { kind: "layout" });
      }
      continue;
    }
    if (!STRICT_REGISTRY.isCollection(root) || typeof second !== "string") {
      continue;
    }
    if (typeof third === "string") {
      fields.set(`${root}.${second}.${third}`, { kind: "field", collection: root, id: second, field: third });
    } else {
      entries.set(`${root}.${second}`, { kind: "entry", collection: root, id: second });
    }
  }
  return [...fields.values(), ...entries.values()];
}
