import type { Logger } from "@woofx3/common/runtime";
import { PROTOCOL_VERSION, WIDGET_CAPABILITIES, type WidgetBootPayload } from "@woofx3/module-sdk";
import {
  FRAME_DOCUMENT_HEADERS,
  type FrameSource,
  frameDocument,
  hostTheme,
  parseFrameTheme,
  type WidgetFrameBoot,
} from "@woofx3/widget-host/frame";
import { FONT_STYLESHEET_PATH } from "../fonts/google-font-cache";
import { frameVersion } from "./frame-catalog";
import { StageTimings } from "../stage-timings";

/**
 * Uniform blank document: served byte-for-byte identically for every
 * refusal, so a refused request leaks nothing about which check failed.
 */
export const BLANK_FRAME_DOC = "<!doctype html><html><head></head><body></body></html>";

const FRAME_HEADERS: Record<string, string> = { ...FRAME_DOCUMENT_HEADERS, "Cache-Control": "no-store" };

export interface BarkloaderFrameInfo extends FrameSource {
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
    /** The engine secret; the frame route is one of barkloader's authenticated routes. */
    private readonly barkloaderKey: string,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs: number = FRAME_FETCH_TIMEOUT_MS
  ) {}

  async fetchWidgetFrame(moduleKey: string, manifestId: string, themeId?: string): Promise<BarkloaderFrameInfo | null> {
    const query = themeId === undefined ? "" : `?theme=${encodeURIComponent(themeId)}`;
    const url =
      `${this.barkloaderUrl.replace(/\/+$/, "")}/widgets/` +
      `${encodeURIComponent(moduleKey)}/${encodeURIComponent(manifestId)}/frame${query}`;
    const response = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.barkloaderKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
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
  /** Milliseconds on a monotonic clock, for the `Server-Timing` header; `performance.now` when absent. */
  now?: () => number;
}

/** The stage a frame document's `Server-Timing` names: asking barkloader for the widget's entry. */
type FrameStage = "frame";

/** A frame document whose URL carries its current version never changes. */
const CACHED_FRAME_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Assembles widget frame documents. A module widget's entry HTML and
 * resource base URL come from one barkloader call, which owns resolving
 * the module's installed version.
 */
export class FrameAssembler {
  private readonly now: () => number;

  constructor(
    private readonly logger: Logger,
    private readonly opts: FrameAssemblerOptions
  ) {
    this.now = opts.now ?? (() => performance.now());
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
    const timings = new StageTimings<FrameStage>(this.now);
    const frameInfo = await timings.time("frame", () =>
      this.loadFrameInfo(moduleId, manifestId, widgetCanonicalId, themeId)
    );
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
      v: PROTOCOL_VERSION,
      moduleId,
      widgetCanonicalId,
      surface: "scene",
      // What the host may offer; `init` says what this frame gets.
      capabilities: [...WIDGET_CAPABILITIES],
      resourceBaseUrl: frameInfo.resourceBaseUrl,
      theme: frameInfo.theme ? hostTheme(frameInfo.theme) : null,
      ...frameFonts(frameInfo),
    };
    const cacheable = versionParam !== null && versionParam === frameVersion(frameInfo);
    return this.render(frameInfo, boot, cacheable ? CACHED_FRAME_CACHE_CONTROL : "no-cache", timings);
  }

  private render(
    frameInfo: BarkloaderFrameInfo,
    boot: WidgetFrameBoot,
    cacheControl: string,
    timings: StageTimings<FrameStage>
  ): Response {
    const { html, headers } = frameDocument(frameInfo, boot);
    // A cached response is replayed unchanged, so its timings would describe
    // the first miss on every later hit.
    const responseHeaders: Record<string, string> = { ...headers, "Cache-Control": cacheControl };
    if (cacheControl !== CACHED_FRAME_CACHE_CONTROL) {
      responseHeaders["Server-Timing"] = timings.serverTiming();
    }
    return new Response(html, { status: 200, headers: responseHeaders });
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
