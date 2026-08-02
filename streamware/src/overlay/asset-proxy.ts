import type { SharedLogger } from "@woofx3/common/logging";
import type { ModuleVersionResolver } from "./module-version-resolver";

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

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Proxies module/builtin asset requests to barkloader's repository-backed
 * asset route. Applies the full traversal pipeline (design 5.2.9) to all
 * untrusted path components before constructing the upstream URL.
 *
 * Module widget/asset files are stored version-scoped
 * (`modules/{moduleKey}/{versionDir}/...` — see barkloader's
 * `module_install.rs` `version_dir`) so an upgrade never overwrites a
 * previous version's bytes. The public-facing URL a widget/browser holds
 * never embeds that version directory (it can't — the widget's own HTML
 * references sibling files by plain relative path), so this proxy
 * resolves the module's *current* version directory via the shared
 * `ModuleVersionResolver` (also used by `FrameAssembler`, for the
 * server-side entry-HTML fetch) and injects it before forwarding to
 * barkloader.
 */
export class WidgetAssetProxy {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly barkloaderUrl: string,
    private readonly logger: SharedLogger,
    private readonly versions: ModuleVersionResolver | null = null,
    fetchFn?: typeof fetch
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  /**
   * Proxy a module widget asset request to barkloader's
   * `/assets/modules/{moduleKey}/{versionDir}/widgets/{manifestId}/{tail}`.
   * Sanitizes moduleKey, manifestId, and tail individually; returns 404
   * if any component fails the pipeline or the module's current version
   * can't be resolved.
   */
  async proxyModuleWidgetAsset(moduleKey: string, manifestId: string, tail: string): Promise<Response> {
    const cleanModule = sanitizeAssetPath(moduleKey);
    const cleanManifest = sanitizeAssetPath(manifestId);
    const cleanTail = sanitizeAssetPath(tail);
    if (!cleanModule || !cleanManifest || cleanTail === null) {
      return new Response(null, { status: 404 });
    }
    const versionDir = await this.versions?.resolve(cleanModule);
    if (!versionDir) {
      return new Response(null, { status: 404 });
    }
    return this.proxyToBarkloader(
      `modules/${encodeURIComponent(cleanModule)}/${encodeURIComponent(versionDir)}/widgets/${encodeURIComponent(cleanManifest)}/${encodePathSegments(cleanTail)}`
    );
  }

  /**
   * Proxy a generic module asset request (manifest `assets[]`, not
   * widgets) to barkloader's
   * `/assets/modules/{moduleKey}/{versionDir}/assets/{tail}`.
   */
  async proxyModuleAsset(moduleKey: string, tail: string): Promise<Response> {
    const cleanModule = sanitizeAssetPath(moduleKey);
    const cleanTail = sanitizeAssetPath(tail);
    if (!cleanModule || cleanTail === null) {
      return new Response(null, { status: 404 });
    }
    const versionDir = await this.versions?.resolve(cleanModule);
    if (!versionDir) {
      return new Response(null, { status: 404 });
    }
    return this.proxyToBarkloader(
      `modules/${encodeURIComponent(cleanModule)}/${encodeURIComponent(versionDir)}/assets/${encodePathSegments(cleanTail)}`
    );
  }

  /**
   * Proxy a builtin widget asset request to barkloader's
   * `/assets/builtin/widgets/{manifestId}/{tail}` — builtin widget files
   * are seeded into the same repository storage as module assets (see
   * barkloader's `seed-builtin-widgets` CLI), so this is servable the
   * same way as `proxyModuleWidgetAsset`, just without a module key.
   */
  async proxyBuiltinWidgetAsset(manifestId: string, tail: string): Promise<Response> {
    const cleanManifest = sanitizeAssetPath(manifestId);
    const cleanTail = sanitizeAssetPath(tail);
    if (!cleanManifest || cleanTail === null) {
      return new Response(null, { status: 404 });
    }
    return this.proxyToBarkloader(
      `builtin/widgets/${encodeURIComponent(cleanManifest)}/${encodePathSegments(cleanTail)}`
    );
  }

  /**
   * Fetch an already-sanitized, already-encoded repository key from
   * barkloader's `/assets/{key}` route. Forwards the response body and
   * Content-Type verbatim; returns 502 on fetch errors.
   */
  private async proxyToBarkloader(key: string): Promise<Response> {
    const base = this.barkloaderUrl.replace(/\/+$/, "");
    const url = `${base}/assets/${key}`;

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
