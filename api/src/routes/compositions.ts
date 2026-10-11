import type { AlertComposition } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import { routeModule } from "./context";
import { compositionKindOf, dbSceneToAlertComposition, dbSceneToSnapshot } from "./helpers";

/**
 * Alert compositions: rows of the scenes table with `kind: "alert"`, kept
 * apart from the scene routes so neither surface ever returns or changes
 * the other's rows. Documents are edited through the editor socket
 * (`getSceneEditorSession` takes an alert's id); these routes create, list,
 * rename, set inputs and delete.
 */
export const compositionsRoutes = routeModule({
  async listAlertCompositions(): Promise<{ compositions: AlertComposition[] }> {
    const response = await this.db.listScenes({
      page: 0,
      pageSize: 0,
      sortBy: "name",
      sortDesc: false,
      kind: "alert",
    });
    return { compositions: response.scenes.map((s) => dbSceneToAlertComposition(s)) };
  },

  async getAlertComposition(id: string): Promise<AlertComposition | null> {
    const found = await this.db.findComposition(id);
    return found && compositionKindOf(found.kind) === "alert" ? dbSceneToAlertComposition(found) : null;
  },

  async createAlertComposition(data: {
    name: string;
    description?: string;
    widgetsJson?: string;
    layoutJson?: string;
    behaviorsJson?: string;
    inputsJson?: string;
    correlationKey?: string;
  }): Promise<{ id: string }> {
    this.logger.info("Creating alert composition", { name: data.name });
    const created = await this.db.createScene({
      name: data.name,
      description: data.description ?? "",
      widgetsJson: data.widgetsJson ?? "[]",
      layoutJson: data.layoutJson ?? "{}",
      behaviorsJson: data.behaviorsJson ?? "{}",
      inputsJson: data.inputsJson ?? "[]",
      kind: "alert",
      createdByType: "USER",
      createdByRef: "",
    });
    this.logger.info("Created alert composition", { id: created.id, name: created.name });
    void this.emitSceneWebhook({
      type: EngineEventType.SCENE_CREATED,
      correlationKey: data.correlationKey,
      scene: dbSceneToSnapshot(created),
    });
    return { id: created.id };
  },

  async updateAlertComposition(
    id: string,
    data: { name?: string; description?: string; inputsJson?: string; correlationKey?: string }
  ): Promise<{ success: boolean }> {
    const existing = await this.db.findComposition(id);
    if (!existing || compositionKindOf(existing.kind) !== "alert") {
      return { success: false };
    }
    // Empty means "leave unchanged" to db-proxy, so an input list is never
    // empty text here: no inputs is `[]`.
    const updated = await this.db.tryUpdateScene({
      id,
      name: data.name ?? "",
      description: data.description ?? "",
      inputsJson: data.inputsJson ?? "",
      widgetsJson: "",
      layoutJson: "",
      behaviorsJson: "",
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
    void this.emitSceneWebhook({
      type: EngineEventType.SCENE_UPDATED,
      correlationKey: data.correlationKey,
      scene: dbSceneToSnapshot(updated),
    });
    return { success: true };
  },

  async deleteAlertComposition(id: string, correlationKey?: string): Promise<{ success: boolean }> {
    const existing = await this.db.findComposition(id);
    if (!existing || compositionKindOf(existing.kind) !== "alert") {
      return { success: false };
    }
    await this.db.deleteScene({ id });
    void this.emitSceneWebhook({
      type: EngineEventType.SCENE_DELETED,
      correlationKey,
      sceneId: id,
      kind: "alert",
    });
    return { success: true };
  },
});
