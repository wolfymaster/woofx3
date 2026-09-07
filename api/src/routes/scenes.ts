import { routeModule } from "./context";
import type { Scene } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import { dbSceneToSnapshot, dbSceneToWire } from "./helpers";

export const scenesRoutes = routeModule({
  async getScenes(query?: { accountId?: string; page?: number; pageSize?: number }): Promise<{
    scenes: Scene[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const applicationId = query?.accountId || (await this.ensureApplicationId());
    const page = query?.page || 1;
    const pageSize = query?.pageSize || 10;
    const response = await this.db.listScenes({
      applicationId,
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
      surface: string;
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
        surface: w.surface ?? "scene",
        createdByType: w.createdByType ?? "",
        createdByRef: w.createdByRef ?? "",
      })),
    };
  },

  async createScene(data: {
    name: string;
    accountId: string;
    description?: string;
    widgetsJson?: string;
    layoutJson?: string;
    correlationKey?: string;
  }): Promise<{ id: string }> {
    const applicationId = data.accountId || (await this.ensureApplicationId());
    this.logger.info("Creating scene", { name: data.name, applicationId });
    const response = await this.db.createScene({
      applicationId,
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
      applicationId,
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
    });
    if (!updated) {
      return { success: false };
    }
    this.logger.info("Updated scene", { id, name: updated.name });

    void this.emitSceneWebhook({
      type: EngineEventType.SCENE_UPDATED,
      applicationId: updated.applicationId ?? "",
      correlationKey: data.correlationKey,
      scene: dbSceneToSnapshot(updated),
    });
    return { success: true };
  },

  async deleteScene(id: string, correlationKey?: string): Promise<{ success: boolean }> {
    this.logger.info("Deleting scene", { id });
    // Fetch first so we know the applicationId for the webhook —
    // the delete RPC just returns ResponseStatus.
    const existing = await this.db.findScene({ id });
    const applicationId = existing?.applicationId ?? "";

    const success = await this.db.tryDeleteScene({ id });
    if (success) {
      void this.emitSceneWebhook({
        type: EngineEventType.SCENE_DELETED,
        applicationId,
        correlationKey,
        sceneId: id,
      });
    }
    return { success };
  }
});
