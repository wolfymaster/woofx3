// Moving pending edits onto a snapshot when they cannot be transformed.
//
// A client that reconnects after the server's log moved past it gets a
// snapshot instead of the entries it missed, so its pending ops have nothing
// to be transformed against. Each pending edit is replayed as "set every
// field it touched to the value it meant", which keeps the user's intent per
// field (last writer wins) at the cost of merging concurrent text edits.

import {
  applyOps,
  diffDocuments,
  type Ops,
  type PlacementDocument,
  type SceneDocument,
  type Version,
} from "./document";
import type { ItemBody } from "./protocol";

/**
 * `bodies`, made in order on `base`, remade in order on `target`.
 *
 * For each edit, the fields it touches are its paths cut to: a layout key
 * (or the whole layout), a placement (`widgets.<id>`), or a placement field
 * (`widgets.<id>.<field>`). Each is set to the value it has after the edit on
 * the old chain. A field edit to a placement `target` does not have is
 * dropped, as is a whole-placement edit to a placement that existed before
 * the edit but is gone from `target`; adding a placement is kept. Commands
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
    const next = withIntendedValues(before[version], after, current[version], touchedPaths(body.ops));
    rebased.push({ kind: "edit", version, ops: diffDocuments(current[version], next) });
    before[version] = after;
    current[version] = next;
  }
  return rebased;
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
function touchedPaths(ops: Ops): TouchedPath[] {
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

function withIntendedValues(
  before: SceneDocument,
  after: SceneDocument,
  current: SceneDocument,
  paths: TouchedPath[]
): SceneDocument {
  const next: SceneDocument = structuredClone(current);
  for (const path of paths) {
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
