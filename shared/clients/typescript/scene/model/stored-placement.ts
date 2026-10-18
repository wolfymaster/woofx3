// A placement as it is stored outside a composition document: an entry of a
// scene row's `widgets_json`, the list the dashboard's editor writes, and the
// same entry shape in alert layouts saved before alerts were compositions.
//
//   { id, widgetCanonicalId, name, position: { x, y }, size: { width, height },
//     rotation, opacity, zIndex, locked, visible, settings, ...anything else }
//
// This is the one mapping between that entry and a `PlacementDocument`. A
// field the placement also has is read with the placement's default when it
// is missing or out of range; any other field is kept in the placement's
// `extra` and written back as it was, so a round trip loses nothing the
// document does not model. `zIndex` is read into the order of `z` keys by the
// caller rather than kept, so it cannot disagree with them.

import { isPlainObject } from "./composition";
import { PLACEMENT_NAME_MAX_LENGTH } from "./entity-types";
import type { NodeId, PlacementDocument } from "./types";

/**
 * Entry fields the placement models. `widgetDefinitionRef` is the older name
 * of `widgetCanonicalId`, read when that is absent and written back as it.
 */
export const STORED_PLACEMENT_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "widgetCanonicalId",
  "widgetDefinitionRef",
  "position",
  "size",
  "settings",
  "name",
  "visible",
  "rotation",
  "opacity",
  "locked",
  "zIndex",
]);

/** The canonical widget id an entry names, as stored, or "" when it names none. */
export function storedWidgetId(entry: Record<string, unknown>): string {
  if (typeof entry.widgetCanonicalId === "string" && entry.widgetCanonicalId !== "") {
    return entry.widgetCanonicalId;
  }
  return typeof entry.widgetDefinitionRef === "string" ? entry.widgetDefinitionRef : "";
}

/** A stored entry as a placement at stacking key `z`. The id is the caller's: it keys the placement. */
export function placementOfStored(entry: Record<string, unknown>, z: string): PlacementDocument {
  const position = isPlainObject(entry.position) ? entry.position : {};
  const size = isPlainObject(entry.size) ? entry.size : {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!STORED_PLACEMENT_FIELDS.has(key)) {
      extra[key] = value;
    }
  }
  return {
    widget: storedWidgetId(entry),
    x: numberOr(position.x, 0),
    y: numberOr(position.y, 0),
    width: numberOr(position.width, numberOr(size.width, 0)),
    height: numberOr(position.height, numberOr(size.height, 0)),
    visible: typeof entry.visible === "boolean" ? entry.visible : true,
    z,
    settings: isPlainObject(entry.settings) ? entry.settings : {},
    name: typeof entry.name === "string" && entry.name.length <= PLACEMENT_NAME_MAX_LENGTH ? entry.name : "",
    rotation: numberOr(entry.rotation, 0),
    opacity: isFiniteNumber(entry.opacity) && entry.opacity >= 0 && entry.opacity <= 1 ? entry.opacity : 1,
    locked: typeof entry.locked === "boolean" ? entry.locked : false,
    extra,
  };
}

/** A placement as a stored entry, `zIndex` its place in the stack (bottom first). */
export function storedOfPlacement(id: NodeId, p: PlacementDocument, zIndex: number): Record<string, unknown> {
  return {
    ...p.extra,
    id,
    widgetCanonicalId: p.widget,
    name: p.name,
    position: { x: p.x, y: p.y },
    size: { width: p.width, height: p.height },
    rotation: p.rotation,
    opacity: p.opacity,
    zIndex,
    locked: p.locked,
    visible: p.visible,
    settings: p.settings,
  };
}

// ---------------------------------------------------------------------------
// Canonical widget ids

/** A canonical widget id's parts: `{moduleKey}:widget:{manifestId}`. */
export interface WidgetCanonicalId {
  moduleKey: string;
  manifestId: string;
}

/**
 * The parts of a canonical widget id, or null when it is not one. The module
 * key may itself hold colons (`spotify:1.0.0:df18e02`), so the last
 * `:widget:` marker splits it.
 */
export function parseWidgetCanonicalId(canonicalId: string): WidgetCanonicalId | null {
  const marker = canonicalId.lastIndexOf(":widget:");
  if (marker <= 0) {
    return null;
  }
  const moduleKey = canonicalId.slice(0, marker);
  const manifestId = canonicalId.slice(marker + ":widget:".length);
  return moduleKey === "" || manifestId === "" ? null : { moduleKey, manifestId };
}

/**
 * A module key without its version segments (`spotify:1.0.0:abc` is
 * `spotify`): the id a module is installed, stored and placed under across
 * updates.
 */
export function stableModuleKey(moduleKey: string): string {
  return moduleKey.split(":")[0] ?? moduleKey;
}

/** The stable module id a canonical widget id names, or null when it is not one. */
export function moduleIdOfCanonicalId(canonicalId: string): string | null {
  const parsed = parseWidgetCanonicalId(canonicalId);
  return parsed === null ? null : stableModuleKey(parsed.moduleKey);
}

/** A canonical widget id with its module key made stable. */
export function stableCanonicalId(canonicalId: string): string | null {
  const parsed = parseWidgetCanonicalId(canonicalId);
  return parsed === null ? null : `${stableModuleKey(parsed.moduleKey)}:widget:${parsed.manifestId}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}
