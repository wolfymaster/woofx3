import type { HttpDeps } from "../http";
import { SESSION_TOKEN_TTL_SECONDS } from "../scene/session-token";
import { readSessionCookie, serializeSessionCookie } from "../scene/session-cookie";
import { renderSceneShell } from "../scene/shell";

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

  const config = await deps.host.buildConfig(token);
  const sessionToken = await deps.sessionTokens.mint({ sceneId: state.sceneId });

  return new Response(renderSceneShell({ scene: (config as { scene: unknown }).scene }), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": serializeSessionCookie(sessionToken, SESSION_TOKEN_TTL_SECONDS),
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
  const cookie = readSessionCookie(req);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  if (!claims || claims.sceneId !== sceneId) {
    return Response.json({ error: "invalid_session" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const config = await deps.host.buildConfigById(sceneId);
  if ((config as { scene: unknown }).scene === null) {
    return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(config, { headers: { "Cache-Control": "no-store" } });
}
