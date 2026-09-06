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
  const rel = builtinWidgetDiskPath(url.pathname.slice("/assets/".length));
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

/**
 * Built-in widget URLs keep streamware's `builtin/widgets/{manifestId}/`
 * shape (it is what `FrameAssembler` emits as the frame's <base href>,
 * so widget-relative refs like media_alert's `lottie.min.js` resolve
 * through it), but on disk they live under `widgets/builtin/{manifestId}/`
 * — the layout `FrameAssembler.loadBuiltinFrameInfo` reads from.
 * streamware translated between the two in its asset route; this is that
 * translation. Every other `/assets/` path maps to `publicDir` verbatim.
 */
function builtinWidgetDiskPath(rel: string): string {
  const parts = rel.split("/");
  if (parts[0] === "builtin" && parts[1] === "widgets" && parts.length >= 3) {
    return join("widgets", "builtin", ...parts.slice(2));
  }
  return rel;
}
