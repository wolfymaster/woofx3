import {
  ALERT_SURFACE,
  alertCompositionOf,
  alertRouteName,
  alertWidgetName,
  type BehaviorDocument,
  type BehaviorId,
  CANVAS_TARGET,
  type CompositionDocument,
  compositionOfLegacyAlert,
  declaresKind,
  isLegacyAlertLayout,
  type NodeId,
  normalizeComposition,
  type PlacementDocument,
  STRICT_REGISTRY,
  stableCanonicalId,
} from "@woofx3/scene/model";
import type { OverlayWidgetDefinition, OverlayWidgetInstance } from "./scene-host";

/** The scene-event `type` an alert is recorded and delivered under. */
export const ALERT_EVENT_TYPE = "alert";

/** Layout widget ids end up in the frame URL, so they are held to a URL-safe token. */
const LAYOUT_WIDGET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** One alert as delivered to a scene, and as stored on its scene event. */
export interface AlertDelivery {
  alertId: string;
  /**
   * The engine's alert log row for this play, which lifecycle reports name.
   * Absent when the engine recorded no row, and from deliveries recorded
   * before deliveries carried it.
   */
  rowId?: string;
  /**
   * The alert as a composition, every widget one the catalog lets play in an
   * alert, under its canonical id (`{moduleId}:widget:{manifestId}`).
   */
  layout: CompositionDocument;
  /** The CloudEvent that triggered the workflow; null when nothing did (a manual or scheduled run). */
  event: { type: string; data: unknown } | null;
}

export interface RejectedLayoutWidget {
  /** The widget's id in the layout; "" for a list entry with none. */
  id: string;
  /** For a layout in the list shape, the entry's position in the list. */
  index?: number;
  widgetCanonicalId: string;
  reason: string;
}

export interface RejectedLayoutBehavior {
  id: BehaviorId;
  reason: string;
}

/**
 * The outcome of validating an alert step's `layout`.
 *
 * Carries a `reason` rather than collapsing every failure to null: an unusable
 * layout means an alert never plays, and the operator sees only a log line. One
 * message covering "absent", "not an object" and three separate mistyped fields
 * leaves them nothing to act on.
 */
export type AlertLayoutParse =
  | {
      ok: true;
      layout: CompositionDocument;
      rejected: RejectedLayoutWidget[];
      rejectedBehaviors: RejectedLayoutBehavior[];
    }
  | { ok: false; reason: string };

/**
 * Validate an alert step's `layout` against the widget catalog.
 *
 * A layout is a composition (`{ layout, widgets, behaviors }`, what the
 * editor saves) or, from steps saved before alerts were compositions, a
 * canvas with a list of widgets (`{ width, height, widgets: [...] }`), which
 * is converted to one (see @woofx3/scene's legacy-alert.ts). Either way what
 * is delivered is a composition.
 *
 * Layouts are authored by users and by module manifests, so the scene manager
 * decides what it will frame: entries the engine's strict registry accepts,
 * and of the widgets only catalog widgets that list the alert surface, each
 * under a URL-safe id, and of the behaviors only host kinds and kinds their
 * widget declares. A widget or behavior that fails is dropped and
 * reported rather than sinking the whole alert, and a widget takes its
 * behaviors with it; only an unusable layout envelope fails outright, and it
 * says which field was wrong.
 */
