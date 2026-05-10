// SceneConfig is the shape the streamware overlay shell hydrates from
// when serving `/overlay/scene`. Mirrors the engine-side `Scene` proto
// shape (see `db/proto/v1/scene.proto`) — `widgetsJson` and `layoutJson`
// columns deserialize into `widgets[]` and `layout` here.
//
// Until the api/ surface for scenes lands, the config is passed inline
// via `?config=<urlencoded JSON>` for development / testing; production
// fetches over the api by `sceneId`.

export interface WidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetInstance {
  /** Stable instance id within the scene. */
  id: string;
  /** Canonical id of the registered module widget this instance
   *  references — `{moduleId}:widget:{manifestId}`. */
  widgetCanonicalId: string;
  /** Module id (first segment of the canonical id), surfaced here so
   *  the widgetHost can scope its storage subscriptions without
   *  re-parsing the canonical id. */
  moduleId: string;
  /** Public URL of the widget's `index.html`. Resolved by the deployer's
   *  asset pipeline (CDN, signed URL, local fixture, etc.) — the shell
   *  treats it as opaque. */
  bundleUrl: string;
  /** Pixel-space placement on the overlay canvas. */
  position: WidgetPosition;
  /** Per-instance settings the editor populated from the widget's
   *  `settingsSchema`. Frozen and forwarded to the widget as
   *  `widgetHost.settings`. */
  settings: Record<string, unknown>;
  /** Canonical trigger ids the widget declared interest in via its
   *  manifest's `acceptedEvents[]`. Drives the SceneOverlay's per-
   *  widget event filtering: only events whose canonical id is in
   *  this list reach the widget's `widgetHost.onEvent` handler.
   *  Empty array (or absent) means the widget receives no events. */
  acceptedEvents?: string[];
}

export interface SceneLayout {
  /** Optional canvas dimensions. When set, the overlay container is
   *  sized to these values; widget positions are interpreted in this
   *  coordinate space. */
  width?: number;
  height?: number;
  /** Free-form theme hint forwarded to widgets that opt to read it. */
  theme?: string;
}

export interface SceneConfig {
  widgets: WidgetInstance[];
  layout?: SceneLayout;
}

const EMPTY_SCENE: SceneConfig = { widgets: [] };

/**
 * Parse a SceneConfig from a URL search string. Returns the empty
 * scene on missing / malformed input rather than throwing — the
 * overlay should keep rendering (perhaps as a "no widgets" state)
 * instead of crashing the browser source.
 *
 * Exported for direct unit testing.
 */
export function parseSceneConfigFromUrl(search: string): SceneConfig {
  const params = new URLSearchParams(search);
  const raw = params.get("config");
  if (!raw) {
    return EMPTY_SCENE;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.widgets)) {
      return EMPTY_SCENE;
    }
    const widgets: WidgetInstance[] = [];
    for (const w of parsed.widgets) {
      const valid = validateWidgetInstance(w);
      if (valid) {
        widgets.push(valid);
      }
    }
    const layout = isLayout(parsed.layout) ? parsed.layout : undefined;
    return { widgets, layout };
  } catch {
    return EMPTY_SCENE;
  }
}

function validateWidgetInstance(raw: unknown): WidgetInstance | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.widgetCanonicalId !== "string" || !r.widgetCanonicalId) return null;
  if (typeof r.moduleId !== "string" || !r.moduleId) return null;
  if (typeof r.bundleUrl !== "string" || !r.bundleUrl) return null;
  if (!isPosition(r.position)) return null;
  const settings = r.settings && typeof r.settings === "object" ? (r.settings as Record<string, unknown>) : {};
  // acceptedEvents is optional — widgets without declared interest
  // receive no events, which is the right default for static
  // display-only widgets.
  const acceptedEvents = Array.isArray(r.acceptedEvents)
    ? r.acceptedEvents.filter((e): e is string => typeof e === "string" && e !== "")
    : undefined;
  return {
    id: r.id,
    widgetCanonicalId: r.widgetCanonicalId,
    moduleId: r.moduleId,
    bundleUrl: r.bundleUrl,
    position: r.position,
    settings,
    ...(acceptedEvents && acceptedEvents.length > 0 ? { acceptedEvents } : {}),
  };
}

function isPosition(p: unknown): p is WidgetPosition {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.x === "number" &&
    typeof o.y === "number" &&
    typeof o.width === "number" &&
    typeof o.height === "number"
  );
}

function isLayout(l: unknown): l is SceneLayout {
  if (!l || typeof l !== "object") return false;
  const o = l as Record<string, unknown>;
  if (o.width !== undefined && typeof o.width !== "number") return false;
  if (o.height !== undefined && typeof o.height !== "number") return false;
  if (o.theme !== undefined && typeof o.theme !== "string") return false;
  return true;
}
