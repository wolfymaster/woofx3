import { createHmac } from "node:crypto";
import { externalMediaUrls, MEDIA_PROXY_PATH, rewriteExternalMedia } from "../../public/scene-manager/media-url";
import type {
  PlacementDocument,
  PlacementMeta,
  SceneDocument,
  SceneSnapshot,
} from "../../public/scene-manager/scene-document";

/**
 * Separates media proxy signatures from every other use of the engine
 * secret, so a token minted for one purpose never verifies as another. Must
 * match `KEY_LABEL` in barkloader/app/src/services/media_proxy.rs.
 */
const KEY_LABEL = "woofx3 media proxy v1";

/** Longest upstream URL signed. Must match `MAX_UPSTREAM_URL_BYTES` in media_proxy.rs. */
export const MAX_UPSTREAM_URL_BYTES = 2048;

/** The shortest time a proxy URL is good for once handed out. */
export const MEDIA_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/**
 * Expiries are rounded up to a multiple of this, so every proxy URL minted for
 * one upstream URL within a step is the same URL: the browser keeps its cached
 * copy, and two views of a document built moments apart agree.
 */
export const MEDIA_TOKEN_STEP_SECONDS = 24 * 60 * 60;

/**
 * Where barkloader serves a widget's resources under its public URL. Must
 * match `resource_base_url` in barkloader/app/src/routes/widgets.rs.
 */
const WIDGET_RESOURCE_PATH = "/assets/modules/";

/**
 * The media proxy's URL prefix for a widget whose resources are served from
 * `resourceBaseUrl`, or null when that is not barkloader's layout. Built from
 * the resource base rather than as a root-relative path, so a public URL with
 * a path prefix keeps it, and the result is on an origin the frame's policy
 * already lists.
 */
export function mediaProxyBaseOf(resourceBaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(resourceBaseUrl);
  } catch {
    return null;
  }
  const at = url.pathname.indexOf(WIDGET_RESOURCE_PATH);
  if (at < 0) {
    return null;
  }
  return `${url.origin}${url.pathname.slice(0, at)}${MEDIA_PROXY_PATH}`;
}

/** Whether an upstream URL may be signed; every one may when absent. */
export type SignableUrl = (upstream: string) => boolean;

/**
 * Turns external media URLs in placement settings into signed media proxy
 * URLs, for the widgets whose frames run under the theme policy. Which those
 * are is per placement: `PlacementMeta.mediaProxyBase` is set for them, and
 * other placements keep external URLs as entered, loading them directly.
 *
 * A token is `{base64url(url)}.{expiresAt}.{hex HMAC-SHA256}`, good until
 * `expiresAt` (unix seconds). An overlay stays open for a whole stream, and
 * often for days, so a token lives at least `MEDIA_TOKEN_LIFETIME_SECONDS`,
 * and the page fetches its scene again before the soonest expiry it holds,
 * which brings it fresh URLs (see `earliestMediaProxyExpiry`). What a token
 * grants is narrow: barkloader fetching that one URL, under the proxy's
 * limits, until it expires. Rotating the engine secret revokes all of them.
 */
export class MediaProxy {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly now: () => number = Date.now
  ) {
    if (secret === "") {
      throw new Error("MediaProxy: the signing secret must not be empty");
    }
    this.key = createHmac("sha256", secret).update(KEY_LABEL).digest();
  }

  /** When a token minted now expires, in unix seconds. */
  expiresAt(): number {
    const earliest = Math.floor(this.now() / 1000) + MEDIA_TOKEN_LIFETIME_SECONDS;
    return Math.ceil(earliest / MEDIA_TOKEN_STEP_SECONDS) * MEDIA_TOKEN_STEP_SECONDS;
  }

  /**
   * The proxy URL for `upstream` under `base`, or undefined when it is not
   * proxied: too long to sign, or already on the proxy's origin, which the
   * frame's policy allows as it is.
   */
  urlFor(upstream: string, base: string): string | undefined {
    if (Buffer.byteLength(upstream, "utf8") > MAX_UPSTREAM_URL_BYTES) {
      return undefined;
    }
    if (new URL(upstream).origin === new URL(base).origin) {
      return undefined;
    }
    const signed = `${Buffer.from(upstream, "utf8").toString("base64url")}.${this.expiresAt()}`;
    const signature = createHmac("sha256", this.key).update(signed).digest("hex");
    return `${base}${signed}.${signature}`;
  }

  /** `settings` with every signable external media value pointed at the proxy under `base`. */
  settings<T>(settings: T, base: string, signable?: SignableUrl): T {
    return rewriteExternalMedia(settings, (url) =>
      signable === undefined || signable(url) ? this.urlFor(url, base) : undefined
    );
  }

  /** The proxy URL of every signable external media URL in `settings`, by upstream URL. */
  urlsIn(settings: unknown, base: string, signable?: SignableUrl): Record<string, string> {
    const urls: Record<string, string> = {};
    for (const upstream of externalMediaUrls(settings)) {
      if (signable !== undefined && !signable(upstream)) {
        continue;
      }
      const proxied = this.urlFor(upstream, base);
      if (proxied !== undefined) {
        urls[upstream] = proxied;
      }
    }
    return urls;
  }

  /** Whether an overlay's view of the placement can differ from the placement as entered. */
  rewrites(placement: PlacementDocument | undefined, meta: PlacementMeta | undefined): boolean {
    return (
      placement !== undefined && meta?.mediaProxyBase !== undefined && externalMediaUrls(placement.settings).length > 0
    );
  }

  /** A placement as overlays see it. */
  placement(placement: PlacementDocument, meta: PlacementMeta | undefined): PlacementDocument {
    if (meta?.mediaProxyBase === undefined) {
      return placement;
    }
    const settings = this.settings(placement.settings, meta.mediaProxyBase);
    return settings === placement.settings ? placement : { ...placement, settings };
  }

  /** A scene document as overlays see it. */
  document(doc: SceneDocument, meta: Record<string, PlacementMeta>): SceneDocument {
    let widgets: SceneDocument["widgets"] | null = null;
    for (const [id, placement] of Object.entries(doc.widgets)) {
      const view = this.placement(placement, meta[id]);
      if (view !== placement) {
        widgets ??= { ...doc.widgets };
        widgets[id] = view;
      }
    }
    return widgets ? { ...doc, widgets } : doc;
  }

  snapshot(snapshot: SceneSnapshot): SceneSnapshot {
    const doc = this.document(snapshot.doc, snapshot.meta);
    return doc === snapshot.doc ? snapshot : { ...snapshot, doc };
  }

  /**
   * A page scene config (`{ widgets: [{ settings, mediaProxyBase }] }`) as
   * overlays see it: each placement with a `mediaProxyBase` gets its
   * signable external media pointed at the proxy.
   */
  sceneConfig<T>(scene: T, signable?: SignableUrl): T {
    if (typeof scene !== "object" || scene === null) {
      return scene;
    }
    const widgets = (scene as { widgets?: unknown }).widgets;
    if (!Array.isArray(widgets)) {
      return scene;
    }
    return {
      ...scene,
      widgets: widgets.map((widget: unknown) => {
        if (typeof widget !== "object" || widget === null) {
          return widget;
        }
        const { settings, mediaProxyBase } = widget as { settings?: unknown; mediaProxyBase?: unknown };
        if (typeof mediaProxyBase !== "string" || settings === undefined) {
          return widget;
        }
        return { ...widget, settings: this.settings(settings, mediaProxyBase, signable) };
      }),
    };
  }
}
