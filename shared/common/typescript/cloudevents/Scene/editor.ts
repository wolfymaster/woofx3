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