export function parseAlertLayout(raw: unknown, catalog: OverlayWidgetDefinition[]): AlertLayoutParse {
  // Checked one field at a time so the caller can say which one. Collapsing
  // these into a single condition is what made a dropped alert unactionable.
  if (!isRecord(raw)) {
    return { ok: false, reason: `layout must be an object, got ${describe(raw)}` };
  }
  // A composition always has its canvas under `layout`; the list shape has
  // it at the top level. Must match validateAlertParams in workflow/actions.go.
  if (Object.hasOwn(raw, "layout")) {
    return parseCompositionLayout(raw, catalog);
  }
  if (!isPositiveNumber(raw.width)) {
    return { ok: false, reason: `layout.width must be a positive number, got ${describe(raw.width)}` };
  }
  if (!isPositiveNumber(raw.height)) {
    return { ok: false, reason: `layout.height must be a positive number, got ${describe(raw.height)}` };
  }
  if (!isLegacyAlertLayout(raw)) {
    return { ok: false, reason: `layout.widgets must be an array, got ${describe(raw.widgets)}` };
  }
  const conversion = compositionOfLegacyAlert(raw);
  const rejected: RejectedLayoutWidget[] = conversion.skipped.map((skip) => ({
    id: "",
    index: skip.index,
    widgetCanonicalId: skip.widgetCanonicalId,
    reason: skip.reason,
  }));
  const parsed = admit(conversion.doc, catalog, conversion.indexOf);
  return {
    ok: true,
    layout: parsed.layout,
    rejected: [...rejected, ...parsed.rejected].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
    rejectedBehaviors: parsed.rejectedBehaviors,
  };
}

function parseCompositionLayout(raw: Record<string, unknown>, catalog: OverlayWidgetDefinition[]): AlertLayoutParse {
  if (!isRecord(raw.layout)) {
    return { ok: false, reason: `layout.layout must be an object, got ${describe(raw.layout)}` };
  }
  if (!isPositiveNumber(raw.layout.width)) {
    return { ok: false, reason: `layout.layout.width must be a positive number, got ${describe(raw.layout.width)}` };
  }
  if (!isPositiveNumber(raw.layout.height)) {
    return {
      ok: false,
      reason: `layout.layout.height must be a positive number, got ${describe(raw.layout.height)}`,
    };
  }
  if (!isRecord(raw.widgets)) {
    return { ok: false, reason: `layout.widgets must be an object keyed by id, got ${describe(raw.widgets)}` };
  }
  const doc = normalizeComposition(raw);
  if (doc === null) {
    return { ok: false, reason: `layout.behaviors must be an object keyed by id, got ${describe(raw.behaviors)}` };
  }
  const parsed = admit(STRICT_REGISTRY.migrateDocument(doc), catalog, {});
  return { ok: true, ...parsed };
}

/**
 * The widgets and behaviors of `doc` the engine will play, and what it
 * refused. `indexOf` places a widget converted from the list shape in that
 * list, for its report.
 */
