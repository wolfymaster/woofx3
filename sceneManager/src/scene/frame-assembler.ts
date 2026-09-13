import { join, resolve, sep } from "node:path";
import type { Logger } from "@woofx3/common/runtime";
import type { WidgetBootPayload } from "@woofx3/module-sdk";
import type { OverlayHost, OverlayWidgetInstance } from "./scene-host";
import { sanitizeAssetPath } from "./asset-path";
import type { PublicUrlResolver } from "./public-url-resolver";

/**
 * Uniform blank document: served byte-for-byte identically for an
 * invalid session AND for a valid session with an unknown instance id,
 * so the frame route leaks nothing about which failure occurred.
 * Ported from streamware's `BLANK_FRAME_DOC` (design 5.2.11).
 */
export const BLANK_FRAME_DOC = "<!doctype html><html><head></head><body></body></html>";

/** Capabilities advertised in every boot payload. */
export const FRAME_CAPABILITIES = ["storage", "events", "status"] as const;

/** Absolute shim src — sceneManager serves it at a fixed top-level
 *  path regardless of how deep the frame URL is, so no relative-path
 *  arithmetic is needed (streamware used a relative `../assets/...`
 *  path that depended on frame-URL depth; not worth the fragility
 *  here). */
export const SHIM_SRC = "/assets/widget-host-shim.js";

const FRAME_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export interface BarkloaderFrameInfo {
  entryHtml: string;
  resourceBaseUrl: string;
}

/** The slice of Barkloader's HTTP surface the assembler depends on
 *  (injectable for tests). */
export interface BarkloaderFrameClient {
  fetchWidgetFrame(moduleKey: string, manifestId: string): Promise<BarkloaderFrameInfo | null>;
}

/** Real implementation — calls barkloader's `GET
 *  /widgets/{moduleKey}/{manifestId}/frame` endpoint. */
export class HttpBarkloaderFrameClient implements BarkloaderFrameClient {
  constructor(
    private readonly barkloaderUrl: string,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async fetchWidgetFrame(moduleKey: string, manifestId: string): Promise<BarkloaderFrameInfo | null> {
    const url =
      `${this.barkloaderUrl.replace(/\/+$/, "")}/widgets/` +
      `${encodeURIComponent(moduleKey)}/${encodeURIComponent(manifestId)}/frame`;
    const response = await this.fetchFn(url);
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
    const body = (await response.json()) as { entryHtml?: unknown; resourceBaseUrl?: unknown };
    if (typeof body.entryHtml !== "string" || typeof body.resourceBaseUrl !== "string") {
      this.logger.warn("barkloader widget frame response missing entryHtml/resourceBaseUrl", {
        moduleKey,
        manifestId,
        url,
        keys: Object.keys(body ?? {}),
      });
      return null;
    }
    return { entryHtml: body.entryHtml, resourceBaseUrl: body.resourceBaseUrl };
  }
}

export interface FrameAssemblerOptions {
  barkloader: BarkloaderFrameClient;
  publicDir: string;
  /** Resolves this deployment's own public base URL (the `scene.publicUrl`
   *  DB setting, with env/config fallback — see public-url-resolver.ts),
   *  used to build the resourceBaseUrl for built-in widgets (served from
   *  sceneManager's own local disk, never barkloader). */
  selfPublicUrlResolver: PublicUrlResolver;
  generateNonce?: () => string;
}

export interface FrameScaffold {
  boot: WidgetBootPayload;
  baseHref: string;
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
    `<base href="${escapeHtmlAttribute(scaffold.baseHref)}">`
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

  /** `sceneId` comes from an already-verified session (JWT), not a
   *  re-presented opaque token — see `OverlayHost.loadSceneById`. */
  async assemble(sceneId: string, instanceId: string, nonceParam: string | null): Promise<Response> {
    const state = await this.host.loadSceneById(sceneId);
    if (!state) {
      return this.blankResponse();
    }
    const instance = state.instances.find((w) => w.id === instanceId);
    if (!instance) {
      return this.blankResponse();
    }

    const nonce = nonceParam && NONCE_PATTERN.test(nonceParam) ? nonceParam : this.generateNonce();

    const frameInfo = await this.loadFrameInfo(instance);
    if (frameInfo === null) {
      this.logger.warn("widget entry document unavailable", {
        sceneId,
        instanceId,
        widgetCanonicalId: instance.widgetCanonicalId,
      });
      return new Response("<!doctype html><!-- widget entry unavailable -->", {
        status: 502,
        headers: { ...FRAME_HEADERS },
      });
    }

    const boot: WidgetBootPayload = {
      v: 1,
      nonce,
      instanceId: instance.id,
      moduleId: instance.moduleId,
      widgetCanonicalId: instance.widgetCanonicalId,
      settings: instance.settings,
      capabilities: [...FRAME_CAPABILITIES],
      resourceBaseUrl: frameInfo.resourceBaseUrl,
    };
    const scaffold = buildFrameScaffold({ boot, baseHref: frameInfo.resourceBaseUrl });
    const assembled = injectFrameScaffold(frameInfo.entryHtml, scaffold);
    return new Response(assembled, { status: 200, headers: { ...FRAME_HEADERS } });
  }

  private async loadFrameInfo(instance: OverlayWidgetInstance): Promise<BarkloaderFrameInfo | null> {
    try {
      return await this.opts.barkloader.fetchWidgetFrame(instance.moduleId, instance.manifestId);
    } catch (err) {
      this.logger.warn("barkloader frame fetch failed", {
        widgetCanonicalId: instance.widgetCanonicalId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
