import type { CompositionKind } from "@woofx3/api";
import type { SceneDocument } from "@woofx3/api/scene-editor";
import type { Logger } from "@woofx3/common/runtime";
import type { DeclaredBehaviorKinds } from "@woofx3/scene/model";
import type * as module_widget from "@woofx3/db/module_widget.pb";
import type * as scene from "@woofx3/db/scene.pb";
import type * as scene_event from "@woofx3/db/scene_event.pb";
import type { PlacementFraming } from "./frame-catalog";
import type { OverlayTokenResolver } from "./token-resolver";
import { maskToken } from "./token-resolver";
import { SceneRowReader } from "./scene-rows";
import { WidgetCatalog } from "./widget-catalog";

export interface OverlayWidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One widget instance in a token overlay's scene config. `frameUrl` is
 * derived (never stored): the widget's frame document,
 * `/frames/{moduleId}/{manifestId}?theme=…&v=…`, the same for every
 * placement of the widget. The page adds the placement in the fragment.
 * Deliberately absolute: the scene shell is served at `/scene/{sceneId}`
 * with no trailing slash, so a relative URL would resolve against `/scene/`.
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
  /**
   * The surface this placement hosts, or "" for an ordinary widget. An
   * "alert" placement is an area that plays alert layouts: the page draws it,
   * and it has no frame of its own. Taken from the definition.
   */
  hostsSurface: string;
  frameUrl: string;
  /** The resource instances the widget's module links (see `linkedResources`
   *  in module-state.ts), handed to the frame with the placement. */
  linkedResources?: Record<string, string>;
  /** Set by framing for a widget whose frame runs under the theme policy
   *  (see `PlacementMeta.mediaProxyBase`). */
  mediaProxyBase?: string;
  /** Set by framing when barkloader gave no frame for the widget (it failed,
   *  timed out, or does not know the widget yet). The frame URL is then
   *  unversioned and `mediaProxyBase` unknown, so the placement is framed
   *  again later (see `SceneDocuments`). Never sent to pages. */
  frameUnavailable?: true;
  /** False for a placement hidden in the editor. */
  visible: boolean;
  /**
   * The kinds the widget declares it plays itself, from the catalog. Absent
   * until the placement is resolved against it, or when the catalog could
   * not be read; a page then hands the widget none of its own kinds.
   */
  behaviorKinds?: DeclaredBehaviorKinds;
  /** The placement exactly as stored, for writing the scene back without
   *  losing the fields only the editor reads (see scene-documents.ts). */
  stored?: Record<string, unknown>;
  /**
   * False when this placement's `widgetCanonicalId` matches no widget in the
   * catalog — the widget was renamed, or its module was uninstalled, and the
   * scene still points at the old id.
   *
   * Placements are canonical-id references with no integrity check behind
   * them: nothing rewrites a scene when a module renames a widget. Flagged
   * here because an unresolvable one would otherwise render as a blank area,
   * which is exactly what a widget with nothing to show looks like.
   */
  resolved: boolean;
}

export interface OverlaySceneLayout {
  width?: number;
  height?: number;
  theme?: string;
  [key: string]: unknown;
}

export interface OverlaySceneState {
  sceneId: string;
  name: string;
  /**
   * A `scene`, shown by overlays, or an `alert`, which steps play and which
   * is never an overlay page: token loads refuse it and alerts are never
   * delivered to it.
   */
  kind: CompositionKind;
  layout: OverlaySceneLayout;
  instances: OverlayWidgetInstance[];
  /**
   * The version's behaviors as stored. The scene editor's sequencer checks
   * every change it commits; what is stored is not checked again here.
   */
  behaviors: SceneDocument["behaviors"];
  /** The inputs the composition takes; empty for a scene. The same for both versions. */
  inputs: NonNullable<SceneDocument["inputs"]>;
  /** Whether the scene has an unpublished draft (see `loadSceneById`). */
  hasDraft?: boolean;
  /** What of the stored version could not be read; absent when all of it was. */
  unread?: StoredUnread;
}

