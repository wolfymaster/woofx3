// A scene row held in memory, read and written the way the db proxy and
// OverlayHost do, for driving the real scene documents in tests.

import type { SceneLoader, ScenePersister, SceneWrite } from "../../src/scene/scene-documents";
import type { EditableScene, OverlaySceneState, OverlayWidgetInstance, SceneVersion } from "../../src/scene/scene-host";
import { parseWidgetCanonicalId, placementOfStored, stableCanonicalId, storedWidgetId } from "@woofx3/scene/model";

export interface SceneRow {
  id: string;
  name: string;
  kind: "scene" | "alert";
  widgetsJson: string;
  layoutJson: string;
  behaviorsJson: string;
  inputsJson: string;
  draftWidgetsJson: string | null;
  draftLayoutJson: string | null;
  draftBehaviorsJson: string | null;
  editorStateJson: string | null;
}

export function sceneRow(id: string, placements: Array<Record<string, unknown>>, layout = {}): SceneRow {
  return {
    id,
    name: "Main",
    kind: "scene",
    widgetsJson: JSON.stringify(placements),
    layoutJson: JSON.stringify(layout),
    behaviorsJson: "{}",
    inputsJson: "[]",
    draftWidgetsJson: null,
    draftLayoutJson: null,
    draftBehaviorsJson: null,
    editorStateJson: null,
  };
}

/** A placement as the editor stores one. */
export function storedPlacement(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:text",
    name: "",
    position: { x: 0, y: 0 },
    size: { width: 100, height: 50 },
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    locked: false,
    visible: true,
    settings: { text: "hi" },
    ...overrides,
  };
}

/** The frame URL the fake framing gives a widget; `version` stands for the installed module's version. */
export function frameUrlOf(widget: string, version = ""): string {
  return version === "" ? `/frames/${widget}` : `/frames/${widget}?v=${version}`;
}

/**
 * A stored placement parsed and framed as OverlayHost does, or null for one it
 * drops: the same codec (`placementOfStored`) and id rules, so the documents
 * built from this store are the ones the real loader builds.
 */
export function instanceOf(stored: Record<string, unknown>, frameVersion = ""): OverlayWidgetInstance | null {
  const id = typeof stored.id === "string" ? stored.id : "";
  const widget = stableCanonicalId(storedWidgetId(stored));
  const parsed = widget === null ? null : parseWidgetCanonicalId(widget);
  if (!id || widget === null || parsed === null) {
    return null;
  }
  const placement = placementOfStored(stored, "");
  return {
    id,
    widgetCanonicalId: widget,
    moduleId: parsed.moduleKey,
    manifestId: parsed.manifestId,
    position: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
    settings: placement.settings,
    visible: placement.visible,
    stored,
    hostsSurface: "",
    frameUrl: frameUrlOf(widget, frameVersion),
    linkedResources: {},
    resolved: true,
  };
}

function stateOf(row: SceneRow, version: SceneVersion, frameVersion: string): OverlaySceneState {
  const draft = version === "draft" && row.draftWidgetsJson !== null;
  const placements = JSON.parse(draft ? row.draftWidgetsJson! : row.widgetsJson) as Array<Record<string, unknown>>;
  return {
    sceneId: row.id,
    name: row.name,
    kind: row.kind,
    behaviors: JSON.parse(draft ? (row.draftBehaviorsJson ?? "{}") : row.behaviorsJson),
    inputs: JSON.parse(row.inputsJson),
    layout: JSON.parse(draft ? row.draftLayoutJson! : row.layoutJson),
    instances: placements
      .map((placement) => instanceOf(placement, frameVersion))
      .filter((instance): instance is OverlayWidgetInstance => instance !== null),
    hasDraft: row.draftWidgetsJson !== null,
  };
}

/** Apply an `UpdateScene` the way the db proxy does. */
function applyWrite(row: SceneRow, write: SceneWrite): void {
  const changesDocuments =
    write.widgetsJson !== undefined ||
    write.layoutJson !== undefined ||
    write.behaviorsJson !== undefined ||
    write.clearDraft === true ||
    (write.draftWidgetsJson !== undefined && write.draftLayoutJson !== undefined);
  if (write.widgetsJson !== undefined) {
    row.widgetsJson = write.widgetsJson;
  }
  if (write.layoutJson !== undefined) {
    row.layoutJson = write.layoutJson;
  }
  if (write.behaviorsJson !== undefined) {
    row.behaviorsJson = write.behaviorsJson;
  }
  if (write.clearDraft === true) {
    row.draftWidgetsJson = null;
    row.draftLayoutJson = null;
    row.draftBehaviorsJson = null;
  } else if (write.draftWidgetsJson !== undefined && write.draftLayoutJson !== undefined) {
    row.draftWidgetsJson = write.draftWidgetsJson;
    row.draftLayoutJson = write.draftLayoutJson;
    row.draftBehaviorsJson = write.draftBehaviorsJson ?? "{}";
  }
  if (write.editorStateJson !== undefined && write.editorStateJson !== "") {
    row.editorStateJson = write.editorStateJson;
  } else if (changesDocuments) {
    row.editorStateJson = null;
  }
}

/** Reads and writes go through these, so a test can delay or fail them. */
export interface StoreHooks {
  beforeRead?: () => Promise<void>;
  beforeWrite?: (write: SceneWrite) => Promise<void>;
  beforeFrame?: () => Promise<void>;
}

/** A loader and persister over rows held in memory. */
export class FakeSceneStore implements SceneLoader, ScenePersister {
  readonly rows = new Map<string, SceneRow>();
  readonly writes: SceneWrite[] = [];
  frameCalls = 0;
  /** Changes every frame URL, as installing a new version of the widgets' module does. */
  frameVersion = "";

  constructor(
    rows: SceneRow[],
    private readonly hooks: StoreHooks = {}
  ) {
    for (const row of rows) {
      this.rows.set(row.id, row);
    }
  }

  async loadEditableScene(sceneId: string): Promise<EditableScene | null> {
    await this.hooks.beforeRead?.();
    const row = this.rows.get(sceneId);
    if (!row) {
      return null;
    }
    return {
      published: stateOf(row, "published", this.frameVersion),
      draft: stateOf(row, "draft", this.frameVersion),
      editorStateJson: row.editorStateJson,
    };
  }

  async loadFramedSceneById(sceneId: string, version: SceneVersion = "published"): Promise<OverlaySceneState | null> {
    await this.hooks.beforeRead?.();
    const row = this.rows.get(sceneId);
    return row ? stateOf(row, version, this.frameVersion) : null;
  }

  async framePlacements(_sceneId: string, entries: unknown[]): Promise<OverlayWidgetInstance[]> {
    this.frameCalls++;
    await this.hooks.beforeFrame?.();
    return (entries as Array<Record<string, unknown>>)
      .map((entry) => instanceOf(entry, this.frameVersion))
      .filter((instance): instance is OverlayWidgetInstance => instance !== null);
  }

  async updateScene(write: SceneWrite): Promise<unknown> {
    await this.hooks.beforeWrite?.(write);
    const row = this.rows.get(write.id);
    if (!row) {
      throw new Error("scene not found");
    }
    this.writes.push(write);
    applyWrite(row, write);
    return {};
  }
}
