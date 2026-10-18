// A stored scene row read as scene state: its placements (and what of them
// could not be read), layout, behaviors, inputs and kind, each placement
// resolved against the widget catalog.

import type { CompositionKind } from "@woofx3/api";
import type { SceneDocument } from "@woofx3/api/scene-editor";
import type { Logger } from "@woofx3/common/runtime";
import type * as scene from "@woofx3/db/scene.pb";
import { parseWidgetCanonicalId, placementOfStored, stableModuleKey, storedWidgetId } from "@woofx3/scene/model";
import { frameDocumentUrl, UNAVAILABLE_VERSION } from "./frame-catalog";
import type {
  OverlaySceneLayout,
  OverlaySceneState,
  OverlayWidgetInstance,
  SceneVersion,
  StoredColumn,
} from "./scene-host";
import type { WidgetCatalog } from "./widget-catalog";
import { selectedThemeId } from "./widget-theme";

export class SceneRowReader {
  private readonly bundleUrlWarned = new Set<string>();

  constructor(
    private readonly catalog: WidgetCatalog,
    private readonly logger: Logger
  ) {}

  /** One version of a row, or null when the row is of a kind this build does not know. */
  async stateOf(s: scene.Scene, version: SceneVersion): Promise<OverlaySceneState | null> {
    const kind = compositionKindOf(s.kind);
    if (kind === null) {
      this.logger.warn("scene row has a kind this build does not know; not loaded", { sceneId: s.id, kind: s.kind });
      return null;
    }
    // A scene with no draft reads as its own draft.
    const draft = version === "draft" && s.hasDraft;
    const widgetsJson = draft ? s.draftWidgetsJson : s.widgetsJson;
    const layoutJson = draft ? s.draftLayoutJson : s.layoutJson;
    const behaviorsJson = draft ? s.draftBehaviorsJson : s.behaviorsJson;
    const widgets = this.readInstances(widgetsJson, s.id);
    const layout = readLayout(layoutJson);
    const behaviors = this.readBehaviors(behaviorsJson, s.id);
    const columns: StoredColumn[] = [];
    if (!widgets.readable) {
      columns.push("widgets");
    }
    if (!layout.readable) {
      columns.push("layout");
    }
    if (!behaviors.readable) {
      columns.push("behaviors");
    }
    const state: OverlaySceneState = {
      sceneId: s.id,
      name: s.name,
      kind,
      layout: layout.layout,
      instances: await this.catalog.resolve(widgets.instances, s.id),
      behaviors: behaviors.behaviors,
      inputs: this.parseInputs(s.inputsJson, s.id),
      hasDraft: s.hasDraft,
    };
    if (widgets.unread.length > 0 || columns.length > 0) {
      state.unread = { placements: widgets.unread, columns };
    }
    return state;
  }

  /** Stored behaviors; `{}` (said once in the log) when the text is not a JSON object. */
  private readBehaviors(
    behaviorsJson: string,
    sceneId: string
  ): { behaviors: SceneDocument["behaviors"]; readable: boolean } {
    const parsed = parseJson(behaviorsJson || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.logger.warn("scene behaviors are not a JSON object; loading none", { sceneId });
      return { behaviors: {}, readable: false };
    }
    return { behaviors: parsed as SceneDocument["behaviors"], readable: true };
  }

  /** Stored inputs; none (said in the log) when the text is not a JSON array. */
  private parseInputs(inputsJson: string, sceneId: string): NonNullable<SceneDocument["inputs"]> {
    const parsed = parseJson(inputsJson || "[]");
    if (!Array.isArray(parsed)) {
      this.logger.warn("scene inputs are not a JSON array; loading none", { sceneId });
      return [];
    }
    return parsed as NonNullable<SceneDocument["inputs"]>;
  }

  /** Placements given as stored (an editor's unsaved ones, a preview's), parsed and resolved like a row's. */
  async placements(sceneId: string, entries: unknown[]): Promise<OverlayWidgetInstance[]> {
    const instances: OverlayWidgetInstance[] = [];
    for (const entry of entries) {
      const instance = this.normalizeInstance(entry, sceneId);
      if (instance) {
        instances.push(instance);
      }
    }
    return this.catalog.resolve(instances, sceneId);
  }

