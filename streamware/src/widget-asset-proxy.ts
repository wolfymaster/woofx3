import type { SharedLogger } from "@woofx3/common/logging";

/**
 * Traversal pipeline (design 5.2.9) applied to every untrusted path
 * before serving assets. Returns the cleaned path, or null on any
 * rejection.
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

  // Normalize separators and collapse redundant slashes.
  let normalized = decoded.replace(/\\/g, "/").replace(/\/\/+/g, "/");
  // Strip leading slash so paths are always relative.
  normalized = normalized.replace(/^\/+/, "");

  // Reject any `.` or `..` segment.
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return null;
    }
  }

  return normalized;
}

/**
 * Proxies widget asset requests to barkloader's asset route.
 * Applies the full traversal pipeline (design 5.2.9) to all
 * untrusted path components before constructing the upstream URL.
 */
export class WidgetAssetProxy {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly barkloaderUrl: string,
    private readonly logger: SharedLogger,
    fetchFn?: typeof fetch
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  /**
   * Proxy a widget asset request to barkloader's
   * `/assets/modules/{moduleKey}/widgets/{manifestId}/{tail}`.
   *
   * Sanitizes moduleKey, manifestId, and tail individually.
   * Returns 404 if any component fails the pipeline.
   * Forwards the response body and Content-Type verbatim.
   * Returns 502 on fetch errors.
   */
  async proxy(moduleKey: string, manifestId: string, tail: string): Promise<Response> {
    const cleanModule = sanitizeAssetPath(moduleKey);
    if (!cleanModule) {
      return new Response(null, { status: 404 });
    }
    const cleanManifest = sanitizeAssetPath(manifestId);
    if (!cleanManifest) {
      return new Response(null, { status: 404 });
    }
    const cleanTail = sanitizeAssetPath(tail);
    if (cleanTail === null) {
      return new Response(null, { status: 404 });
    }

    const base = this.barkloaderUrl.replace(/\/+$/, "");
    const tailPath = cleanTail
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const url =
      `${base}/assets/modules/` +
      `${encodeURIComponent(cleanModule)}/widgets/` +
      `${encodeURIComponent(cleanManifest)}/` +
      tailPath;

    let upstream: Response;
    try {
      upstream = await this.fetchFn(url);
    } catch (err) {
      this.logger.warn("widget-asset-proxy: barkloader fetch failed", {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(null, { status: 502 });
    }

    const contentType = upstream.headers.get("Content-Type");
    const headers: Record<string, string> = {};
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }
}