/** A column of a stored scene version that `StoredUnread` can name. */
export type StoredColumn = "widgets" | "layout" | "behaviors";

/**
 * Stored data a load could not read. A scene is written back whole, so
 * anything left out of the document on the way in would be deleted on the
 * way out: unreadable placements are kept as stored and written back after
 * the readable ones, and a column whose text could not be read at all means
 * the scene must not be written back.
 */
export interface StoredUnread {
  /** Placements that did not parse, exactly as stored, in stored order. */
  placements: unknown[];
  /** Columns whose whole text was not what it must be (JSON of the right shape). */
  columns: StoredColumn[];
}

/**
 * Both versions of a scene from one read of its row, framed, with the scene
 * editor's stored sync state: what the scene documents load a scene from.
 */
export interface EditableScene {
  published: OverlaySceneState;
  draft: OverlaySceneState;
  /** The stored editor state, a JSON object; null until an editor has synced the scene, or after it was cleared. */
  editorStateJson: string | null;
}

/** Which of a scene's versions to load: what overlays show, or the editor's draft. */
export type SceneVersion = "published" | "draft";

/** Widget catalog row fields the scene host needs. */
export interface OverlayWidgetDefinition {
  moduleKey: string;
  manifestId: string;
  /** Entry document relative to the widget asset root; "" -> index.html. */
  entry: string;
  surfaces: string[];
  hostsSurface: string;
  /** The transition and effect kinds the widget declares it plays itself. */
  behaviorKinds: DeclaredBehaviorKinds;
}

/** The slice of DbClient the scene host depends on (injectable for tests). */
export interface OverlayHostDb {
  getScene(req: scene.GetSceneRequest): Promise<scene.SceneResponse>;
  listWidgets(req: module_widget.ListWidgetsRequest): Promise<module_widget.ListWidgetsResponse>;
  getSceneEvent(req: scene_event.GetSceneEventRequest): Promise<scene_event.SceneEventResponse>;
}

export interface OverlayHostOptions {
  /** Widget-catalog cache TTL in milliseconds (default 30s). */
  widgetCacheTtlMs?: number;
  now?: () => number;
  /** Versions each placement's frame URL and attaches its linked resources
   *  (see `FrameCatalog`). Without it, frame URLs are unversioned. */
  framing?: PlacementFraming;
}

/**
 * Scenes as the routes and the scene documents load them: by overlay token
 * (the page's first load), by id (everything holding a session), or both
 * versions at once (the scene documents), each read from its row by
 * `SceneRowReader` and framed for this engine (`PlacementFraming`); and the
 * page config built from one.
 */
export class OverlayHost {
  private readonly framing: PlacementFraming | null;
  private readonly catalog: WidgetCatalog;
  private readonly rows: SceneRowReader;

  constructor(
    private readonly resolver: OverlayTokenResolver,
    private readonly db: OverlayHostDb | null,
    private readonly logger: Logger,
    opts: OverlayHostOptions = {}
  ) {
    this.framing = opts.framing ?? null;
    this.catalog = new WidgetCatalog(db, logger, { ttlMs: opts.widgetCacheTtlMs, now: opts.now });
    this.rows = new SceneRowReader(this.catalog, logger);
  }

  /** The widget catalog, cached for a short while. Empty when the lookup fails. */
  loadWidgetCatalog(): Promise<OverlayWidgetDefinition[]> {
    return this.catalog.rows();
  }

  /** A scene with each placement framed for this engine (see `PlacementFraming`).
   *  Authorization is the caller's, as for `loadSceneById`. */
  async loadFramedSceneById(sceneId: string, version: SceneVersion = "published"): Promise<OverlaySceneState | null> {
    const state = await this.loadSceneById(sceneId, version);
    if (!state || !this.framing) {
      return state;
    }
    return { ...state, instances: await this.framing.frame(state.instances) };
  }

