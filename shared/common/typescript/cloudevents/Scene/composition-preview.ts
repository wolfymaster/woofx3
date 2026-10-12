/**
 * Request/reply between the api and sceneManager for opening the composition
 * preview: the api asks for a short-lived token that lets one dashboard
 * page open sceneManager's preview page (`COMPOSITION_PREVIEW_PATH`), which
 * plays whatever composition the page that frames it posts. The request has
 * no body; the token names no composition.
 */
export const COMPOSITION_PREVIEW_TOKEN_SUBJECT = "engine.scene.composition-preview-token";

/** The preview page, relative to sceneManager's public URL; opened with `?token=`. */
export const COMPOSITION_PREVIEW_PATH = "/preview/composition";

export type CompositionPreviewTokenReply =
  | {
      ok: true;
      /** Presented once, as `?token=` when the page loads. */
      token: string;
      expiresInSeconds: number;
      /** The page, relative to sceneManager's public URL. */
      path: string;
    }
  | { ok: false; reason: string };
