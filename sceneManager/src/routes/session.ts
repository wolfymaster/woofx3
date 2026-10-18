import type { HttpDeps } from "../http";
import { serializeSessionCookie } from "../scene/session-cookie";
import { invalidSession, jsonOk, requireSceneSession } from "./http-kit";
import { SESSION_TOKEN_TTL_SECONDS } from "../scene/session-token";

/**
 * `POST /scene/{sceneId}/session/refresh` — the client's pre-emptive
 * ~50s refresh loop. Re-signs a fresh session JWT for the same sceneId
 * claim as long as the current cookie is still valid and its sceneId
 * claim matches the URL — does not
 * re-verify the original opaque overlay token (see session-token.ts's
 * header comment for why). A failed refresh returns 401 so the client
 * shows its "unable to refresh" overlay per the diagram and keeps
 * retrying.
 */
export async function handleSessionRefreshRoute(req: Request, sceneId: string, deps: HttpDeps): Promise<Response> {
  const claims = await requireSceneSession(req, sceneId, deps.sessionTokens);
  if (claims === null) {
    return invalidSession();
  }
  const fresh = await deps.sessionTokens.mint(claims);
  return jsonOk({ status: "ok" }, { "Set-Cookie": serializeSessionCookie(sceneId, fresh, SESSION_TOKEN_TTL_SECONDS) });
}
