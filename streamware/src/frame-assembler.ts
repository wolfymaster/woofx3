import { join, resolve, sep } from "node:path";
import type { SharedLogger } from "@woofx3/common/logging";
import type { WidgetBootPayload } from "@woofx3/module-sdk/src/widget-protocol";
import { BUILTIN_MODULE_KEY, type OverlayHost, type OverlayWidgetInstance } from "./overlay-host";
import { maskToken } from "./overlay-token";
import { sanitizeAssetPath } from "./widget-asset-proxy";

/**
 * Uniform blank document (design 5.2.11): served byte-for-byte
 * identically for an invalid token AND for a valid token with an
 * unknown instance id, so the frame route leaks nothing about which
 * failure occurred.
 */
export const BLANK_FRAME_DOC = "<!doctype html><html><head></head><body></body></html>";

/** Capabilities advertised in every boot payload (P1, design 2.3). */
export const FRAME_CAPABILITIES = ["storage", "events", "status"] as const;

/** Document-relative shim src — precedes <base>, so it resolves
 *  against the frame URL `/o/{token}/frame/{id}` to
 *  `/o/{token}/assets/widget-host-shim.js` (design 5.2.12). */
export const SHIM_SRC = "../assets/widget-host-shim.js";

const FRAME_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  // Frame URLs contain the token and widgets fetch external URLs
  // (design 5.2.11): never leak the URL in a Referer header.
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** Nonce values come off the query string; constrain to a URL-safe
 *  alphabet so they can be inlined into the boot payload untouched. */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export interface FrameAssemblerOptions {
  barkloaderUrl: string;
  publicDir: string;
  /** CDN override (design 2.5). Empty -> relative <base>. */
  widgetAssetBaseUrl: string;
  fetchFn?: typeof fetch;
  generateNonce?: () => string;
}

export interface FrameScaffold {
  boot: WidgetBootPayload;
  baseHref: string;
}

/**
 * Build the injected scaffold block in the NORMATIVE order (design
 * 5.2.12): (1) inline boot payload, (2) classic shim script tag,
 * (3) <base> pointing at the widget asset root. The shim must stay a
 * classic script (no async/defer): existing widgets read
 * `window.widgetHost` at IIFE time, and the script src must precede
 * <base> so it resolves against the frame URL, not the asset root.
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
 * document. Fallback rules (design 2.3): no <head> -> synthesize one
 * directly after <html>; neither -> inject at the very front (after a
 * doctype when present). A leading BOM is preserved in place.
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
 * Assembles widget frame documents (design 2.3 + 5.2.12). Module
 * widget entries are fetched from barkloader's asset route; built-in
 * entries are read from `streamware/public/widgets/builtin/` —
 * built-ins render through frame assembly uniformly (design 5.2.2).
 */
export class FrameAssembler {
  private readonly fetchFn: typeof fetch;
  private readonly generateNonce: () => string;

  constructor(
    private readonly host: OverlayHost,
    private readonly logger: SharedLogger,
    private readonly opts: FrameAssemblerOptions
  ) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.generateNonce = opts.generateNonce ?? defaultNonce;
  }

  /** Uniform blank response — identical bytes for every refusal path. */
  blankResponse(): Response {
    return new Response(BLANK_FRAME_DOC, { status: 200, headers: { ...FRAME_HEADERS } });
  }

  async assemble(token: string, instanceId: string, nonceParam: string | null): Promise<Response> {
    const state = await this.host.loadScene(token);
    if (!state) {
      return this.blankResponse();
    }
    const instance = state.instances.find((w) => w.id === instanceId);
    if (!instance) {
      // Same bytes as the invalid-token path (design 5.2.11).
      return this.blankResponse();
    }

    // Parent-generated nonce arrives on the frame URL; a direct load
    // without one gets a fresh server-side nonce (renders, but cannot
    // bind to a parent — design 2.3 nonce flow).
    const nonce = nonceParam && NONCE_PATTERN.test(nonceParam) ? nonceParam : this.generateNonce();

    const entryHtml = await this.loadEntryHtml(instance);
    if (entryHtml === null) {
      this.logger.warn("widget entry document unavailable", {
        token: maskToken(token),
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
    };
    const scaffold = buildFrameScaffold({ boot, baseHref: this.baseHrefFor(instance) });
    const assembled = injectFrameScaffold(entryHtml, scaffold);
    return new Response(assembled, { status: 200, headers: { ...FRAME_HEADERS } });
  }

  /**
   * Widget asset root for the frame's <base> (design 2.5). Relative by
   * default so subresources resolve through whatever public prefix the
   * page loaded under; absolute when the CDN override is set. Built-ins
   * always use the relative token-scoped prefix — their assets live in
   * streamware's public dir, not behind the CDN's barkloader layout.
   */
  private baseHrefFor(instance: OverlayWidgetInstance): string {
    const moduleKey = encodeURIComponent(instance.moduleId);
    const manifestId = encodeURIComponent(instance.manifestId);
    if (this.opts.widgetAssetBaseUrl && instance.moduleId !== BUILTIN_MODULE_KEY) {
      const cdn = this.opts.widgetAssetBaseUrl.replace(/\/+$/, "");
      return `${cdn}/modules/${moduleKey}/widgets/${manifestId}/`;
    }
    return `../widget-assets/${moduleKey}/${manifestId}/`;
  }

  private async loadEntryHtml(instance: OverlayWidgetInstance): Promise<string | null> {
    const definition = await this.host.lookupWidgetDefinition(
      instance.moduleId,
      instance.manifestId
    );
    const entryRaw = definition?.entry || "index.html";
    // The registered entry is data from the catalog: run it through
    // the same traversal pipeline as request paths (design 5.2.9).
    const entry = sanitizeAssetPath(entryRaw);
    if (!entry) {
      this.logger.warn("widget entry path rejected by traversal pipeline", {
        widgetCanonicalId: instance.widgetCanonicalId,
        entry: entryRaw,
      });
      return null;
    }

    if (instance.moduleId === BUILTIN_MODULE_KEY) {
      return this.readBuiltinEntry(instance.manifestId, entry);
    }

    const url =
      `${this.opts.barkloaderUrl.replace(/\/+$/, "")}/assets/modules/` +
      `${encodeURIComponent(instance.moduleId)}/widgets/` +
      `${encodeURIComponent(instance.manifestId)}/` +
      entry.split("/").map(encodeURIComponent).join("/");
    try {
      const response = await this.fetchFn(url);
      if (!response.ok) {
        this.logger.warn("barkloader entry fetch returned non-OK", {
          url,
          status: response.status,
        });
        return null;
      }
      return await response.text();
    } catch (err) {
      this.logger.warn("barkloader entry fetch failed", {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async readBuiltinEntry(manifestId: string, entry: string): Promise<string | null> {
    const root = resolve(this.opts.publicDir, "widgets", BUILTIN_MODULE_KEY);
    const abs = resolve(join(root, manifestId, entry));
    if (abs !== root && !abs.startsWith(root + sep)) {
      return null;
    }
    const file = Bun.file(abs);
    if (!(await file.exists())) {
      return null;
    }
    return file.text();
  }
}
