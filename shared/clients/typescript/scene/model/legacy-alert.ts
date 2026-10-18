// Alert layouts stored before alerts were compositions.
//
// An alert step's `layout` was a canvas and a list of widgets, bottom of the
// stack first:
//
//   { width, height, widgets: [{ id, widgetCanonicalId, position, size, settings }] }
//
// `position` holds `x` and `y`, and the size is either in `position` too or
// in `size`. The dashboard's alert editor also writes `name`, `visible`,
// `rotation`, `opacity`, `locked` and `zIndex` into each entry, and stores
// the list sorted by `zIndex`, so the two stacking orders agree. Steps saved that way still exist, and a module may still ship
// one, so the engine reads both shapes and plays only compositions: this is
// the one conversion between them. It is not a registry migration because
// what it converts is not a composition yet; the registry migrates entries of
// a composition, and the converted document goes through it like any other.
//
// The conversion keeps what the old shape said and nothing more: the stacking
// order becomes `z` keys, each entry becomes a placement through
// `placementOfStored` (the same mapping a scene row's entries use), and there
// are no behaviors. It
// does not judge the widgets themselves (whether the canonical id names an
// installed widget that may play in an alert); the caller that knows the
// catalog does that on the composition, the same way for both shapes.

import { isPlainObject, normalizeComposition } from "./composition";
import { evenKeys } from "./keys";
import { placementOfStored } from "./stored-placement";
import type { CompositionDocument, NodeId, PlacementDocument } from "./types";

/** The old shape's outer fields; each widget entry is read defensively. */
export interface LegacyAlertLayout {
  width: unknown;
  height: unknown;
  widgets: unknown[];
  [key: string]: unknown;
}

/** An entry of the old list that has no place in the composition. */
export interface LegacyAlertSkip {
  /** Its position in the list. */
  index: number;
  widgetCanonicalId: string;
  reason: string;
}

export interface LegacyAlertConversion {
  doc: CompositionDocument;
  /** The list index each converted widget came from, so a caller can report against the list. */
  indexOf: Record<NodeId, number>;
  skipped: LegacyAlertSkip[];
}

/**
 * Whether `value` is an alert layout in the old shape: a list of widgets
 * rather than widgets keyed by id. Its fields are not checked here.
 */
export function isLegacyAlertLayout(value: unknown): value is LegacyAlertLayout {
  return isPlainObject(value) && Array.isArray(value.widgets);
}

/**
 * The composition an old-shape alert layout describes. Every key of the old
 * layout other than `widgets` becomes a key of the canvas, so `width`,
 * `height` and a background colour carry over as they were; they are not
 * checked here. An entry that is not an object, has no id, or repeats an
 * earlier entry's id cannot be keyed by its id and is skipped and reported.
 */
export function compositionOfLegacyAlert(legacy: LegacyAlertLayout): LegacyAlertConversion {
  const { widgets: entries, ...canvas } = legacy;
  const kept: Array<{ id: NodeId; index: number; entry: Record<string, unknown> }> = [];
  const skipped: LegacyAlertSkip[] = [];
  const seen = new Set<NodeId>();
  entries.forEach((raw, index) => {
    const entry = isPlainObject(raw) ? raw : {};
    const widgetCanonicalId = typeof entry.widgetCanonicalId === "string" ? entry.widgetCanonicalId : "";
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!isPlainObject(raw)) {
      skipped.push({ index, widgetCanonicalId, reason: "a layout widget must be an object" });
      return;
    }
    if (id.length === 0) {
      skipped.push({ index, widgetCanonicalId, reason: "a layout widget needs an `id`" });
      return;
    }
    if (seen.has(id)) {
      skipped.push({ index, widgetCanonicalId, reason: `duplicate id ${JSON.stringify(id)}` });
      return;
    }
    seen.add(id);
    kept.push({ id, index, entry });
  });

  const zKeys = evenKeys(kept.length);
  const widgets: Record<NodeId, PlacementDocument> = {};
  const indexOf: Record<NodeId, number> = {};
  stackingOrder(kept).forEach(({ id, index, entry }, rank) => {
    widgets[id] = placementOfStored(entry, zKeys[rank] as string);
    indexOf[id] = index;
  });
  return { doc: { layout: canvas, widgets, behaviors: {} }, indexOf, skipped };
}

/**
 * Entries bottom of the stack first. When every entry has a numeric
 * `zIndex` they are ordered by it, ties keeping list order; otherwise list
 * order alone, since a partial set of `zIndex` values does not say where the
 * entries without one belong.
 */
function stackingOrder<T extends { entry: Record<string, unknown> }>(kept: T[]): T[] {
  const zIndexed = kept.every(({ entry }) => isFiniteNumber(entry.zIndex));
  if (!zIndexed) {
    return kept;
  }
  return [...kept].sort((a, b) => (a.entry.zIndex as number) - (b.entry.zIndex as number));
}

/**
 * An alert layout in either shape as a composition, or null when it is
 * neither. For a layout already checked where it was accepted (an alert as
 * delivered); one from a user goes through the caller's own checks.
 */
export function alertCompositionOf(value: unknown): CompositionDocument | null {
  if (isLegacyAlertLayout(value)) {
    return compositionOfLegacyAlert(value).doc;
  }
  return normalizeComposition(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
