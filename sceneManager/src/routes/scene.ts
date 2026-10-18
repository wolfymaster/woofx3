import type { HttpDeps } from "../http";
import { nowSeconds, SESSION_TOKEN_TTL_SECONDS } from "../scene/session-token";
import { serializeSessionCookie } from "../scene/session-cookie";
import { BODY_LIMITS, invalidSession, jsonError, jsonOk, readJsonBody, requireSceneSession } from "./http-kit";
import type { SceneVersion } from "../scene/scene-host";
import { renderSceneShell } from "../scene/shell";
import { configOfSnapshot } from "../../contract/scene-config";

/** Which version of the scene a page shows: `?view=draft` for the editor's preview. */
export function viewOf(url: URL): SceneVersion {
  return url.searchParams.get("view") === "draft" ? "draft" : "published";
}

const NOT_FOUND_HTML = "<!doctype html><html><head></head><body></body></html>";

/**
 * `GET /scene/{sceneId}?token=abc123` — verify the opaque overlay
 * token, resolve the scene, mint a short-lived session JWT, and
 * render the HTML shell. Uniform, no-detail-leaked failure: an
 * invalid/revoked/mismatched token gets the same blank document a
 * genuinely unknown scene id would (no oracle — same invariant
 * `OverlayHost`/`OverlayTokenResolver` already enforce for token
 * resolution itself).
 */
export async function handleSceneRoute(req: Request, url: URL, sceneId: string, deps: HttpDeps): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  const state = await deps.host.loadScene(token);
  if (!state || state.sceneId !== sceneId) {
    return new Response(NOT_FOUND_HTML, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // The page starts from the scene's sequenced document, so it can apply
  // every change after this one as ops (see scene-documents.ts). The
  // editor's preview asks for the draft.
  const snapshot = await deps.sceneDocuments.overlaySnapshot(state.sceneId, viewOf(url));
  const scene = snapshot
    ? configOfSnapshot(snapshot)
    : deps.mediaProxy.sceneConfig((await deps.host.buildConfig(token)).scene).scene;
  const sessionToken = await deps.sessionTokens.mint({ sceneId: state.sceneId, authAt: nowSeconds() });

  return new Response(renderSceneShell({ scene, document: snapshot }), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": serializeSessionCookie(state.sceneId, sessionToken, SESSION_TOKEN_TTL_SECONDS),
    },
  });
}

/**
 * `GET /scene/{sceneId}/config` — the scene config the shell renders into the
 * page, for an open overlay applying a save without reloading. Authorized by
 * the session cookie the shell set, so only a page already showing this scene
 * can read it.
 */
export async function handleSceneConfigRoute(req: Request, sceneId: string, deps: HttpDeps): Promise<Response> {
  if ((await requireSceneSession(req, sceneId, deps.sessionTokens)) === null) {
    return invalidSession();
  }
  // With its document, so an overlay that missed ops resyncs from here.
  const snapshot = await deps.sceneDocuments.overlaySnapshot(sceneId, viewOf(new URL(req.url)));
  if (!snapshot) {
    return jsonError(404, "not_found");
  }
  return jsonOk({ scene: configOfSnapshot(snapshot), document: snapshot });
}

/**
 * `POST /scene/{sceneId}/draft-config` with `{ widgets: [...] }` — the scene
 * config with the editor's unsaved placements in place of the saved ones (see
 * `OverlayHost.buildDraftConfig`), for an overlay previewing a draft.
 * Authorized like `/config`.
 *
 * External media in the placements is pointed at the media proxy, for the
 * placements whose frames need it, only when the URL is already in the
 * scene's document (`SceneDocuments.editedMediaUrls`). This endpoint answers
 * anyone holding an overlay token, which every browser source showing the
 * overlay has, so signing whatever URL the body names would make it a general
 * signing service for the media proxy. The editor puts a value it picks into
 * the document through its own authenticated socket, and the page asks again
 * when that op arrives. `mediaUrls` maps, per placement id, each URL
 * signed to its proxy URL; the editor also posts settings to the page as they
 * are typed, with external media as entered, and the page points them at the
 * proxy with it.
 */
export async function handleSceneDraftConfigRoute(req: Request, sceneId: string, deps: HttpDeps): Promise<Response> {
  if ((await requireSceneSession(req, sceneId, deps.sessionTokens)) === null) {
    return invalidSession();
  }
  const body = await readJsonBody(req, BODY_LIMITS.placements);
  if (!body.ok) {
    return body.response;
  }
  const widgets = (body.value as { widgets?: unknown } | null)?.widgets;
  if (!Array.isArray(widgets)) {
    return jsonError(400, "invalid_body");
  }
  const config = await deps.host.buildDraftConfig(sceneId, widgets);
  const scene = (config as { scene: unknown }).scene;
  if (scene === null) {
    return jsonError(404, "not_found");
  }
  const edited = await deps.sceneDocuments.editedMediaUrls(sceneId);
  const view = deps.mediaProxy.sceneConfig(scene, (url) => edited.has(url));
  return jsonOk({ ...config, scene: view.scene, mediaUrls: view.mediaUrls });
}
