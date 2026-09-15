import {
  normalizePosition,
  type OverlayWidgetDefinition,
  type OverlayWidgetInstance,
  type OverlayWidgetPosition,
  parseWidgetCanonicalId,
  stableModuleKeyFrom,
} from "./scene-host";

/** The scene-event `type` an alert is recorded and delivered under. */
export const ALERT_EVENT_TYPE = "alert";

/** The surface an alert widget hosts, and that an alert layout's widgets must list. */
export const ALERT_SURFACE = "alert";

/**
 * The alert widget an alert plays on when its step names none. The UI gives a
 * scene's first alert widget this name, so an unconfigured step reaches it.
 */
export const DEFAULT_ALERT_WIDGET_NAME = "default";

/** Layout widget ids end up in the frame URL, so they are held to a URL-safe token. */
const LAYOUT_WIDGET_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface AlertLayoutWidget {
  id: string;
  widgetCanonicalId: string;
  moduleId: string;
  manifestId: string;
  position: OverlayWidgetPosition;
  settings: Record<string, unknown>;
}

/** An alert's widgets, positioned on a canvas the alert widget scales to fit. */
export interface AlertLayout {
  width: number;
  height: number;
  widgets: AlertLayoutWidget[];
}

/** One alert as delivered to a scene, and as stored on its scene event. */
export interface AlertDelivery {
  alertId: string;
  layout: AlertLayout;
  /** The CloudEvent that triggered the workflow; null when nothing did (a manual or scheduled run). */
  event: { type: string; data: unknown } | null;
}

export interface RejectedLayoutWidget {
  index: number;
  widgetCanonicalId: string;
  reason: string;
}

/**
 * Validate an alert step's `layout` against the widget catalog.
 *
 * Layouts are authored by users and by module manifests, so the scene manager
 * decides what it will frame: only catalog widgets that list the alert
 * surface, each under an id unique in the layout. A widget that fails is
 * dropped and reported rather than sinking the whole alert. Returns null when
 * the layout itself is unusable.
 */
export function parseAlertLayout(
  raw: unknown,
  catalog: OverlayWidgetDefinition[]
): { layout: AlertLayout; rejected: RejectedLayoutWidget[] } | null {
  if (!isRecord(raw) || !isPositiveNumber(raw.width) || !isPositiveNumber(raw.height) || !Array.isArray(raw.widgets)) {
    return null;
  }

  const byCanonicalId = new Map(catalog.map((row) => [`${row.moduleKey}:widget:${row.manifestId}`, row]));
  const widgets: AlertLayoutWidget[] = [];
  const rejected: RejectedLayoutWidget[] = [];
  const ids = new Set<string>();
  for (const [index, entry] of raw.widgets.entries()) {
    const w = isRecord(entry) ? entry : {};
    const storedCanonicalId = typeof w.widgetCanonicalId === "string" ? w.widgetCanonicalId : "";
    const reject = (reason: string) => rejected.push({ index, widgetCanonicalId: storedCanonicalId, reason });

    const id = typeof w.id === "string" ? w.id : "";
    if (!LAYOUT_WIDGET_ID.test(id)) {
      reject("`id` must be 1-64 letters, digits, '-' or '_'");
      continue;
    }
    if (ids.has(id)) {
      reject(`duplicate id ${JSON.stringify(id)}`);
      continue;
    }
    const parsed = parseWidgetCanonicalId(storedCanonicalId);
    if (!parsed) {
      reject("not a widget canonical id");
      continue;
    }
    const moduleId = stableModuleKeyFrom(parsed.moduleKey);
    const widgetCanonicalId = `${moduleId}:widget:${parsed.manifestId}`;
    const definition = byCanonicalId.get(widgetCanonicalId);
    if (!definition) {
      reject("no such widget");
      continue;
    }
    if (!definition.surfaces.includes(ALERT_SURFACE)) {
      reject("the widget cannot be placed in an alert");
      continue;
    }

    ids.add(id);
    widgets.push({
      id,
      widgetCanonicalId,
      moduleId,
      manifestId: parsed.manifestId,
      position: normalizePosition(w),
      settings: isRecord(w.settings) ? w.settings : {},
    });
  }
  return { layout: { width: raw.width, height: raw.height, widgets }, rejected };
}

/**
 * Read back an alert stored on a scene event. It passed `parseAlertLayout`
 * before it was recorded, so this only restores the shape.
 */
export function parseAlertDelivery(raw: unknown): AlertDelivery | null {
  if (
    !isRecord(raw) ||
    typeof raw.alertId !== "string" ||
    !isRecord(raw.layout) ||
    !Array.isArray(raw.layout.widgets)
  ) {
    return null;
  }
  return raw as unknown as AlertDelivery;
}

/** The alert widget name an alert step targets. */
export function alertTarget(parameters: Record<string, unknown>): string {
  return nameOrDefault(parameters.target);
}

/** The name an alert widget placement answers to. */
export function alertWidgetName(instance: OverlayWidgetInstance): string {
  return nameOrDefault(instance.settings.name);
}

/** Every alert widget on a scene that answers to `name`. */
export function alertWidgetsNamed(instances: OverlayWidgetInstance[], name: string): OverlayWidgetInstance[] {
  return instances.filter((instance) => instance.hostsSurface === ALERT_SURFACE && alertWidgetName(instance) === name);
}

function nameOrDefault(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  return name || DEFAULT_ALERT_WIDGET_NAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
