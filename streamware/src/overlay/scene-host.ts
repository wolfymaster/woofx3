import type { SharedLogger } from "@woofx3/common/logging";
import type * as scene from "@woofx3/db/scene.pb";
import type * as module_widget from "@woofx3/db/module_widget.pb";
import { getBuiltinWidgetSpecs } from "../widgets/builtin";
import type { OverlayTokenResolver } from "./token-resolver";
import { maskToken } from "./token-resolver";

/** Reserved module namespace for built-in widgets (design 5.2.2). */
export const BUILTIN_MODULE_KEY = "builtin";

export interface OverlayWidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One widget instance in a token overlay's scene config. `frameUrl`
 * is derived (never stored): the scene manager mounts an iframe at
 * `./frame/{instanceId}` relative to the overlay shell URL, so the
 * same config works through the api proxy or any tunnel (FR-5.2).
 */
export interface OverlayWidgetInstance {
  id: string;
  widgetCanonicalId: string;
  /** First segment of the canonical id — the module key. */
  moduleId: string;
  /** Third segment of the canonical id — the widget's manifest id. */
  manifestId: string;
  position: OverlayWidgetPosition;
  settings: Record<string, unknown>;
  acceptedEvents: string[];
  frameUrl: string;
}

export interface OverlaySceneLayout {
  width?: number;
  height?: number;
  theme?: string;
  [key: string]: unknown;
}

export interface OverlaySceneState {
  sceneId: string;
  applicationId: string;
  name: string;
  layout: OverlaySceneLayout;
  instances: OverlayWidgetInstance[];
}

/** Widget catalog row fields the overlay host needs. */
export interface OverlayWidgetDefinition {
  moduleKey: string;
  manifestId: string;
  /** Entry document relative to the widget asset root; "" -> index.html. */
  entry: string;
}

/** The slice of DbClient the overlay host depends on (injectable for tests). */
export interface OverlayHostDb {
  getScene(req: scene.GetSceneRequest): Promise<scene.SceneResponse>;
  listWidgets(req: module_widget.ListWidgetsRequest): Promise<module_widget.ListWidgetsResponse>;
}

export interface OverlayHostOptions {
  /** Widget-catalog cache TTL in milliseconds (default 30s). */
  widgetCacheTtlMs?: number;
  now?: () => number;
}

const WIDGET_CACHE_TTL_MS = 30_000;

/**
 * Parse a widget canonical id with the invariant `{moduleKey}:widget:{manifestId}`.
 * The moduleKey itself may contain colons (e.g. `spotify:1.0.0:df18e02`), so we
 * locate the last `:widget:` marker rather than splitting on all colons.
 */
export function parseWidgetCanonicalId(
  canonicalId: string
): { moduleKey: string; manifestId: string } | null {
  const MARKER = ":widget:";
  const markerIdx = canonicalId.lastIndexOf(MARKER);
  if (markerIdx <= 0) {
    return null;
  }
  const moduleKey = canonicalId.slice(0, markerIdx);
  const manifestId = canonicalId.slice(markerIdx + MARKER.length);
  if (!moduleKey || !manifestId) {
    return null;
  }
  return { moduleKey, manifestId };
}

/**
 * Overlay host: token -> assembled scene config (design 2.4 / WP-3).
 *
 * Assembly is read-only and derivation-only: stored `bundleUrl` values
 * are ignored (deprecation-logged once per canonical id) and every
 * instance — module-sourced or built-in — gets a derived
 * `frameUrl: "./frame/{instanceId}"` (design 5.2.2: built-ins render
 * via frame assembly uniformly).
 */
export class OverlayHost {
  private widgetCache: { rows: OverlayWidgetDefinition[]; expiresAt: number } | null = null;
  private readonly widgetCacheTtlMs: number;
  private readonly now: () => number;
  private readonly bundleUrlWarned = new Set<string>();

