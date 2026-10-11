// A scene row held in memory, read and written the way the db proxy and
// OverlayHost do, for driving the real scene documents in tests.

import type { SceneLoader, ScenePersister, SceneWrite } from "../../src/scene/scene-documents";
import type { EditableScene, OverlaySceneState, OverlayWidgetInstance, SceneVersion } from "../../src/scene/scene-host";

export interface SceneRow {
  id: string;
  name: string;
  widgetsJson: string;
  layoutJson: string;
  draftWidgetsJson: string | null;
  draftLayoutJson: string | null;
  editorStateJson: string | null;
}

export function sceneRow(id: string, placements: Array<Record<string, unknown>>, layout = {}): SceneRow {
  return {
    id,
    name: "Main",
    widgetsJson: JSON.stringify(placements),
    layoutJson: JSON.stringify(layout),
    draftWidgetsJson: null,
    draftLayoutJson: null,
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

/** A stored placement parsed and framed as OverlayHost does, or null for one it drops. */
export function instanceOf(stored: Record<string, unknown>, frameVersion = ""): OverlayWidgetInstance | null {
  const id = typeof stored.id === "string" ? stored.id : "";
  const widget = typeof stored.widgetCanonicalId === "string" ? stored.widgetCanonicalId : "";
  const [moduleId, kind, manifestId] = widget.split(":");
  if (!id || kind !== "widget" || !moduleId || !manifestId) {
    return null;
  }
  const position = (stored.position ?? {}) as Record<string, unknown>;
  const size = (stored.size ?? {}) as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    id,
    widgetCanonicalId: widget,
    moduleId,
    manifestId,
    position: { x: num(position.x), y: num(position.y), width: num(size.width), height: num(size.height) },
    settings:
      typeof stored.settings === "object" && stored.settings !== null
        ? (stored.settings as Record<string, unknown>)
        : {},
    visible: stored.visible !== false,
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
    write.clearDraft === true ||
    (write.draftWidgetsJson !== undefined && write.draftLayoutJson !== undefined);
  if (write.widgetsJson !== undefined) {
    row.widgetsJson = write.widgetsJson;
  }
  if (write.layoutJson !== undefined) {
    row.layoutJson = write.layoutJson;
  }
  if (write.clearDraft === true) {
    row.draftWidgetsJson = null;
    row.draftLayoutJson = null;
  } else if (write.draftWidgetsJson !== undefined && write.draftLayoutJson !== undefined) {
    row.draftWidgetsJson = write.draftWidgetsJson;
    row.draftLayoutJson = write.draftLayoutJson;
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