  /** The page's scene config, each placement framed for this engine. */
  private async configOf(state: OverlaySceneState | null): Promise<Record<string, unknown>> {
    if (!state || !this.framing) {
      return sceneConfigOf(state);
    }
    return sceneConfigOf({ ...state, instances: await this.framing.frame(state.instances) });
  }

  /** The scene an overlay token opens, or null when it opens none (unknown, revoked, or the db unreachable). */
  async sceneIdOfToken(token: string): Promise<string | null> {
    return (await this.resolver.resolve(token))?.sceneId ?? null;
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
    const row = await this.fetchRowOrNull(resolved.sceneId);
    if (row === null) {
      this.logger.warn("overlay token resolves to no readable scene", {
        sceneId: resolved.sceneId,
        token: maskToken(token),
      });
      return null;
    }

    const state = await this.rows.stateOf(row, "published");
    if (state === null) {
      return null;
    }
    if (state.kind !== "scene") {
      // Tokens are never minted for an alert; one that resolves to an alert
      // means the row was not a scene when it was minted or the db is
      // inconsistent. Either way it is not a page.
      this.logger.warn("overlay token resolves to an alert, which has no overlay page", {
        sceneId: state.sceneId,
        token: maskToken(token),
      });
      return null;
    }
    return state;
  }

  /**
   * Load scene state directly by id, bypassing token resolution.
   * Callers must have already established authorization some other
   * way — the session JWT minted at `GET /scene/{sceneId}` (which was
   * itself only minted after `loadScene(token)` succeeded) is the
   * intended caller. Used by widget-frame and event routes, which
   * carry that JWT instead of the original opaque overlay token.
   */
  async loadSceneById(sceneId: string, version: SceneVersion = "published"): Promise<OverlaySceneState | null> {
    const row = await this.fetchRowOrNull(sceneId);
    return row === null ? null : this.rows.stateOf(row, version);
  }

  /**
   * Both versions of a scene and its stored editor state, from one read of
   * the row, so they describe the same save. Null when the scene does not
   * exist; throws when it cannot be read, so the caller can tell a missing
   * scene from a failed read. Authorization is the caller's, as for
   * `loadSceneById`.
   */
  async loadEditableScene(sceneId: string): Promise<EditableScene | null> {
    const s = await this.fetchRow(sceneId);
    if (s === null) {
      return null;
    }
    const [published, draft] = await Promise.all([this.rows.stateOf(s, "published"), this.rows.stateOf(s, "draft")]);
    if (published === null || draft === null) {
      return null;
    }
    const framed = async (state: OverlaySceneState): Promise<OverlaySceneState> =>
      this.framing ? { ...state, instances: await this.framing.frame(state.instances) } : state;
    const framedPublished = await framed(published);
    return {
      published: framedPublished,
      // With no draft the draft is the published scene: framed once.
      draft: s.hasDraft ? await framed(draft) : framedPublished,
      editorStateJson: s.editorStateJson === "" ? null : s.editorStateJson,
    };
  }

  /**
   * The id of every placement stored in either version of a scene, whether
   * or not it parses; null when there is no such scene, or a version's
   * placements are not a list to read ids from. Throws when the scene cannot
   * be read.
   */
  async placementIds(sceneId: string): Promise<Set<string> | null> {
    const s = await this.fetchRow(sceneId);
    if (s === null) {
      return null;
    }
    const ids = new Set<string>();
    for (const json of [s.widgetsJson, s.hasDraft ? s.draftWidgetsJson : ""]) {
      let stored: unknown;
      try {
        stored = JSON.parse(json || "[]");
      } catch {
        return null;
      }
      if (!Array.isArray(stored)) {
        return null;
      }
      for (const placement of stored) {
        const id = (placement as { id?: unknown } | null)?.id;
        if (typeof id === "string") {
          ids.add(id);
        }
      }
    }
    return ids;
  }

