import type { Logger } from "@woofx3/common/runtime";
import {
  type WidgetBootPayload,
  type WidgetSurface,
  type WidgetTransitionState,
  isGenericTransitionType,
  widgetTransitionState,
} from "@woofx3/module-sdk";
import { ALERT_EVENT_TYPE, parseAlertDelivery } from "./alert-layout";
import { FONT_STYLESHEET_PATH } from "../fonts/google-font-cache";
import { frameVersion } from "./frame-catalog";
import { frameMediaProxyBase, type MediaProxy } from "./media-proxy";
import type { OverlayHost } from "./scene-host";
import {
  type FrameTheme,
  buildThemeStyle,
  hostTheme,
  injectThemeStylesheet,
  originOf,
  parseFrameTheme,
  selectedThemeId,
  themeContentSecurityPolicy,
} from "./widget-theme";

/**
 * Uniform blank document: served byte-for-byte identically for an
 * invalid session AND for a valid session with an unknown instance id,
 * so the frame route leaks nothing about which failure occurred.
 * Ported from streamware's `BLANK_FRAME_DOC` (design 5.2.11).
 */
export const BLANK_FRAME_DOC = "<!doctype html><html><head></head><body></body></html>";

/** Capabilities advertised in every boot payload. */
export const FRAME_CAPABILITIES = ["storage", "events", "status", "settings"] as const;

/** The widget host shim's file name under sceneManager's public directory. */
export const WIDGET_HOST_SHIM_FILE = "widget-host-shim.js";

/** Absolute shim src — sceneManager serves it at a fixed top-level
 *  path regardless of how deep the frame URL is, so no relative-path
 *  arithmetic is needed (streamware used a relative `../assets/...`
 *  path that depended on frame-URL depth; not worth the fragility
 *  here). */
export const SHIM_SRC = `/assets/${WIDGET_HOST_SHIM_FILE}`;

const FRAME_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export interface BarkloaderFrameInfo {
  entryHtml: string;
  resourceBaseUrl: string;
  /** `null` for a widget that declares no theme contract. */
  theme: FrameTheme | null;
  /** Ids of the widget's `font` settings. */
  fontSettings: string[];
}

/** The slice of Barkloader's HTTP surface the assembler depends on
 *  (injectable for tests). `themeId` is the theme the placement's settings
 *  select; barkloader resolves it, falling back to the contract defaults. */
export interface BarkloaderFrameClient {
  fetchWidgetFrame(moduleKey: string, manifestId: string, themeId?: string): Promise<BarkloaderFrameInfo | null>;
}

/**
 * How long barkloader has to answer a frame request, body included. A hung
 * barkloader then costs each frame lookup this long, and the lookup counts as
 * failed (the callers' catch), rather than holding up whatever waits on it.
 */
export const FRAME_FETCH_TIMEOUT_MS = 5000;

/** Real implementation — calls barkloader's `GET
 *  /widgets/{moduleKey}/{manifestId}/frame` endpoint. */
export class HttpBarkloaderFrameClient implements BarkloaderFrameClient {
  constructor(
    private readonly barkloaderUrl: string,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs: number = FRAME_FETCH_TIMEOUT_MS
  ) {}

  async fetchWidgetFrame(moduleKey: string, manifestId: string, themeId?: string): Promise<BarkloaderFrameInfo | null> {
    const query = themeId === undefined ? "" : `?theme=${encodeURIComponent(themeId)}`;
    const url =
      `${this.barkloaderUrl.replace(/\/+$/, "")}/widgets/` +
      `${encodeURIComponent(moduleKey)}/${encodeURIComponent(manifestId)}/frame${query}`;
    const response = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      // A non-OK response is not a transport error (loadFrameInfo's
      // catch never sees it) — log here or this is completely silent.
      // barkloader itself logs the underlying reason (missing widget,
      // unresolved module version, missing repository file, etc.);
      // this is the sceneManager-side half of that trail.
      this.logger.warn("barkloader widget frame request returned non-OK", {
        moduleKey,
        manifestId,
        url,
        status: response.status,
      });
      return null;
    }
    const body = (await response.json()) as {
      entryHtml?: unknown;
      resourceBaseUrl?: unknown;
      theme?: unknown;
      fontSettings?: unknown;
    };
    if (typeof body.entryHtml !== "string" || typeof body.resourceBaseUrl !== "string") {
      this.logger.warn("barkloader widget frame response missing entryHtml/resourceBaseUrl", {
        moduleKey,
        manifestId,
        url,
        keys: Object.keys(body ?? {}),
      });
      return null;
    }
    return {
      entryHtml: body.entryHtml,
      resourceBaseUrl: body.resourceBaseUrl,
      theme: parseFrameTheme(body.theme),
      fontSettings: parseFontSettings(body.fontSettings),
    };
  }
}