  /**
   * The placements stored in `widgetsJson` that parse, the entries that do
   * not (as stored), and whether the text was a JSON array at all.
   */
  private readInstances(
    widgetsJson: string,
    sceneId: string
  ): { instances: OverlayWidgetInstance[]; unread: unknown[]; readable: boolean } {
    let raw: unknown;
    try {
      raw = JSON.parse(widgetsJson || "[]");
    } catch {
      this.logger.warn("scene widgetsJson is not valid JSON; rendering empty scene", { sceneId });
      return { instances: [], unread: [], readable: false };
    }
    if (!Array.isArray(raw)) {
      this.logger.warn("scene widgetsJson is not a JSON array; rendering empty scene", { sceneId });
      return { instances: [], unread: [], readable: false };
    }
    const instances: OverlayWidgetInstance[] = [];
    const unread: unknown[] = [];
    for (const entry of raw) {
      const instance = this.normalizeInstance(entry, sceneId);
      if (instance) {
        instances.push(instance);
      } else {
        unread.push(entry);
      }
    }
    if (unread.length > 0) {
      this.logger.warn("scene placements could not be read; not shown, kept as stored", {
        sceneId,
        count: unread.length,
      });
    }
    return { instances, unread, readable: true };
  }

  private normalizeInstance(raw: unknown, sceneId: string): OverlayWidgetInstance | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const w = raw as Record<string, unknown>;
    const id = typeof w.id === "string" ? w.id : "";
    const canonicalId = storedWidgetId(w);
    if (!id || !canonicalId) {
      return null;
    }
    const parsed = parseWidgetCanonicalId(canonicalId);
    if (!parsed) {
      return null;
    }

    // Strip version segments from the module key so scene placements remain
    // stable across module updates. A versioned key like "spotify:1.0.0:abc1234"
    // normalises to "spotify"; a simple key like "woofx3" is unchanged.
    const moduleId = stableModuleKey(parsed.moduleKey);
    const stableCanonicalId = `${moduleId}:widget:${parsed.manifestId}`;
    if (moduleId !== parsed.moduleKey) {
      this.logger.warn(
        "normalizeInstance: stripping version from moduleKey — update the UI to store the stable projection key",
        {
          id,
          stored: canonicalId,
          normalized: stableCanonicalId,
        }
      );
    }

    if (typeof w.bundleUrl === "string" && w.bundleUrl && !this.bundleUrlWarned.has(stableCanonicalId)) {
      this.bundleUrlWarned.add(stableCanonicalId);
      this.logger.warn("scene widget carries deprecated bundleUrl; ignored in favor of frameUrl", {
        widgetCanonicalId: stableCanonicalId,
      });
    }

    // The placement's fields read as every stored entry is (`placementOfStored`).
    const placement = placementOfStored(w, "");
    const settings = placement.settings;
    return {
      id,
      widgetCanonicalId: stableCanonicalId,
      moduleId: moduleId,
      manifestId: parsed.manifestId,
      position: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
      settings,
      visible: placement.visible,
      stored: w,
      // Placements carry none; `WidgetCatalog.resolve` takes it from the widget
      // definition.
      hostsSurface: "",
      // Versioned by `framing` when the config is built.
      frameUrl: frameDocumentUrl(moduleId, parsed.manifestId, selectedThemeId(settings), UNAVAILABLE_VERSION),
      // Assumed until the catalog says otherwise; `WidgetCatalog.resolve` is what
      // decides, since parsing alone cannot know what exists.
      resolved: true,
    };
  }
}

/**
 * The kind a row names, or null for one this build does not know. Empty is
 * a scene: a db proxy that predates kinds stores only scenes.
 */
export function compositionKindOf(kind: string | undefined): CompositionKind | null {
  if (kind === undefined || kind === "" || kind === "scene") {
    return "scene";
  }
  return kind === "alert" ? "alert" : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readLayout(layoutJson: string): { layout: OverlaySceneLayout; readable: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(layoutJson || "{}");
  } catch {
    return { layout: {}, readable: false };
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? { layout: parsed as OverlaySceneLayout, readable: true }
    : { layout: {}, readable: false };
}
