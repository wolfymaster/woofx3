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
  /** Legacy: public URL of the widget's `index.html`, loaded directly
   *  into a same-origin iframe with `widgetHost` injection. Token-mode
   *  scene configs replace this with `frameUrl`; at least one of the
   *  two must be present for the instance to be valid. */
  bundleUrl?: string;
  /** Token-mode frame document URL, relative to the overlay shell
   *  (`./frame/{instanceId}`). The scene manager appends the per-frame
   *  P1 nonce as a query parameter before mounting (design §2.3). */
  frameUrl?: string;
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
    return parseSceneConfigPayload(JSON.parse(raw));
  } catch {
    return EMPTY_SCENE;
  }
}

/**
 * Validate an already-parsed scene config payload (token-mode
 * `./config` responses go through here too). Invalid widgets are
 * dropped individually; a malformed top level yields the empty scene.
 */
export function parseSceneConfigPayload(parsed: unknown): SceneConfig {
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as SceneConfig).widgets)) {
    return EMPTY_SCENE;
  }
  const candidate = parsed as { widgets: unknown[]; layout?: unknown };
  const widgets: WidgetInstance[] = [];
  for (const w of candidate.widgets) {
    const valid = validateWidgetInstance(w);
    if (valid) {
      widgets.push(valid);
    }
  }
  const layout = isLayout(candidate.layout) ? candidate.layout : undefined;
  return { widgets, layout };
}

export function validateWidgetInstance(raw: unknown): WidgetInstance | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.widgetCanonicalId !== "string" || !r.widgetCanonicalId) return null;
  if (typeof r.moduleId !== "string" || !r.moduleId) return null;
  // Either a token-mode frameUrl or a legacy bundleUrl must be present.
  const bundleUrl = typeof r.bundleUrl === "string" && r.bundleUrl ? r.bundleUrl : undefined;
  const frameUrl = typeof r.frameUrl === "string" && r.frameUrl ? r.frameUrl : undefined;
  if (!bundleUrl && !frameUrl) return null;
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
    ...(bundleUrl !== undefined ? { bundleUrl } : {}),
    ...(frameUrl !== undefined ? { frameUrl } : {}),
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