function admit(
  doc: CompositionDocument,
  catalog: OverlayWidgetDefinition[],
  indexOf: Readonly<Record<NodeId, number>>
): { layout: CompositionDocument; rejected: RejectedLayoutWidget[]; rejectedBehaviors: RejectedLayoutBehavior[] } {
  const byCanonicalId = new Map(catalog.map((row) => [`${row.moduleKey}:widget:${row.manifestId}`, row]));
  const widgets: Record<NodeId, PlacementDocument> = {};
  const definitions = new Map<NodeId, OverlayWidgetDefinition>();
  const rejected: RejectedLayoutWidget[] = [];
  const ids = Object.keys(doc.widgets).sort(
    (a, b) => (indexOf[a] ?? 0) - (indexOf[b] ?? 0) || (a < b ? -1 : a > b ? 1 : 0)
  );
  for (const id of ids) {
    const entry: unknown = doc.widgets[id];
    const storedCanonicalId = isRecord(entry) && typeof entry.widget === "string" ? entry.widget : "";
    const reject = (reason: string) =>
      rejected.push({
        id,
        ...(Object.hasOwn(indexOf, id) ? { index: indexOf[id] } : {}),
        widgetCanonicalId: storedCanonicalId,
        reason,
      });

    if (!LAYOUT_WIDGET_ID.test(id)) {
      reject("`id` must be 1-64 letters, digits, '-' or '_'");
      continue;
    }
    const invalid = STRICT_REGISTRY.invalidEntry("widgets", entry);
    if (invalid !== null) {
      reject(invalid);
      continue;
    }
    const widgetCanonicalId = stableCanonicalId(storedCanonicalId);
    if (widgetCanonicalId === null) {
      reject("not a widget canonical id");
      continue;
    }
    const definition = byCanonicalId.get(widgetCanonicalId);
    if (!definition) {
      reject("no such widget");
      continue;
    }
    if (!definition.surfaces.includes(ALERT_SURFACE)) {
      reject("the widget cannot be placed in an alert");
      continue;
    }
    widgets[id] = { ...(entry as PlacementDocument), widget: widgetCanonicalId };
    definitions.set(id, definition);
  }

  const behaviors: Record<BehaviorId, BehaviorDocument> = {};
  const rejectedBehaviors: RejectedLayoutBehavior[] = [];
  for (const id of Object.keys(doc.behaviors).sort()) {
    const entry: unknown = doc.behaviors[id];
    const invalid = STRICT_REGISTRY.invalidEntry("behaviors", entry);
    if (invalid !== null) {
      rejectedBehaviors.push({ id, reason: invalid });
      continue;
    }
    const behavior = entry as BehaviorDocument;
    if (behavior.target !== CANVAS_TARGET && !Object.hasOwn(widgets, behavior.target)) {
      // A behavior on a widget refused above goes with it; that widget's
      // report already says why.
      if (!Object.hasOwn(doc.widgets, behavior.target)) {
        rejectedBehaviors.push({ id, reason: `targets no widget: ${JSON.stringify(behavior.target)}` });
      }
      continue;
    }
    // The strict registry takes any well-formed kind as the widget's own;
    // only the catalog knows whether this widget declares it. Handing a
    // widget a kind it never declared would show it unanimated, so it is
    // refused here like any other behavior the engine cannot play.
    const definition = definitions.get(behavior.target);
    if (
      definition !== undefined &&
      STRICT_REGISTRY.executorOf(behavior.type, behavior.kind) === "widget" &&
      !declaresKind(definition.behaviorKinds, behavior.type, behavior.kind)
    ) {
      rejectedBehaviors.push({
        id,
        reason: `the widget ${widgets[behavior.target].widget} does not play the ${behavior.type} ${JSON.stringify(behavior.kind)}`,
      });
      continue;
    }
    behaviors[id] = behavior;
  }
  return { layout: { ...doc, widgets, behaviors }, rejected, rejectedBehaviors };
}

/**
 * Read back an alert stored on a scene event. It passed `parseAlertLayout`
 * before it was recorded, so this only restores the shape; an alert recorded
 * before deliveries carried compositions holds the list shape, and is
 * converted.
 */
export function parseAlertDelivery(raw: unknown): AlertDelivery | null {
  if (!isRecord(raw) || typeof raw.alertId !== "string") {
    return null;
  }
  const layout = alertCompositionOf(raw.layout);
  if (layout === null) {
    return null;
  }
  return { ...(raw as unknown as AlertDelivery), layout };
}

/** Whether an alert layout has a widget that will be seen: a hidden one does not play. */
export function hasVisibleWidget(layout: CompositionDocument): boolean {
  return Object.values(layout.widgets).some((placement) => placement.visible);
}

/** The alert widget name an alert step targets. */
export function alertTarget(parameters: Record<string, unknown>): string {
  return alertRouteName(parameters.target);
}

/** Every alert widget on a scene that answers to `name`. */
export function alertWidgetsNamed(instances: OverlayWidgetInstance[], name: string): OverlayWidgetInstance[] {
  return instances.filter(
    (instance) => instance.hostsSurface === ALERT_SURFACE && alertWidgetName(instance.settings) === name
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Name what arrived, for a rejection message.
 *
 * Quotes strings and prints numbers, because the two failures worth telling
 * apart both look identical otherwise: a dimension serialized as `"1920"`
 * rather than `1920`, and one that is genuinely `0`.
 */
function describe(value: unknown): string {
  if (value === undefined) {
    return "nothing";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  if (typeof value === "string") {
    return `the string ${JSON.stringify(value)}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${typeof value} ${String(value)}`;
  }
  return typeof value;
}
