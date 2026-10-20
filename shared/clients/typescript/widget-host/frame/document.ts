// The frame document a widget runs in: its entry HTML with the scaffold that
// boots the widget host shim, the theme its contract resolves to, and the
// policy every frame is served under. Whatever serves a frame builds it with
// this, so a widget meets the same document wherever it is hosted.

import type { WidgetBootPayload } from "@woofx3/module-sdk";
import { type CspDirectives, contentSecurityPolicy, withDirectives } from "./csp";
import { escapeHtmlAttribute } from "./html";
import { buildThemeStyle, type FrameTheme, injectThemeStylesheet, originOf, themeCspDirectives } from "./theme";

/** The widget host shim's file name, as whatever serves frames serves it under `/assets/`. */
export const WIDGET_HOST_SHIM_FILE = "widget-host-shim.js";

/** Absolute shim src: a fixed top-level path, so it resolves the same
 *  however deep the frame URL is. */
export const SHIM_SRC = `/assets/${WIDGET_HOST_SHIM_FILE}`;

/**
 * The directives every widget frame is served with, laid over any theme's so
 * a theme can never relax them:
 *
 * - `connect-src 'none'`: widget code is end-user code, and a frame that
 *   could `fetch`, open a socket or beacon could send whatever it is shown
 *   anywhere. What a widget needs from the network it asks the host for over
 *   the bridge (storage, events, `assets.load`), and elements still load
 *   media by URL under their own directives.
 * - `sandbox allow-scripts`: the same sandbox the pages give the iframe, so a
 *   frame document opened on its own, outside any page, still runs with an
 *   opaque origin rather than on the origin that holds overlay sessions.
 */
export const FRAME_DIRECTIVES: CspDirectives = {
  "connect-src": ["'none'"],
  sandbox: ["allow-scripts"],
};

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
  // Every widget that opted into themes runs under the theme policy, themed
  // or not, so a theme can never be the thing that changes what loads.
  const themeDirectives: CspDirectives = theme
    ? themeCspDirectives([
        originOf(source.resourceBaseUrl),
        ...(theme.stylesheetUrl ? [originOf(theme.stylesheetUrl)] : []),
      ])
    : {};
  if (theme?.stylesheetUrl) {
    html = injectThemeStylesheet(html, theme.stylesheetUrl);
  }
  return {
    html,
    headers: {
      ...FRAME_DOCUMENT_HEADERS,
      "Content-Security-Policy": contentSecurityPolicy(withDirectives(themeDirectives, FRAME_DIRECTIVES)),
    },
  };
}
