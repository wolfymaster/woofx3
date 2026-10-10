import { routeModule } from "./context";
import type { Scene, SceneEditorSession } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import { dbSceneToSnapshot, dbSceneToWire } from "./helpers";
import {
  SCENE_EDITOR_TOKEN_SUBJECT,
  type SceneEditorTokenReply,
  type SceneEditorTokenRequest,
} from "@woofx3/common/cloudevents/Scene/editor";

/** Short: sceneManager answers from memory, and an editor is waiting to open. */
const SCENE_EDITOR_TOKEN_TIMEOUT_MS = 3_000;

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
    });
    return {
      scenes: response.scenes.map((s) => dbSceneToWire(s)),
      total: response.totalCount,
      page: response.page || page,
      pageSize: response.pageSize || pageSize,
    };
  },

  async getScene(id: string): Promise<Scene | null> {
    const found = await this.db.findScene({ id });
    return found ? dbSceneToWire(found) : null;
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
      draftWidgetsJson: "",
      draftLayoutJson: "",
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
    const success = await this.db.tryDeleteScene({ id });
    if (success) {
      void this.emitSceneWebhook({
        type: EngineEventType.SCENE_DELETED,
        correlationKey,
        sceneId: id,
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
});
