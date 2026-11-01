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

/** `Set-Cookie` value for a freshly minted session JWT; see `serializeCookie`. */
export function serializeSessionCookie(req: Request, sceneId: string, token: string, maxAgeSeconds: number): string {
  return serializeCookie(req, sessionCookieName(sceneId), token, maxAgeSeconds);
}

/**
 * A session cookie as every page of the scene manager's is set: HttpOnly (the
 * client learns its state from the shell-inlined config, never this cookie)
 * and site-wide.
 *
 * Over HTTPS it is `SameSite=None; Secure; Partitioned`, because the desktop
 * app frames these pages from its own origin, which is never same-site with
 * an engine, and `SameSite=Strict` would keep the cookie off every request the
 * frame makes. `Partitioned` keys the cookie to the top-level site that framed
 * the page, so another site framing or calling sceneManager never sends it,
 * which is the protection `Strict` gave.
 *
 * `Secure` is refused on plain HTTP, so there it stays `SameSite=Strict`, and
 * only same-site pages can use the session.
 */
export function serializeCookie(req: Request, name: string, token: string, maxAgeSeconds: number): string {
  const crossSite = requestIsHttps(req) ? ["SameSite=None", "Secure", "Partitioned"] : ["SameSite=Strict"];
  return [`${name}=${token}`, "Path=/", "HttpOnly", ...crossSite, `Max-Age=${maxAgeSeconds}`].join("; ");
}

/**
 * Whether the browser reached this request over HTTPS. An edge terminating TLS
 * says so in `X-Forwarded-Proto`, and the first entry is the client's hop. A
 * client forging the header only misconfigures its own cookie.
 */
function requestIsHttps(req: Request): boolean {
  const forwarded = req.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded ? forwarded === "https" : new URL(req.url).protocol === "https:";
}

export function readSessionCookie(req: Request, sceneId: string): string | null {
  return readCookie(req, sessionCookieName(sceneId));
}

/** The value of the cookie `wanted`, or null when the request carries none. */
export function readCookie(req: Request, wanted: string): string | null {
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