/** An older barkloader sends no font settings; the widget's fonts are then used by name only. */
function parseFontSettings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

/** What the shim needs to link a widget's fonts; absent for a widget without font settings. */
function frameFonts(frameInfo: BarkloaderFrameInfo): Pick<WidgetBootPayload, "fonts"> {
  return frameInfo.fontSettings.length === 0
    ? {}
    : { fonts: { settings: [...frameInfo.fontSettings], stylesheetUrl: FONT_STYLESHEET_PATH } };
}

export interface FrameAssemblerOptions {
  barkloader: BarkloaderFrameClient;
  generateNonce?: () => string;
  /** The instances a module links through its `resource_ref` settings (see
   *  module-state.ts `linkedResources`). None when absent. */
  linkedResources?: (moduleId: string) => Promise<Record<string, string>>;
  /** Points external media in a themeable widget's boot settings at the
   *  engine's media proxy. Settings pass through as they are when absent. */
  mediaProxy?: MediaProxy;
}

/**
 * The boot payload a cacheable frame document inlines: the widget's half.
 * The placement's half (`WidgetPlacementBoot`) arrives in the fragment.
 */
export type WidgetFrameBoot = Omit<WidgetBootPayload, "nonce" | "instanceId" | "settings" | "linkedResources">;

/** A frame document whose URL carries its current version never changes. */
const CACHED_FRAME_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface FrameScaffold {
  boot: WidgetBootPayload | WidgetFrameBoot;
  baseHref: string;
  /** Variables and asset slots of a themeable widget, set before any of
   *  the widget's own styles or scripts. */
  theme?: FrameTheme | null;
}

/** What a frame is assembled for: a scene placement, or one widget of an alert layout. */
interface FrameTarget {
  instanceId: string;
  moduleId: string;
  manifestId: string;
  widgetCanonicalId: string;
  settings: Record<string, unknown>;
  surface: WidgetSurface;
  /** The widget's own transition to play as the frame first paints. */
  transition?: WidgetTransitionState;
}

/**
 * Build the injected scaffold block in the NORMATIVE order: (1) inline
 * boot payload, (2) classic shim script tag, (3) <base> pointing at
 * the widget asset root. Ported unchanged from streamware's
 * frame-assembler.ts — the shim must stay a classic script (no async/
 * defer): existing widgets read `window.widgetHost` at IIFE time, and
 * the script src must precede <base> so it resolves against the frame
 * URL, not the asset root.
 */
export function buildFrameScaffold(scaffold: FrameScaffold): string {
  const bootJson = JSON.stringify(scaffold.boot).replace(/</g, "\\u003c");
  return (
    `<script>window.__WOOFX3_WIDGET_BOOT__ = ${bootJson};</script>` +
    `<script src="${SHIM_SRC}"></script>` +
    `<base href="${escapeHtmlAttribute(scaffold.baseHref)}">` +
    (scaffold.theme ? buildThemeStyle(scaffold.theme) : "")
  );
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Inject `scaffoldHtml` at the head-open position of an entry
 * document. Fallback rules (ported unchanged): no <head> -> synthesize
 * one directly after <html>; neither -> inject at the very front
 * (after a doctype when present). A leading BOM is preserved in place.
 */
export function injectFrameScaffold(entryHtml: string, scaffoldHtml: string): string {
  let bom = "";
  let html = entryHtml;
  if (html.charCodeAt(0) === 0xfeff) {
    bom = "﻿";
    html = html.slice(1);
  }

  const headOpen = /<head(?:\s[^>]*)?>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return bom + html.slice(0, at) + scaffoldHtml + html.slice(at);
  }

  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return bom + html.slice(0, at) + "<head>" + scaffoldHtml + "</head>" + html.slice(at);
  }

  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype[0].length;
    return bom + html.slice(0, at) + scaffoldHtml + html.slice(at);
  }

  return bom + scaffoldHtml + html;
}

function defaultNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Assembles widget frame documents. Simplified from streamware's
 * version: module widget entry HTML + resource base URL come from a
 * single Barkloader call (which now owns version resolution) instead
 * of a locally-duplicated `ModuleVersionResolver`.
 */
export class FrameAssembler {
  private readonly generateNonce: () => string;

  constructor(
    private readonly host: OverlayHost,
    private readonly logger: Logger,
    private readonly opts: FrameAssemblerOptions
  ) {
    this.generateNonce = opts.generateNonce ?? defaultNonce;
  }

  /** Uniform blank response — identical bytes for every refusal path. */
  blankResponse(): Response {
    return new Response(BLANK_FRAME_DOC, { status: 200, headers: { ...FRAME_HEADERS } });
  }

  /**
   * `GET /frames/{moduleId}/{manifestId}?theme=…&v=…`: a widget's frame
   * document, with nothing in it about a placement. The placement (nonce,
   * instance, settings, linked resources) arrives in the URL's fragment and
   * the shim merges it in, so the document is the same for every placement,
   * needs no session, and is cached by the browser while `v` is current.
   * A stale `v` still gets the current document, uncached.
   */
  async assembleDocument(
    moduleId: string,
    manifestId: string,
    themeParam: string | null,
    versionParam: string | null
  ): Promise<Response> {
    const themeId = themeParam?.trim() || undefined;
    const widgetCanonicalId = `${moduleId}:widget:${manifestId}`;
    const frameInfo = await this.loadFrameInfo(moduleId, manifestId, widgetCanonicalId, themeId);
    if (frameInfo === null) {
      this.logger.warn("widget entry document unavailable", { widgetCanonicalId });
      return new Response("<!doctype html><!-- widget entry unavailable -->", {
        status: 502,
        headers: { ...FRAME_HEADERS },
      });
    }
    if (frameInfo.theme?.fallback) {
      this.logger.warn("widget theme unavailable; rendering the widget's defaults", {
        widgetCanonicalId,
        selectedTheme: themeId,
        reason: frameInfo.theme.fallback,
      });
    }
    const boot: WidgetFrameBoot = {
      v: 1,
      moduleId,
      widgetCanonicalId,
      surface: "scene",
      capabilities: [...FRAME_CAPABILITIES],
      resourceBaseUrl: frameInfo.resourceBaseUrl,
      theme: frameInfo.theme ? hostTheme(frameInfo.theme) : null,
      ...frameFonts(frameInfo),
    };
    const cacheable = versionParam !== null && versionParam === frameVersion(frameInfo);
    return this.render(frameInfo, boot, cacheable ? CACHED_FRAME_CACHE_CONTROL : "no-cache");
  }

  /**
   * One widget of the alert delivered to `sceneId` as scene event `eventId`.
   * The alert is read back from that event, so a frame can only ever show
   * what the scene manager validated and delivered to this scene. Its
   * external media is proxied like a placement's, whether a workflow step
   * entered it or event data filled it: the proxy's own checks (public
   * addresses only, media types, size and relay limits) bound what it fetches.
   */
  async assembleAlertWidget(
    sceneId: string,
    eventId: string,
    widgetId: string,
    nonceParam: string | null
  ): Promise<Response> {
    const event = await this.host.loadSceneEvent(sceneId, eventId);
    const delivery = event?.type === ALERT_EVENT_TYPE ? parseAlertDelivery(event.value) : null;
    const widget = delivery?.layout.widgets.find((w) => w.id === widgetId);
    if (!widget) {
      return this.blankResponse();
    }
    return this.assembleFrame(
      sceneId,
      {
        instanceId: `${eventId}.${widget.id}`,
        moduleId: widget.moduleId,
        manifestId: widget.manifestId,
        widgetCanonicalId: widget.widgetCanonicalId,
        settings: widget.settings,
        surface: "alert",
        // Every alert frame is made for one alert, so it enters as it loads.
        // A generic entrance is the page's to play on the frame's box.
        ...(widget.transitionIn && !isGenericTransitionType(widget.transitionIn.type)
          ? { transition: widgetTransitionState(widget.transitionIn, "in") }
          : {}),
      },
      nonceParam
    );
  }

