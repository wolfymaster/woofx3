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
 * Browsers also accept `Secure` from a loopback host over plain HTTP, which is
 * how the desktop app's bundled engine is reached, so loopback gets the same
 * attributes. Anywhere else on plain HTTP `Secure` is refused, so there it
 * stays `SameSite=Strict`, and only same-site pages can use the session.
 */
export function serializeCookie(req: Request, name: string, token: string, maxAgeSeconds: number): string {
  const crossSite = acceptsSecureCookie(req) ? ["SameSite=None", "Secure", "Partitioned"] : ["SameSite=Strict"];
  return [`${name}=${token}`, "Path=/", "HttpOnly", ...crossSite, `Max-Age=${maxAgeSeconds}`].join("; ");
}

/**
 * Whether the browser will keep a `Secure` cookie from this response: it
 * reached the request over HTTPS, or directly at a loopback host. An edge
 * terminating TLS says so in `X-Forwarded-Proto`, and the first entry is the
 * client's hop; behind such an edge the request URL's host is the edge's
 * upstream, not what the browser saw, so the loopback rule does not apply. A
 * client forging the header only misconfigures its own cookie.
 */
function acceptsSecureCookie(req: Request): boolean {
  const forwarded = req.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) {
    return forwarded === "https";
  }
  const url = new URL(req.url);
  return url.protocol === "https:" || isLoopbackHost(url.hostname);
}

/** The hosts browsers treat as potentially trustworthy over plain HTTP. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
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