  /** A scene's row, or null when there is none; throws when it cannot be read. */
  private async fetchRow(sceneId: string): Promise<scene.Scene | null> {
    if (!this.db) {
      throw new Error("db proxy unavailable");
    }
    const response = await this.db.getScene({ id: sceneId });
    return response.status?.code === "OK" && response.scene ? response.scene : null;
  }

  /** A scene's row, or null when there is none or it cannot be read (said in the log). */
  private async fetchRowOrNull(sceneId: string): Promise<scene.Scene | null> {
    try {
      return await this.fetchRow(sceneId);
    } catch (err) {
      this.logger.warn("scene fetch failed", { sceneId, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /**
   * The scene's config with the editor's unsaved placements in place of the
   * saved ones, for an overlay previewing a draft. Placements go through the
   * same parsing and catalog resolution as saved ones, so the page treats a
   * draft exactly like a save. Frames carry no settings (the page hands them
   * over), so a draft placement's frame is the same as a saved one's.
   * Authorization is the caller's, as for `loadSceneById`.
   */
  async buildDraftConfig(sceneId: string, draftPlacements: unknown[]): Promise<Record<string, unknown>> {
    const saved = await this.loadSceneById(sceneId);
    if (!saved) {
      return { scene: null };
    }
    const instances = await this.rows.placements(sceneId, draftPlacements);
    return this.configOf({ ...saved, instances });
  }

  /** Placements given as stored, parsed, resolved and framed like a loaded scene's. */
  async framePlacements(sceneId: string, entries: unknown[]): Promise<OverlayWidgetInstance[]> {
    const instances = await this.rows.placements(sceneId, entries);
    return this.framing ? this.framing.frame(instances) : instances;
  }

  /**
   * `GET /scene/{sceneId}` shell payload. Invalid token -> `{ scene: null }`
   * (the shell always renders).
   */
  async buildConfig(token: string): Promise<Record<string, unknown>> {
    return this.configOf(await this.loadScene(token));
  }

  /**
   * A scene event, when it belongs to `sceneId`. Callers hold a session for
   * one scene; checking ownership here keeps an event id from another scene
   * from reading across.
   */
  async loadSceneEvent(sceneId: string, eventId: string): Promise<{ type: string; value: unknown } | null> {
    if (!this.db) {
      return null;
    }
    let response: scene_event.SceneEventResponse;
    try {
      response = await this.db.getSceneEvent({ id: eventId });
    } catch (err) {
      this.logger.warn("scene event fetch failed", {
        sceneId,
        eventId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    const event = response.status?.code === "OK" ? response.sceneEvent : undefined;
    if (!event || event.sceneId !== sceneId) {
      return null;
    }
    try {
      return { type: event.type, value: JSON.parse(event.value) };
    } catch {
      return null;
    }
  }
}

/** The page's scene config, the shape `window.__WOOFX3_SCENE__` and `/config` share. */
function sceneConfigOf(state: OverlaySceneState | null): Record<string, unknown> {
  if (!state) {
    return { scene: null };
  }
  return {
    scene: {
      id: state.sceneId,
      name: state.name,
      layout: state.layout,
      widgets: state.instances.map((w) => ({
        id: w.id,
        widgetCanonicalId: w.widgetCanonicalId,
        moduleId: w.moduleId,
        position: w.position,
        settings: w.settings,
        hostsSurface: w.hostsSurface,
        frameUrl: w.frameUrl,
        linkedResources: w.linkedResources ?? {},
        ...(w.mediaProxyBase === undefined ? {} : { mediaProxyBase: w.mediaProxyBase }),
        ...(w.behaviorKinds === undefined ? {} : { behaviorKinds: w.behaviorKinds }),
        visible: w.visible,
        resolved: w.resolved,
      })),
    },
  };
}