  constructor(
    private readonly resolver: OverlayTokenResolver,
    private readonly db: OverlayHostDb | null,
    private readonly logger: SharedLogger,
    opts: OverlayHostOptions = {}
  ) {
    this.widgetCacheTtlMs = opts.widgetCacheTtlMs ?? WIDGET_CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Resolve a token to its scene state, or null for invalid/revoked/
   * unknown tokens and for any load failure (uniform — no oracle).
   */
  async loadScene(token: string): Promise<OverlaySceneState | null> {
    const resolved = await this.resolver.resolve(token);
    if (!resolved) {
      return null;
    }
    if (!this.db) {
      this.logger.warn("overlay scene load skipped — db proxy unavailable", {
        token: maskToken(token),
      });
      return null;
    }

    let response: scene.SceneResponse;
    try {
      response = await this.db.getScene({ id: resolved.sceneId });
    } catch (err) {
      this.logger.warn("overlay scene fetch failed", {
        sceneId: resolved.sceneId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (response.status?.code !== "OK" || !response.scene) {
      this.logger.warn("overlay token resolves to missing scene", {
        sceneId: resolved.sceneId,
        token: maskToken(token),
      });
      return null;
    }

    const s = response.scene;
    this.logger.info("loadScene: raw widgetsJson from db", {
      sceneId: s.id,
      widgetsJsonLength: s.widgetsJson?.length ?? 0,
      widgetsJsonPreview: (s.widgetsJson ?? "").slice(0, 500),
    });
    return {
      sceneId: s.id,
      applicationId: s.applicationId || resolved.applicationId,
      name: s.name,
      layout: parseLayout(s.layoutJson),
      instances: this.parseInstances(s.widgetsJson),
    };
  }

  /** Dev diagnostic: returns raw DB data + parse results side-by-side. */
  async loadRawScene(token: string): Promise<Record<string, unknown> | null> {
    const resolved = await this.resolver.resolve(token);
    if (!resolved || !this.db) {
      return null;
    }
    let response: scene.SceneResponse;
    try {
      response = await this.db.getScene({ id: resolved.sceneId });
    } catch {
      return null;
    }
    if (response.status?.code !== "OK" || !response.scene) {
      return null;
    }
    const s = response.scene;
    let rawParsed: unknown = null;
    try {
      rawParsed = JSON.parse(s.widgetsJson || "[]");
    } catch {
      rawParsed = "INVALID_JSON";
    }
    return {
      sceneId: s.id,
      applicationId: s.applicationId,
      name: s.name,
      widgetsJsonRaw: s.widgetsJson,
      widgetsJsonParsed: rawParsed,
      parsedInstances: this.parseInstances(s.widgetsJson),
    };
  }

  /**
   * `GET /o/{token}/config` body. Invalid token -> `{ scene: null }`
   * with HTTP 200 (design 2.1: the shell always renders).
   */
  async buildConfig(token: string): Promise<Record<string, unknown>> {
    const state = await this.loadScene(token);
    if (!state) {
      this.logger.info("buildConfig: token did not resolve to a scene", { token: maskToken(token) });
      return { scene: null };
    }
    this.logger.info("buildConfig: resolved scene", {
      token: maskToken(token),
      sceneId: state.sceneId,
      widgetCount: state.instances.length,
      widgets: state.instances.map((w) => ({ id: w.id, canonicalId: w.widgetCanonicalId })),
    });
    return {
      scene: {
        id: state.sceneId,
        applicationId: state.applicationId,
        name: state.name,
        layout: state.layout,
        widgets: state.instances.map((w) => ({
          id: w.id,
          widgetCanonicalId: w.widgetCanonicalId,
          moduleId: w.moduleId,
          position: w.position,
          settings: w.settings,
          acceptedEvents: w.acceptedEvents,
          frameUrl: w.frameUrl,
        })),
      },
    };
  }

  /**
   * Widget catalog lookup by (moduleKey, manifestId), backed by a
   * TTL-cached `listWidgets` sweep. Returns null when the catalog has
   * no matching row — the frame assembler then falls back to the
   * default entry ("index.html").
   */
  async lookupWidgetDefinition(
    moduleKey: string,
    manifestId: string
  ): Promise<OverlayWidgetDefinition | null> {
    const rows = await this.loadWidgetCatalog();
    return rows.find((r) => r.moduleKey === moduleKey && r.manifestId === manifestId) ?? null;
  }

  private async loadWidgetCatalog(): Promise<OverlayWidgetDefinition[]> {
    if (this.widgetCache && this.widgetCache.expiresAt > this.now()) {
      return this.widgetCache.rows;
    }
    if (!this.db) {
      return [];
    }
    try {
      const response = await this.db.listWidgets({ createdByType: "", createdByRef: "" });
      const rows: OverlayWidgetDefinition[] = (response.widgets ?? []).map((w) => ({
        moduleKey: w.moduleId,
        manifestId: w.manifestId,
        entry: w.entry ?? "",
      }));
      this.widgetCache = { rows, expiresAt: this.now() + this.widgetCacheTtlMs };
      return rows;
    } catch (err) {
      this.logger.warn("widget catalog load failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.widgetCache?.rows ?? [];
    }
  }

  private parseInstances(widgetsJson: string): OverlayWidgetInstance[] {
    let raw: unknown;
    try {
      raw = JSON.parse(widgetsJson || "[]");
    } catch {
      this.logger.warn("scene widgetsJson is not valid JSON; rendering empty scene");
      return [];
    }
    if (!Array.isArray(raw)) {
      return [];
    }
    const instances: OverlayWidgetInstance[] = [];
    for (const entry of raw) {
      const instance = this.normalizeInstance(entry);
      if (instance) {
        instances.push(instance);
      }
    }
    return instances;
  }

  private normalizeInstance(raw: unknown): OverlayWidgetInstance | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const w = raw as Record<string, unknown>;
    const id = typeof w.id === "string" ? w.id : "";
    // Accept both the legacy `widgetCanonicalId` field and the current
    // `widgetDefinitionRef` field written by the UI's WidgetInstance type.
    const canonicalId =
      typeof w.widgetCanonicalId === "string" && w.widgetCanonicalId
        ? w.widgetCanonicalId
        : typeof w.widgetDefinitionRef === "string"
          ? w.widgetDefinitionRef
          : "";
    if (!id || !canonicalId) {
      this.logger.info("normalizeInstance: dropping widget — missing id or widgetDefinitionRef", { raw: JSON.stringify(raw).slice(0, 200) });
      return null;
    }
    const parsed = parseWidgetCanonicalId(canonicalId);
    if (!parsed) {
      this.logger.info("normalizeInstance: dropping widget — malformed canonicalId (expected moduleKey:widget:manifestId)", {
        id,
        canonicalId,
      });
      return null;
    }

    // Strip version segments from the module key so scene placements remain
    // stable across module updates. A versioned key like "spotify:1.0.0:abc1234"
    // normalises to "spotify"; a simple key like "builtin" is unchanged.
    const stableModuleKey = stableModuleKeyFrom(parsed.moduleKey);
    const stableCanonicalId = `${stableModuleKey}:widget:${parsed.manifestId}`;
    if (stableModuleKey !== parsed.moduleKey) {
      this.logger.warn("normalizeInstance: stripping version from moduleKey — update the UI to store the stable projection key", {
        id,
        stored: canonicalId,
        normalized: stableCanonicalId,
      });
    } else {
      this.logger.info("normalizeInstance: accepted widget", { id, canonicalId: stableCanonicalId, moduleKey: stableModuleKey, manifestId: parsed.manifestId });
    }

    // Stored bundleUrl is legacy: frame URLs are derived (design 2.5).
    if (typeof w.bundleUrl === "string" && w.bundleUrl && !this.bundleUrlWarned.has(stableCanonicalId)) {
      this.bundleUrlWarned.add(stableCanonicalId);
      this.logger.warn("scene widget carries deprecated bundleUrl; ignored in favor of frameUrl", {
        widgetCanonicalId: stableCanonicalId,
      });
    }

    let acceptedEvents = Array.isArray(w.acceptedEvents)
      ? w.acceptedEvents.filter((e): e is string => typeof e === "string" && e !== "")
      : [];
    if (acceptedEvents.length === 0 && stableModuleKey === BUILTIN_MODULE_KEY) {
      const spec = getBuiltinWidgetSpecs().find((s) => s.manifestId === parsed.manifestId);
      if (spec) {
        acceptedEvents = spec.acceptedEvents;
      }
    }

    return {
      id,
      widgetCanonicalId: stableCanonicalId,
      moduleId: stableModuleKey,
      manifestId: parsed.manifestId,
      position: normalizePosition(w),
      settings:
        w.settings && typeof w.settings === "object"
          ? (w.settings as Record<string, unknown>)
          : {},
      acceptedEvents,
      frameUrl: `./frame/${encodeURIComponent(id)}`,
    };
  }
}

/**
 * Extract the stable base name from a module key. If the key contains colons
 * (indicating a versioned form like "spotify:1.0.0:abc1234"), only the first
 * segment is returned. Simple keys like "builtin" pass through unchanged.
 *
 * Scene placements must reference the module by stable name so they survive
 * module updates. This normalises legacy data written by UIs that stored the
 * full versioned canonical id.
 */
export function stableModuleKeyFrom(moduleKey: string): string {
  const colonIdx = moduleKey.indexOf(":");
  return colonIdx === -1 ? moduleKey : moduleKey.slice(0, colonIdx);
}

function normalizePosition(w: Record<string, unknown>): OverlayWidgetPosition {
  const position = (w.position ?? {}) as Record<string, unknown>;
  const size = (w.size ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  return {
    x: num(position.x) ?? 0,
    y: num(position.y) ?? 0,
    width: num(position.width) ?? num(size.width) ?? 0,
    height: num(position.height) ?? num(size.height) ?? 0,
  };
}

function parseLayout(layoutJson: string): OverlaySceneLayout {
  try {
    const parsed = JSON.parse(layoutJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as OverlaySceneLayout)
      : {};
  } catch {
    return {};
  }
}