  /** A widget still renders when its module's settings cannot be read; it
   *  then sees no linked instances, as with an older host. */
  private async loadLinkedResources(moduleId: string): Promise<Record<string, string>> {
    if (!this.opts.linkedResources) {
      return {};
    }
    try {
      return await this.opts.linkedResources(moduleId);
    } catch (err) {
      this.logger.warn("module settings unavailable; the widget sees no linked resources", {
        moduleId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }

  private async assembleFrame(sceneId: string, target: FrameTarget, nonceParam: string | null): Promise<Response> {
    const nonce = nonceParam && NONCE_PATTERN.test(nonceParam) ? nonceParam : this.generateNonce();

    const frameInfo = await this.loadFrameInfo(
      target.moduleId,
      target.manifestId,
      target.widgetCanonicalId,
      selectedThemeId(target.settings)
    );
    if (frameInfo === null) {
      this.logger.warn("widget entry document unavailable", {
        sceneId,
        instanceId: target.instanceId,
        widgetCanonicalId: target.widgetCanonicalId,
      });
      return new Response("<!doctype html><!-- widget entry unavailable -->", {
        status: 502,
        headers: { ...FRAME_HEADERS },
      });
    }

    const theme = frameInfo.theme;
    if (theme?.fallback) {
      this.logger.warn("widget theme unavailable; rendering the widget's defaults", {
        sceneId,
        instanceId: target.instanceId,
        widgetCanonicalId: target.widgetCanonicalId,
        selectedTheme: selectedThemeId(target.settings),
        reason: theme.fallback,
      });
    }

    const linkedResources = await this.loadLinkedResources(target.moduleId);
    const boot: WidgetBootPayload = {
      v: 1,
      nonce,
      instanceId: target.instanceId,
      moduleId: target.moduleId,
      widgetCanonicalId: target.widgetCanonicalId,
      surface: target.surface,
      settings: this.bootSettings(target.settings, frameInfo),
      capabilities: [...FRAME_CAPABILITIES],
      resourceBaseUrl: frameInfo.resourceBaseUrl,
      theme: theme ? hostTheme(theme) : null,
      linkedResources,
      ...frameFonts(frameInfo),
      ...(target.transition ? { transition: target.transition } : {}),
    };
    return this.render(frameInfo, boot, "no-store");
  }

  /**
   * The settings a frame boots with. A widget with a theme contract runs
   * under the theme policy (see `render`), which refuses external media, so
   * its external media is pointed at the media proxy; any other widget loads
   * it directly.
   */
  private bootSettings(settings: Record<string, unknown>, frameInfo: BarkloaderFrameInfo): Record<string, unknown> {
    if (!this.opts.mediaProxy) {
      return settings;
    }
    return this.opts.mediaProxy.overlaySettings(settings, frameMediaProxyBase(frameInfo)).settings;
  }

  /** The entry document with the scaffold, theme stylesheet and policy. */
  private render(
    frameInfo: BarkloaderFrameInfo,
    boot: WidgetBootPayload | WidgetFrameBoot,
    cacheControl: string
  ): Response {
    const theme = frameInfo.theme;
    const scaffold = buildFrameScaffold({ boot, baseHref: frameInfo.resourceBaseUrl, theme });
    let assembled = injectFrameScaffold(frameInfo.entryHtml, scaffold);
    const headers: Record<string, string> = { ...FRAME_HEADERS, "Cache-Control": cacheControl };
    if (theme) {
      if (theme.stylesheetUrl) {
        assembled = injectThemeStylesheet(assembled, theme.stylesheetUrl);
      }
      // Every widget that opted into themes runs under the policy, themed or
      // not, so a theme can never be the thing that changes what loads.
      headers["Content-Security-Policy"] = themeContentSecurityPolicy([
        originOf(frameInfo.resourceBaseUrl),
        ...(theme.stylesheetUrl ? [originOf(theme.stylesheetUrl)] : []),
      ]);
    }
    return new Response(assembled, { status: 200, headers });
  }

  private async loadFrameInfo(
    moduleId: string,
    manifestId: string,
    widgetCanonicalId: string,
    themeId: string | undefined
  ): Promise<BarkloaderFrameInfo | null> {
    try {
      return await this.opts.barkloader.fetchWidgetFrame(moduleId, manifestId, themeId);
    } catch (err) {
      this.logger.warn("barkloader frame fetch failed", {
        widgetCanonicalId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
