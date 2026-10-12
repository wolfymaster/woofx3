// The editor's view of a change: json0 ops between two compositions.
//
// History records what the user changed as ops, so an undo can be moved past
// what other editors changed since (json0 transform). These ops never leave
// the editor: an undo is applied through the document source like any other
// edit, and the source turns the resulting document into whatever its store
// takes (the sync client diffs it again in its own shapes). That frees the
// diff here to be simple: objects are compared key by key at any depth, and
// every other value, text included, is replaced whole. Replacing text whole
// loses nothing for undo, which restores a value, and json0 still carries a
// concurrent splice inside it into the value an undo removes.
//
// The json0 functions come from the sync layer (api/scene-editor), which owns
// the `ot-json0` dependency; they only clone and call json0, so they work on
// any JSON document although they are typed for the scene document.

import {
  applyOps as applyJson0,
  composeOps,
  invertOps,
  type Json0Component,
  type Ops,
  type SceneDocument,
  transformOps,
} from "../../api/scene-editor/document";
import { assert, isPlainObject, sameValue } from "../model/composition";
import type { CompositionDocument } from "../model/types";

export type { Json0Component, Ops };

/** The ops that turn `from` into `to`. Every component carries what it removes, so the result inverts. */
export function diffCompositions(from: CompositionDocument, to: CompositionDocument): Ops {
  const ops: Ops = [];
  diffValue([], from, to, ops);
  return ops;
}

function diffValue(path: (string | number)[], from: unknown, to: unknown, ops: Ops): void {
  if (sameValue(from, to)) {
    return;
  }
  if (!isPlainObject(from) || !isPlainObject(to)) {
    assert(path.length > 0, "a composition is an object");
    ops.push({ p: path, od: from, oi: to });
    return;
  }
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

/** `doc` with `ops` applied; `doc` itself is left as it was. Throws when the ops do not apply. */
export function applyCompositionOps(doc: CompositionDocument, ops: readonly Json0Component[]): CompositionDocument {
  return applyJson0(doc as unknown as SceneDocument, ops) as unknown as CompositionDocument;
}

export { composeOps, invertOps, transformOps };

/**
 * `ops` without the components that change nothing: a replace whose new
 * value equals the old. Transforming an undo past the rollback of the same
 * change leaves exactly such components.
 */
export function withoutNoops(ops: readonly Json0Component[]): Ops {
  return ops.filter((component) => {
    const replaces = "oi" in component && "od" in component;
    return !(replaces && sameValue(component.oi, component.od));
  });
}
