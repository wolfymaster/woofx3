// Whole-document operations every consumer of a composition shares.

import type { CompositionDocument, NodeId } from "./types";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`invariant violated: ${message}`);
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/**
 * Whether `value` has a normalized composition's outer shape: a layout
 * object, and placements and behaviors keyed by id. Entries are not
 * checked. A document from before compositions had behaviors is not one
 * until `normalizeComposition` gives it the collection.
 */
export function isCompositionShape(value: unknown): value is CompositionDocument {
  return (
    isPlainObject(value) &&
    isPlainObject(value.layout) &&
    isPlainObject(value.widgets) &&
    isPlainObject(value.behaviors)
  );
}

/**
 * `value` as a composition, or null when its outer shape is not one: a
 * layout object and widgets keyed by id. A document with no `behaviors`
 * (stored, or sent by an engine, before compositions had them) gets an
 * empty collection, so every document past a parse point has all three and
 * an op on `behaviors.<id>` always has somewhere to apply. Entries are not
 * checked here; the registry checks each one where it is changed.
 */
export function normalizeComposition(value: unknown): CompositionDocument | null {
  if (!isPlainObject(value) || !isPlainObject(value.layout) || !isPlainObject(value.widgets)) {
    return null;
  }
  if (value.behaviors === undefined) {
    return { ...(value as unknown as CompositionDocument), behaviors: {} };
  }
  if (!isPlainObject(value.behaviors)) {
    return null;
  }
  return value as unknown as CompositionDocument;
}

/**
 * `doc` without the widget `id` and every behavior that targets it, so a
 * diff of the two removes them in one atomic change. A behavior that only
 * refers to the widget through `timing.node` stays: it is skipped where it
 * is played while its anchor is missing, and the editor shows it dangling.
 */
export function withoutWidget(doc: CompositionDocument, id: NodeId): CompositionDocument {
  const widgets = { ...doc.widgets };
  delete widgets[id];
  const behaviors: CompositionDocument["behaviors"] = {};
  for (const [behaviorId, behavior] of Object.entries(doc.behaviors)) {
    if (behavior.target !== id) {
      behaviors[behaviorId] = behavior;
    }
  }
  return { ...doc, widgets, behaviors };
}
