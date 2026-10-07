import type { HttpDeps } from "../http";
import { isMediaKey } from "../scene/media-keys";
import { sceneMediaKeys } from "../scene/media-manifest";
import { readSessionCookie } from "../scene/session-cookie";

/**
 * Largest file the scene page caches. Must match `MAX_MEDIA_BYTES` in
 * public/scene-manager/media-cache.ts. A bigger one is refused here, and the
 * widget loads it from its own URL instead, uncached.
 */
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function hasSession(req: Request, sceneId: string, deps: HttpDeps): Promise<boolean> {
  const cookie = readSessionCookie(req, sceneId);
  const claims = cookie ? await deps.sessionTokens.verify(cookie) : null;
  return claims !== null && claims.sceneId === sceneId;
}

/**
 * `GET /scene/{sceneId}/media-manifest` — the media keys the scene can be
 * asked to play, as `{ keys }`, for the page to fetch as it loads (see
 * scene/media-manifest.ts). A manifest that cannot be built is empty: the
 * page then fetches each file the first time a widget asks for it.
 */
export async function handleSceneMediaManifestRoute(req: Request, sceneId: string, deps: HttpDeps): Promise<Response> {
  if (!(await hasSession(req, sceneId, deps))) {
    return jsonResponse(401, { error: "invalid_session" });
  }
  const state = await deps.host.loadSceneById(sceneId);
  if (!state) {
    return jsonResponse(404, { error: "not_found" });
  }
  let workflowSteps: string[] = [];
  try {
    workflowSteps = await deps.workflows.listEnabledWorkflowSteps();
  } catch (err) {
    deps.ctx.logger.warn("workflows unavailable; the media manifest covers the scene's placements only", {
      sceneId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return jsonResponse(200, { keys: sceneMediaKeys(state.instances, workflowSteps) });
}

/**
 * `GET /scene/{sceneId}/media/{key}` — one engine asset's bytes, for the
 * scene page's media cache.
 *
 * A widget frame is sandboxed into an opaque origin, and the browser never
 * uses its HTTP cache for an opaque-origin document's requests, so a widget
 * that loads its media itself downloads it again on every alert. The page is
 * not sandboxed: it fetches the bytes here and hands them to the widget.
 *
 * Unlike `/assets/`, this follows a storage redirect instead of passing it
 * on. The page reads the bytes, which a cross-origin response would only
 * allow if the bucket carried a CORS policy, and a fresh bucket has none.
 */
export async function handleSceneMediaRoute(
  req: Request,
  sceneId: string,
  encodedKey: string,
  deps: HttpDeps,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  if (!(await hasSession(req, sceneId, deps))) {
    return new Response(null, { status: 401 });
  }
  const key = mediaKeyOfPath(encodedKey);
  if (key === null) {
    return new Response(null, { status: 404 });
  }
  const upstreamUrl =
    `${deps.ctx.runtimeConfig.barkloaderUrl.replace(/\/+$/, "")}/assets/` +
    key.split("/").map(encodeURIComponent).join("/");
  let upstream: Response;
  try {
    upstream = await fetchFn(upstreamUrl, { method: "GET", redirect: "follow" });
  } catch (err) {
    deps.ctx.logger.warn("media request failed", {
      sceneId,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(null, { status: 502 });
  }
  if (!upstream.ok || upstream.body === null) {
    await upstream.body?.cancel();
    return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  }
  const declaredLength = Number(upstream.headers.get("Content-Length") ?? "");
  if (declaredLength > MAX_MEDIA_BYTES) {
    await upstream.body.cancel();
    return new Response(null, { status: 413 });
  }
  const headers = new Headers({ "Cache-Control": "private, no-cache" });
  const contentType = upstream.headers.get("Content-Type");
  if (contentType !== null) {
    headers.set("Content-Type", contentType);
  }
  if (Number.isFinite(declaredLength) && declaredLength > 0) {
    headers.set("Content-Length", String(declaredLength));
  }
  return new Response(upstream.body.pipeThrough(byteLimit(MAX_MEDIA_BYTES)), { status: 200, headers });
}

/** The repository key a media path's percent-encoded key names, or null when it names none. */
export function mediaKeyOfPath(encodedKey: string): string | null {
  let key: string;
  try {
    key = encodedKey
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
  return isMediaKey(key) ? key : null;
}

/** Errors the stream past `limit` bytes, for a response that declared no length. */
function byteLimit(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) {
        controller.error(new Error(`media exceeds ${limit} bytes`));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
