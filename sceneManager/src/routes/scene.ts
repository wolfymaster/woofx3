import type { HttpDeps } from "../http";
import { SESSION_TOKEN_TTL_SECONDS } from "../scene/session-token";
import { readSessionCookie, serializeSessionCookie } from "../scene/session-cookie";
import type { SceneVersion } from "../scene/scene-host";
import { renderSceneShell } from "../scene/shell";
import { configOfSnapshot } from "../../public/scene-manager/scene-document";

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
  const sessionToken = await deps.sessionTokens.mint({ sceneId: state.sceneId });

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
  const cookie = readSessionCookie(req, sceneId);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  if (!claims || claims.sceneId !== sceneId) {
    return Response.json({ error: "invalid_session" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  // With its document, so an overlay that missed ops resyncs from here.
  const snapshot = await deps.sceneDocuments.overlaySnapshot(sceneId, viewOf(new URL(req.url)));
  if (!snapshot) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    { scene: configOfSnapshot(snapshot), document: snapshot },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** Largest draft-config request body; a scene's placements are a few kilobytes. */
export const MAX_DRAFT_BODY_BYTES = 1024 * 1024;

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
  const cookie = readSessionCookie(req, sceneId);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  if (!claims || claims.sceneId !== sceneId) {
    return Response.json({ error: "invalid_session" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const declaredLength = Number(req.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_DRAFT_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  const text = await req.text();
  if (text.length > MAX_DRAFT_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  let widgets: unknown;
  try {
    widgets = (JSON.parse(text) as { widgets?: unknown }).widgets;
  } catch {
    widgets = undefined;
  }
  if (!Array.isArray(widgets)) {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const config = await deps.host.buildDraftConfig(sceneId, widgets);
  const scene = (config as { scene: unknown }).scene;
  if (scene === null) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const edited = await deps.sceneDocuments.editedMediaUrls(sceneId);
  const view = deps.mediaProxy.sceneConfig(scene, (url) => edited.has(url));
  return Response.json(
    { ...config, scene: view.scene, mediaUrls: view.mediaUrls },
    { headers: { "Cache-Control": "no-store" } }
  );
}
