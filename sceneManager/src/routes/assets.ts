import { join, normalize } from "node:path";

/**
 * `GET /assets/*` — everything sceneManager itself serves statically:
 * the vendored data-star bundle, the client scene-manager script, the
 * widget-host-shim, and built-in widget files. Traversal-safe: the
 * resolved path must stay within `publicDir`.
 *
 * `Cache-Control` is deliberately short/revalidatable here (unlike
 * Barkloader's public asset route, which is immutable for
 * version-scoped module keys) — everything under this route can
 * change on a sceneManager redeploy without a version segment in the
 * URL to bust on.
 */
export async function handleStaticAssetRoute(req: Request, url: URL, publicDir: string): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(null, { status: 404 });
  }
  const root = normalize(publicDir);
  const rel = url.pathname.slice("/assets/".length);
  const safe = normalize(join(root, rel));
  if (safe !== root && !safe.startsWith(root + "/")) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(safe);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(file, { headers: { "Cache-Control": "public, max-age=60, must-revalidate" } });
}
