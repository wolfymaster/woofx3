export const SESSION_COOKIE_NAME = "sm_session";

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
export function serializeSessionCookie(token: string, maxAgeSeconds: number): string {
  return [`${SESSION_COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`].join(
    "; "
  );
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("Cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      return rest.join("=") || null;
    }
  }
  return null;
}
