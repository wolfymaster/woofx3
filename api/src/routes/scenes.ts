import type { Scene, SceneEditorSession, SceneRepairResult } from "@woofx3/api";
import { EngineEventType, type SceneSnapshot, type WidgetBehaviorKinds } from "@woofx3/api/webhooks";
import {
  SCENE_EDITOR_TOKEN_SUBJECT,
  SCENE_REPAIR_SUBJECT,
  type SceneEditorTokenReply,
  type SceneEditorTokenRequest,
  type SceneRepairReply,
  type SceneRepairRequest,
} from "@woofx3/common/cloudevents/Scene/editor";
import { routeModule } from "./context";
import { compositionKindOf, dbSceneToSnapshot, dbSceneToWire } from "./helpers";

/** Short: sceneManager answers from memory, and an editor is waiting to open. */
const SCENE_EDITOR_TOKEN_TIMEOUT_MS = 3_000;
/** Longer: a repair loads the scene, stores its backups and writes it back before it answers. */
const SCENE_REPAIR_TIMEOUT_MS = 15_000;

/** Orders by UTF-16 code unit, so the order never depends on the host's locale. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

export const scenesRoutes = routeModule({
  async getScenes(query?: { page?: number; pageSize?: number }): Promise<{
    scenes: Scene[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 10;
    const response = await this.db.listScenes({
      page,
      pageSize,
      sortBy: "updated_at",
      sortDesc: true,
      kind: "scene",
    });
    return {
      scenes: response.scenes.map((s) => dbSceneToWire(s)),
      total: response.totalCount,
      page: response.page || page,
      pageSize: response.pageSize || pageSize,
    };
  },

  /** Null for an alert composition as for an unknown id: this surface is scenes only. */
  async getScene(id: string): Promise<Scene | null> {
    const found = await this.db.findComposition(id);
    return found && compositionKindOf(found.kind) === "scene" ? dbSceneToWire(found) : null;
  },

  /**
   * Asks db-proxy for every row (`page: 0, pageSize: 0`, as
   * `listAlertCompositions` does): `ListScenes` answers with the whole kind
   * in one response and applies neither paging nor sorting, so the order by
   * name is made here. A response holding fewer rows than its total would
   * hand the caller a partial list as if it were whole, so it is refused.
   */
  async listSceneSnapshots(): Promise<{ scenes: SceneSnapshot[] }> {
    const response = await this.db.listScenes({
      page: 0,
      pageSize: 0,
      sortBy: "name",
      sortDesc: false,
      kind: "scene",
    });
    if (response.scenes.length < response.totalCount) {
      throw new Error(
        `listSceneSnapshots: db-proxy answered ${response.scenes.length} of ${response.totalCount} scenes`
      );
    }
    const scenes = response.scenes.map((s) => dbSceneToSnapshot(s));
    scenes.sort((a, b) => compareCodeUnits(a.name, b.name));
    return { scenes };
  },

  /** Null for an alert composition as for an unknown id: this surface is scenes only. */
  async getSceneSnapshot(id: string): Promise<SceneSnapshot | null> {
    const found = await this.db.findComposition(id);
    return found && compositionKindOf(found.kind) === "scene" ? dbSceneToSnapshot(found) : null;
  },

  async getAvailableWidgets(): Promise<{
    widgets: Array<{
      id: string;
      manifestId: string;
      name: string;
      description: string;
      directory: string;
      alertTypes: string[];
      settingsSchema: string;
      surfaces: string[];
      hostsSurface: string;
      taxonomy: string[];
      behaviorKinds: WidgetBehaviorKinds;
      createdByType: string;
      createdByRef: string;
    }>;
  }> {
    const response = await this.db.listWidgets({ createdByType: "", createdByRef: "" });
    return {
      widgets: (response.widgets ?? []).map((w) => ({
        id: w.id,
        manifestId: w.manifestId,
        name: w.name,
        description: w.description,
        directory: w.directory,
        alertTypes: w.alertTypes ?? [],
        settingsSchema: w.settingsSchema ?? "[]",
        surfaces: w.surfaces ?? [],
        hostsSurface: w.hostsSurface ?? "",
        taxonomy: w.taxonomy ?? [],
        behaviorKinds: {
          transitions: (w.behaviorKinds?.transitions ?? []).map(({ id, label }) => ({ id, label })),
          effects: (w.behaviorKinds?.effects ?? []).map(({ id, label }) => ({ id, label })),
        },
        createdByType: w.createdByType ?? "",
        createdByRef: w.createdByRef ?? "",
      })),
    };
  },

  async createScene(data: {
    name: string;
    description?: string;
    widgetsJson?: string;
    layoutJson?: string;
    correlationKey?: string;
  }): Promise<{ id: string }> {
    this.logger.info("Creating scene", { name: data.name });
    const response = await this.db.createScene({
      name: data.name,
      description: data.description ?? "",
      widgetsJson: data.widgetsJson ?? "[]",
      layoutJson: data.layoutJson ?? "{}",
      createdByType: "USER",
      createdByRef: "",
      kind: "scene",
      behaviorsJson: "",
      inputsJson: "",
    });
    const created = response;
    this.logger.info("Created scene", { id: created.id, name: created.name });

    void this.emitSceneWebhook({
      type: EngineEventType.SCENE_CREATED,
      correlationKey: data.correlationKey,
      scene: dbSceneToSnapshot(created),
    });
    return { id: created.id ?? "" };
  },

  async updateScene(
    id: string,
    data: {
      name?: string;
      description?: string;
      widgetsJson?: string;
      layoutJson?: string;
      correlationKey?: string;
    }
  ): Promise<{ success: boolean }> {
    this.logger.info("Updating scene", { id });
    // Alerts are updated through `updateAlertComposition`, which never
    // writes their documents from outside the editor.
    const existing = await this.db.findComposition(id);
    if (!existing || compositionKindOf(existing.kind) !== "scene") {
      return { success: false };
    }
    // Patch semantics — db-proxy's UpdateSceneRequest uses empty
    // strings for "leave alone", so map `undefined` → "" (no change)
    // and a real value → the value. Callers that genuinely want to
    // clear a field set it to empty string; today that's only
    // `description`. `widgetsJson` / `layoutJson` of `""` would be
    // invalid JSON, so empty here always means "leave unchanged".
    const updated = await this.db.tryUpdateScene({
      id,
      name: data.name ?? "",
      description: data.description ?? "",
      widgetsJson: data.widgetsJson ?? "",
      layoutJson: data.layoutJson ?? "",
      // Drafts and editor sync state are written by sceneManager's editor;
      // this path names neither. A widgets or layout write here makes the
      // db clear the editor state, which describes the replaced documents.
      behaviorsJson: "",
      inputsJson: "",
      draftWidgetsJson: "",
      draftLayoutJson: "",
      draftBehaviorsJson: "",
      clearDraft: false,
      editorStateJson: "",
      clearEditorState: false,
    });
    if (!updated) {
      return { success: false };
    }
    this.logger.info("Updated scene", { id, name: updated.name });

    void this.emitSceneWebhook({
      type: EngineEventType.SCENE_UPDATED,
      correlationKey: data.correlationKey,
      scene: dbSceneToSnapshot(updated),
    });
    return { success: true };
  },

  async deleteScene(id: string, correlationKey?: string): Promise<{ success: boolean }> {
    this.logger.info("Deleting scene", { id });
    // An alert is deleted through `deleteAlertComposition`: the scene routes
    // never change the other kind's rows.
    const existing = await this.db.findComposition(id);
    if (!existing || compositionKindOf(existing.kind) !== "scene") {
      return { success: false };
    }
    const success = await this.db.tryDeleteScene({ id });
    if (success) {
      void this.emitSceneWebhook({
        type: EngineEventType.SCENE_DELETED,
        correlationKey,
        sceneId: id,
        kind: "scene",
      });
    }
    return { success };
  },

  async getSceneEditorSession(sceneId: string): Promise<SceneEditorSession | null> {
    if (!this.nats || typeof sceneId !== "string" || sceneId === "") {
      return null;
    }
    try {
      const request: SceneEditorTokenRequest = { sceneId };
      const reply = await this.nats.request(
        SCENE_EDITOR_TOKEN_SUBJECT,
        new TextEncoder().encode(JSON.stringify(request)),
        { timeout: SCENE_EDITOR_TOKEN_TIMEOUT_MS }
      );
      const answer = JSON.parse(new TextDecoder().decode(reply.data)) as SceneEditorTokenReply;
      if (!answer.ok) {
        this.logger.warn("getSceneEditorSession: refused", { sceneId, reason: answer.reason });
        return null;
      }
      return { token: answer.token, path: answer.path, expiresInSeconds: answer.expiresInSeconds };
    } catch (err) {
      this.logger.warn("getSceneEditorSession: the scene manager did not answer", {
        sceneId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  async repairScene(sceneId: string): Promise<SceneRepairResult> {
    if (typeof sceneId !== "string" || sceneId === "") {
      return { ok: false, reason: "not_found", detail: "sceneId required" };
    }
    if (!this.nats) {
      return { ok: false, reason: "unavailable", detail: "the scene manager cannot be reached" };
    }
    let answer: SceneRepairReply;
    try {
      const request: SceneRepairRequest = { sceneId };
      const reply = await this.nats.request(SCENE_REPAIR_SUBJECT, new TextEncoder().encode(JSON.stringify(request)), {
        timeout: SCENE_REPAIR_TIMEOUT_MS,
      });
      answer = JSON.parse(new TextDecoder().decode(reply.data)) as SceneRepairReply;
    } catch (err) {
      this.logger.warn("repairScene: the scene manager did not answer", {
        sceneId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, reason: "unavailable", detail: "the scene manager did not answer" };
    }
    if (answer.ok) {
      this.logger.info("Repaired scene", { sceneId, backups: answer.backups });
    } else {
      this.logger.warn("repairScene: refused", { sceneId, reason: answer.reason, detail: answer.detail });
    }
    return answer;
  },
});
