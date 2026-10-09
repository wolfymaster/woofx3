// Copying what an edit touched from one document onto another, field by
// field, where its ops cannot be transformed.
//
// A client that reconnects after the server's log moved past it gets a
// snapshot instead of the entries it missed, so its pending ops have nothing
// to be transformed against. Each pending edit is replayed as "set every
// field it touched to the value it meant", which keeps the user's intent per
// field (last writer wins) at the cost of merging concurrent text edits. The
// sequencer copies a live edit into the draft the same way.

import {
  applyOps,
  type Json0Component,
  type Ops,
  type PlacementDocument,
  type SceneDocument,
  sameValue,
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
 * key set, inserted or removed whole; each placement inserted or removed
 * whole; each differing field of a placement both have replaced whole, text
 * included. A rebased edit must say "this field is now this value": as text
 * splices (what `diffDocuments` makes) it would be merged with concurrent
 * splices character by character when the server transforms it, making a
 * value neither side wrote, where a replacement is transformed as last
 * writer wins.
 */
export function replacementsBetween(from: SceneDocument, to: SceneDocument): Ops {
  const ops: Ops = [];
  replaceKeys(["layout"], from.layout, to.layout, ops, (path, a, b) => {
    ops.push({ p: path, od: a, oi: b });
  });
  replaceKeys(["widgets"], from.widgets, to.widgets, ops, (path, a, b) => {
    const fromPlacement = a as unknown as Record<string, unknown>;
    const toPlacement = b as unknown as Record<string, unknown>;
    for (const field of Object.keys(toPlacement)) {
      if (!sameValue(fromPlacement[field], toPlacement[field])) {
        ops.push({ p: [...path, field], od: fromPlacement[field], oi: toPlacement[field] });
      }
    }
  });
  return ops;
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
  for (const key of Object.keys(to)) {
    if (!Object.hasOwn(from, key)) {
      ops.push({ p: [...path, key], oi: to[key] });
    } else if (!sameValue(from[key], to[key])) {
      replace([...path, key], from[key]!, to[key]!);
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
 * - a placement (an op on `widgets.<id>` itself): removed when `after` has
 *   none; otherwise copied whole when `into` has it, or when `before` did
 *   not (the ops added it). A placement `before` had and `into` lacks was
 *   removed on `into`'s side, and stays removed;
 * - a placement's field (any op inside `widgets.<id>.<field>`, so settings
 *   are copied whole): set when both `into` and `after` have the placement,
 *   else skipped, so an edit never brings back a placement `into` removed.
 *
 * Field paths are applied before placement paths, so a placement the ops
 * replaced or removed wins over the ops' own edits to its fields.
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
      case "placement": {
        const intended = after.widgets[path.id];
        if (intended === undefined) {
          delete next.widgets[path.id];
        } else if (next.widgets[path.id] !== undefined || before.widgets[path.id] === undefined) {
          next.widgets[path.id] = structuredClone(intended);
        }
        break;
      }
      case "field": {
        const placement = next.widgets[path.id];
        const intended = after.widgets[path.id];
        if (placement === undefined || intended === undefined) {
          break;
        }
        const field = path.field as keyof PlacementDocument;
        (placement as unknown as Record<string, unknown>)[field] = structuredClone(intended[field]);
        break;
      }
    }
  }
  return next;
}

type TouchedPath =
  | { kind: "layout" }
  | { kind: "layoutKey"; key: string }
  | { kind: "placement"; id: string }
  | { kind: "field"; id: string; field: string };

/**
 * The fields `ops` touch, field paths before placement paths: a placement
 * the edit replaced or removed wins over its own field edits.
 */
function touchedPaths(ops: readonly Json0Component[]): TouchedPath[] {
  const fields = new Map<string, TouchedPath>();
  const placements = new Map<string, TouchedPath>();
  for (const component of ops) {
    const [root, second, third] = component.p;
    if (root === "layout") {
      if (typeof second === "string") {
        fields.set(`layout.${second}`, { kind: "layoutKey", key: second });
      } else {
        placements.set("layout", { kind: "layout" });
      }
      continue;
    }
    if (root !== "widgets" || typeof second !== "string") {
      continue;
    }
    if (typeof third === "string") {
      fields.set(`widgets.${second}.${third}`, { kind: "field", id: second, field: third });
    } else {
      placements.set(`widgets.${second}`, { kind: "placement", id: second });
    }
  }
  return [...fields.values(), ...placements.values()];
}
