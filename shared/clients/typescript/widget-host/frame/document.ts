// The frame document a widget runs in: its entry HTML with the scaffold that
// boots the widget host shim, the theme its contract resolves to, and the
// policy every frame is served under. Whatever serves a frame builds it with
// this, so a widget meets the same document wherever it is hosted.

import type { WidgetBootPayload } from "@woofx3/module-sdk";
import { type CspDirectives, contentSecurityPolicy, withDirectives } from "./csp";
import { escapeHtmlAttribute } from "./html";
import { buildThemeStyle, type FrameTheme, injectThemeStylesheet, originOf } from "./theme";

/** The widget host shim's file name, as whatever serves frames serves it under `/assets/`. */
export const WIDGET_HOST_SHIM_FILE = "widget-host-shim.js";

/** Absolute shim src: a fixed top-level path, so it resolves the same
 *  however deep the frame URL is. */
export const SHIM_SRC = `/assets/${WIDGET_HOST_SHIM_FILE}`;

/**
 * Images on Twitch's CDN, where emotes, badges and profile pictures in event
 * data are hosted. A frame can make a request to it, but whatever the URL
 * carries lands with Twitch, never with someone who could read it. Exact host
 * and https only, so no other Twitch host is opened with it.
 */
export const TWITCH_IMAGE_CDN = "https://static-cdn.jtvnw.net";

/**
 * The directives every widget frame is served with, whatever else it loads.
 * Widget code and theme stylesheets are end-user data, and anything a frame
 * can make the browser request can carry what the frame is shown in its URL:
 *
 * - `default-src 'none'`: nothing loads unless `frameLoadDirectives` names it,
 *   including nested frames, workers, plugins and prefetches.
 * - `connect-src 'none'`: no `fetch`, sockets or beacons. What a widget needs
 *   from the network it asks the host for over the bridge (storage, events,
 *   `assets.load`).
 * - `sandbox allow-scripts`: the same sandbox the pages give the iframe, so a
 *   frame document opened on its own, outside any page, still runs with an
 *   opaque origin rather than on the origin that holds overlay sessions.
 *
 * A policy cannot stop a frame navigating itself or opening a WebRTC connection
 * (Chromium ignores CSP's `webrtc` directive, and a STUN request reaches its
 * server), so a widget can still send what it is shown to another host those
 * ways. This limits what a widget can
 * reach; it does not make what a widget is given secret from its author.
 */
export const FRAME_DIRECTIVES: CspDirectives = {
  "default-src": ["'none'"],
  "connect-src": ["'none'"],
  sandbox: ["allow-scripts"],
};

/**
 * Where a frame may load from: the engine, plus images from Twitch's CDN. Each
 * engine origin is listed because `'self'` alone is not enough: the frame's
 * document comes from the scene manager and its resources from barkloader's
 * public origin. External media a placement's settings name reaches the frame
 * through the engine's media proxy (the scene manager's media-proxy.ts).
 *
 * `storageOrigin` is the engine's bucket, where an uploaded file's URL on the
 * engine redirects to; a browser checks the policy again on a redirect. Whatever
 * a URL carries lands in the engine's own storage, and the origin is unique to
 * that bucket. It is left out of scripts and styles, which are always served
 * from the engine.
 *
 * Only picker-shaped settings (`{ source: "url", url }`, see the scene
 * manager's media-url.ts) are proxied, so a widget cannot load external media
 * that arrives any other way: a URL in a bare string setting, or one in event
 * data other than a Twitch CDN image. That is deliberate, since every host
 * listed here is one a widget can send data to.
 *
 * `'unsafe-inline'` is for the boot scaffold, theme variables and widgets'
 * own inline code. `'unsafe-eval'` is for libraries that compile at runtime,
 * such as Lottie's expressions; neither opens a host.
 */
export function frameLoadDirectives(engineOrigins: string[], storageOrigin: string | null): CspDirectives {
  const origins = ["'self'", ...new Set(engineOrigins.filter((o) => o !== "" && o !== "null"))];
  const storage = storageOrigin === null ? [] : [storageOrigin];
  return {
    "script-src": [...origins, "'unsafe-inline'", "'unsafe-eval'"],
    "style-src": [...origins, "'unsafe-inline'"],
    "font-src": [...origins, ...storage, "data:"],
    "img-src": [...origins, ...storage, TWITCH_IMAGE_CDN, "data:", "blob:"],
    "media-src": [...origins, ...storage, "data:", "blob:"],
  };
}

/** The headers every frame document carries, whatever its cache policy. */
export const FRAME_DOCUMENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
});

/**
 * The boot payload a cacheable frame document inlines: the widget's half.
 * The placement's half (`WidgetPlacementBoot`) arrives in the fragment.
 */
export type WidgetFrameBoot = Omit<WidgetBootPayload, "nonce" | "instanceId" | "settings" | "linkedResources">;

export interface FrameScaffold {
  boot: WidgetBootPayload | WidgetFrameBoot;
  baseHref: string;
  /** Variables and asset slots of a themeable widget, set before any of
   *  the widget's own styles or scripts. */
  theme?: FrameTheme | null;
}

/**
 * Build the injected scaffold block in the NORMATIVE order: (1) inline
 * boot payload, (2) classic shim script tag, (3) <base> pointing at
 * the widget asset root. The shim must stay a classic script (no async/
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

/** What a frame document is built from: the widget's entry and where its files are. */
export interface FrameSource {
  entryHtml: string;
  resourceBaseUrl: string;
  /** The bucket asset requests redirect to; `null` when they do not redirect. */
  storageOrigin: string | null;
  /** `null` for a widget that declares no theme contract. */
  theme: FrameTheme | null;
}

/** A frame document and the headers it must be served with, `Cache-Control` aside. */
export interface FrameDocument {
  html: string;
  headers: Record<string, string>;
}

/** The entry document with the scaffold, theme stylesheet and policy. */
export function frameDocument(source: FrameSource, boot: WidgetBootPayload | WidgetFrameBoot): FrameDocument {
  const theme = source.theme;
  const scaffold = buildFrameScaffold({ boot, baseHref: source.resourceBaseUrl, theme });
  let html = injectFrameScaffold(source.entryHtml, scaffold);
  const loadDirectives = frameLoadDirectives(
    [originOf(source.resourceBaseUrl), ...(theme?.stylesheetUrl ? [originOf(theme.stylesheetUrl)] : [])],
    source.storageOrigin
  );
  if (theme?.stylesheetUrl) {
    html = injectThemeStylesheet(html, theme.stylesheetUrl);
  }
  return {
    html,
    headers: {
      ...FRAME_DOCUMENT_HEADERS,
      "Content-Security-Policy": contentSecurityPolicy(withDirectives(loadDirectives, FRAME_DIRECTIVES)),
    },
  };
}
