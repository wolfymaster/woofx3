const SESSION_COOKIE_PREFIX = "sm_session_";

/**
 * One cookie per scene. A browser commonly runs several scenes at once (OBS
 * shares one cookie store across every browser source), and a single shared
 * cookie would hold only the scene that refreshed last, so every other scene
 * would be refused until it refreshed back. The scene is carried in the name
 * rather than a `Path` because a proxy may mount sceneManager under a prefix,
 * and a cookie path is matched against the URL the browser sees.
 */
export function sessionCookieName(sceneId: string): string {
  return `${SESSION_COOKIE_PREFIX}${sceneId}`;
}

/**
 * `Set-Cookie` value for a freshly minted session JWT. HttpOnly (no
 * client-side script access needed — the client learns its own state
 * from the shell-inlined scene config, never by reading this cookie)
 * and `SameSite=Strict`: every request that needs it (widget iframe
 * `src`, refresh, events, status, completion acks) originates from
 * the scene page itself, which is always same-site with sceneManager
 * — nothing here ever crosses an eTLD+1 boundary, sandboxed widget
 * iframes included (their `src` still points at sceneManager's own
 * origin).
 */
export function serializeSessionCookie(sceneId: string, token: string, maxAgeSeconds: number): string {
  return [
    `${sessionCookieName(sceneId)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function readSessionCookie(req: Request, sceneId: string): string | null {
  const wanted = sessionCookieName(sceneId);
  const header = req.headers.get("Cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === wanted) {
      return rest.join("=") || null;
    }
  }
  return null;
}
