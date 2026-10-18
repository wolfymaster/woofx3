import type { HttpDeps } from "../http";
import { serializeSessionCookie } from "../scene/session-cookie";
import { nowSeconds, SESSION_REAUTH_SECONDS, SESSION_TOKEN_TTL_SECONDS } from "../scene/session-token";
import { BODY_LIMITS, invalidSession, jsonOk, readJsonBody, requireSceneSession } from "./http-kit";

/**
 * `POST /scene/{sceneId}/session/refresh` — the client's pre-emptive
 * ~50s refresh loop. Re-signs a fresh session JWT for the same scene as
 * long as the current cookie is still valid and names the scene in the URL.
 *
 * Once the overlay token was last verified `SESSION_REAUTH_SECONDS` ago, the
 * refresh must carry it (`{ token }`, the one in the page's URL) and it must
 * still open this scene; the session then counts from now. A refresh refused
 * either way is a 401, which the page answers by loading again, where a
 * revoked token gets the refusal any unknown one does.
 */
export async function handleSessionRefreshRoute(req: Request, sceneId: string, deps: HttpDeps): Promise<Response> {
  const session = await requireSceneSession(req, sceneId, deps.sessionTokens);
  if (session === null) {
    return invalidSession();
  }
  const now = nowSeconds();
  let authAt = session.authAt;
  if (now - authAt >= SESSION_REAUTH_SECONDS) {
    const token = await presentedToken(req);
    if (token === "" || (await deps.host.sceneIdOfToken(token)) !== sceneId) {
      return invalidSession();
    }
    authAt = now;
  }
  const fresh = await deps.sessionTokens.mint({ sceneId, authAt });
  return jsonOk({ status: "ok" }, { "Set-Cookie": serializeSessionCookie(sceneId, fresh, SESSION_TOKEN_TTL_SECONDS) });
}

/** The overlay token a refresh carries, or "" for one with none (or a body that is not `{ token }`). */
async function presentedToken(req: Request): Promise<string> {
  const body = await readJsonBody(req, BODY_LIMITS.refresh);
  if (!body.ok || typeof body.value !== "object" || body.value === null) {
    return "";
  }
  const token = (body.value as { token?: unknown }).token;
  return typeof token === "string" ? token : "";
}
