/**
 * Request/reply between the api and sceneManager for opening the scene
 * editor: the api asks for a short-lived token that lets one dashboard
 * session edit one scene over sceneManager's editor socket.
 */
export const SCENE_EDITOR_TOKEN_SUBJECT = "engine.scene.editor-token";

export interface SceneEditorTokenRequest {
  sceneId: string;
}

export type SceneEditorTokenReply =
  | {
      ok: true;
      /** Presented once, when the editor socket opens. */
      token: string;
      expiresInSeconds: number;
      /** The socket, relative to sceneManager's public URL. */
      path: string;
    }
  | { ok: false; reason: string };

/** The editor socket for a scene, relative to sceneManager's public URL. */
export function sceneEditorPath(sceneId: string): string {
  return `/scene/${encodeURIComponent(sceneId)}/edit`;
}

/**
 * Request/reply between the api and sceneManager for repairing a scene whose
 * stored data sceneManager cannot read (`repairScene`): what cannot be read
 * is set aside in the db's `scene_backups`, then the readable rest is written
 * back, which makes the scene editable again.
 */
export const SCENE_REPAIR_SUBJECT = "engine.scene.repair";

export interface SceneRepairRequest {
  sceneId: string;
}

export type SceneRepairReply =
  | {
      ok: true;
      /** How many backups were stored; 0 when nothing needed repairing. */
      backups: number;
    }
  | { ok: false; reason: "not_found" | "unavailable" | "failed"; detail: string };
