// Font settings: how a widget gets the font a placement picks without asking.
//
// A `font` setting holds a CSS font-family list, used like any other setting
// through its binding:
//
//   font-family: var(--setting-fontFamily, Roboto, sans-serif);
//
// The frame's boot payload names the widget's font settings and where the
// scene manager serves font stylesheets. For each, the shim links the
// stylesheet for the list's first family, and moves the link when the setting
// changes. The scene manager answers with the family's @font-face rules when it
// is a Google family, and with nothing otherwise, so a family installed on the
// streaming machine, or a family that cannot be fetched, falls through to the
// rest of the list.

import type { WidgetFonts } from "./widget-protocol";

/** One stylesheet link, as the loader handles it. */
export interface FontLinkElement {
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** The slice of a document the loader touches (injectable for tests). */
export interface FontDocument {
  head: { appendChild(element: FontLinkElement): unknown } | null;
  createElement(tag: "link"): FontLinkElement;
}

/**
 * The shape every family the scene manager can serve has; anything else is a
 * local or generic family and never requested. Must match `FAMILY_NAME` in
 * `@woofx3/api/google-fonts`.
 */
const FONT_FAMILY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,63}$/;

/** CSS keywords a font-family list can start with that name no family. */
const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "revert",
]);

/**
 * The first family a `font` value names, unquoted, or null for an empty value.
 * Must match `primaryFontFamily` in `@woofx3/api/google-fonts`.
 */
export function primaryFontFamily(value: string): string | null {
  const first = value.split(",")[0]?.trim() ?? "";
  const unquoted = /^(["'])(.*)\1$/.exec(first)?.[2]?.trim() ?? first;
  return unquoted === "" ? null : unquoted;
}

/** The family worth requesting for a setting's value, or null. */
export function requestableFontFamily(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const family = primaryFontFamily(value);
  if (family === null || !FONT_FAMILY_NAME.test(family) || GENERIC_FAMILIES.has(family.toLowerCase())) {
    return null;
  }
  return family;
}

export interface FontLoader {
  /** Link exactly the stylesheets `settings`' font settings need. */
  apply(settings: Readonly<Record<string, unknown>>): void;
}

/**
 * A loader linking stylesheets from `fonts.stylesheetUrl`, resolved against
 * `frameUrl`. The frame URL, not the document's base: the widget's `<base>`
 * points at its own files, while the stylesheets come from the scene manager.
 */
export function createFontLoader(doc: FontDocument, fonts: WidgetFonts, frameUrl: string): FontLoader {
  const linked = new Map<string, FontLinkElement>();

  function stylesheetHref(family: string): string {
    const url = new URL(fonts.stylesheetUrl, frameUrl);
    url.searchParams.set("family", family);
    return url.href;
  }

  return {
    apply(settings) {
      const wanted = new Set<string>();
      for (const id of fonts.settings) {
        const family = requestableFontFamily(settings[id]);
        if (family !== null) {
          wanted.add(family);
        }
      }
      for (const [family, link] of linked) {
        if (!wanted.has(family)) {
          link.remove();
          linked.delete(family);
        }
      }
      if (doc.head === null) {
        return;
      }
      for (const family of wanted) {
        if (linked.has(family)) {
          continue;
        }
        const link = doc.createElement("link");
        link.setAttribute("rel", "stylesheet");
        link.setAttribute("href", stylesheetHref(family));
        doc.head.appendChild(link);
        linked.set(family, link);
      }
    },
  };
}
