import type { HttpDeps } from "../http";
import { readSessionCookie, serializeSessionCookie } from "../scene/session-cookie";
import { SESSION_TOKEN_TTL_SECONDS } from "../scene/session-token";

/**
 * `POST /scene/{sceneId}/session/refresh` — the client's pre-emptive
 * ~50s refresh loop. Re-signs a fresh session JWT for the same
 * (sceneId, applicationId) claims as long as the current cookie is
 * still valid and its sceneId claim matches the URL — does not
 * re-verify the original opaque overlay token (see session-token.ts's
 * header comment for why). A failed refresh returns 401 so the client
 * shows its "unable to refresh" overlay per the diagram and keeps
 * retrying.
 */
export async function handleSessionRefreshRoute(req: Request, sceneId: string, deps: HttpDeps): Promise<Response> {
  const cookie = readSessionCookie(req);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  if (!claims || claims.sceneId !== sceneId) {
    return new Response(JSON.stringify({ error: "invalid_session" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const fresh = await deps.sessionTokens.mint(claims);
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": serializeSessionCookie(fresh, SESSION_TOKEN_TTL_SECONDS),
    },
  });
}
