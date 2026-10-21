// A repair's backups in the db proxy's `scene_backups` table, and the stored
// text it backs up, read from the scene's row as stored.

import { SceneBackup } from "@woofx3/db/scene.pb";
import type { DbClient } from "../db";
import type { SceneBackupEntry, SceneBackupStore, StoredColumnsText } from "./held-scene";

export function dbSceneBackupStore(db: Pick<DbClient, "getScene" | "createSceneBackups">): SceneBackupStore {
  return {
    async storedColumns(sceneId: string): Promise<StoredColumnsText | null> {
      const response = await db.getScene({ id: sceneId });
      const row = response.scene;
      if (!row) {
        return null;
      }
      return {
        published: { widgets: row.widgetsJson, layout: row.layoutJson, behaviors: row.behaviorsJson },
        draft: { widgets: row.draftWidgetsJson, layout: row.draftLayoutJson, behaviors: row.draftBehaviorsJson },
      };
    },
    async store(sceneId: string, backups: SceneBackupEntry[]): Promise<void> {
      await db.createSceneBackups({
        sceneId,
        backups: backups.map(({ version, column, reason, content }) => ({
          ...SceneBackup.initialize(),
          version,
          column,
          reason,
          content,
        })),
      });
    },
  };
}
