/**
 * Traversal pipeline applied to every untrusted path before serving a
 * local asset. Returns the cleaned path, or null on any rejection.
 * Ported from streamware/src/overlay/asset-proxy.ts's
 * `sanitizeAssetPath` — the only piece of that file sceneManager still
 * needs.
 *
 * Pipeline order (binding):
 *  1. decodeURIComponent — if this throws, return null
 *  2. Normalize: replace backslashes with `/`, collapse `//+` to `/`,
 *     strip leading `/`
 *  3. Reject any `.` or `..` segment
 *  4. Return the cleaned path
 */
export function sanitizeAssetPath(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }

  let normalized = decoded.replace(/\\/g, "/").replace(/\/\/+/g, "/");
  normalized = normalized.replace(/^\/+/, "");

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return null;
    }
  }

  return normalized;
}
