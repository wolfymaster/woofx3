import { createHmac } from "node:crypto";
import { externalMediaUrls, rewriteExternalMedia } from "../../public/scene-manager/media-url";
import type { SceneDocument, SceneSnapshot } from "../../public/scene-manager/scene-document";

/**
 * Where the engine relays external media: sceneManager forwards it to
 * barkloader's media proxy (`routes/media.rs`), which fetches the signed URL.
 * Kept relative so it resolves against whatever loads it: a widget frame's
 * `<base>` (barkloader's public origin, which the frame's CSP lists) or the
 * scene page's own origin, which serves this path.
 */
export const MEDIA_PROXY_PATH = "/assets/media/";

/**
 * Separates media proxy signatures from every other use of the engine
 * secret, so a token minted for one purpose never verifies as another. Must
 * match `KEY_LABEL` in barkloader/app/src/services/media_proxy.rs.
 */
const KEY_LABEL = "woofx3 media proxy v1";

/** Longest upstream URL signed. Must match `MAX_UPSTREAM_URL_BYTES` in media_proxy.rs. */
export const MAX_UPSTREAM_URL_BYTES = 2048;

/**
 * Turns external media URLs in placement settings into signed media proxy
 * URLs, for everything sceneManager hands an overlay.
 *
 * A token is `{base64url(url)}.{hex HMAC-SHA256}`: deterministic and without
 * an expiry. An overlay stays open for a whole stream and hands its settings
 * to widgets long after loading them, so a token that expired would break
 * media mid-stream; and the same URL always gets the same proxy URL, so the
 * browser caches it. What a token grants is narrow: barkloader fetching that
 * one URL, under the proxy's limits. Rotating the engine secret revokes all.
 */
export class MediaProxy {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret === "") {
      throw new Error("MediaProxy: the signing secret must not be empty");
    }
    this.key = createHmac("sha256", secret).update(KEY_LABEL).digest();
  }

  /** The proxy URL for `upstream`, or undefined when it is too long to sign. */
  urlFor(upstream: string): string | undefined {
    if (Buffer.byteLength(upstream, "utf8") > MAX_UPSTREAM_URL_BYTES) {
      return undefined;
    }
    const payload = Buffer.from(upstream, "utf8").toString("base64url");
    const signature = createHmac("sha256", this.key).update(payload).digest("hex");
    return `${MEDIA_PROXY_PATH}${payload}.${signature}`;
  }

  /** `settings` with every external media value pointed at the proxy. */
  settings<T>(settings: T): T {
    return rewriteExternalMedia(settings, (url) => this.urlFor(url));
  }

  /** The proxy URL of every external media URL in `settings`, by upstream URL. */
  urlsIn(settings: unknown): Record<string, string> {
    const urls: Record<string, string> = {};
    for (const upstream of externalMediaUrls(settings)) {
      const proxied = this.urlFor(upstream);
      if (proxied !== undefined) {
        urls[upstream] = proxied;
      }
    }
    return urls;
  }

  /** A scene document as overlays see it. */
  document(doc: SceneDocument): SceneDocument {
    let widgets: SceneDocument["widgets"] | null = null;
    for (const [id, placement] of Object.entries(doc.widgets)) {
      const settings = this.settings(placement.settings);
      if (settings !== placement.settings) {
        widgets ??= { ...doc.widgets };
        widgets[id] = { ...placement, settings };
      }
    }
    return widgets ? { ...doc, widgets } : doc;
  }

  snapshot(snapshot: SceneSnapshot): SceneSnapshot {
    const doc = this.document(snapshot.doc);
    return doc === snapshot.doc ? snapshot : { ...snapshot, doc };
  }

  /** A page scene config (`{ widgets: [{ settings }] }`) as overlays see it. */
  sceneConfig<T>(scene: T): T {
    if (typeof scene !== "object" || scene === null) {
      return scene;
    }
    const widgets = (scene as { widgets?: unknown }).widgets;
    if (!Array.isArray(widgets)) {
      return scene;
    }
    return {
      ...scene,
      widgets: widgets.map((widget: unknown) =>
        typeof widget === "object" && widget !== null && "settings" in widget
          ? { ...widget, settings: this.settings((widget as { settings: unknown }).settings) }
          : widget
      ),
    };
  }
}
