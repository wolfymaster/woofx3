// The Google Fonts families a `font` setting can name.
//
// A `font` setting's value is a CSS font-family list, such as
// `"Lobster", cursive` or `Roboto, system-ui, sans-serif`. Its first family is
// the one the widget asks for: when that is a Google family, the scene manager
// serves it (fetched from Google once, then from its own disk), and the rest of
// the list is what shows while it loads or when it cannot be had. Any other
// first family, such as one installed on the streaming machine, is used as is.

import { GOOGLE_FONT_ROWS } from "./google-fonts.generated";

/** The catalog's categories; the generated rows index into this order. */
export const GOOGLE_FONT_CATEGORIES = ["sans-serif", "serif", "display", "handwriting", "monospace"] as const;

export type GoogleFontCategory = (typeof GOOGLE_FONT_CATEGORIES)[number];

export interface GoogleFontFamily {
  family: string;
  category: GoogleFontCategory;
}

/**
 * The shape every Google family name has. The name becomes part of a request
 * URL, so anything else is refused before the catalog is consulted. Must match
 * `FONT_FAMILY_NAME` in the module SDK's widget-fonts.ts.
 */
const FAMILY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,63}$/;

/** The generic family that stands in for each category while a font loads. */
const CATEGORY_FALLBACK: Record<GoogleFontCategory, string> = {
  "sans-serif": "sans-serif",
  serif: "serif",
  display: "sans-serif",
  handwriting: "cursive",
  monospace: "monospace",
};

export function isGoogleFontFamilyName(name: string): boolean {
  return FAMILY_NAME.test(name);
}

let families: readonly GoogleFontFamily[] | null = null;
let byName: ReadonlyMap<string, GoogleFontFamily> | null = null;

/** Every family, most popular first. */
export function googleFontFamilies(): readonly GoogleFontFamily[] {
  if (families === null) {
    families = GOOGLE_FONT_ROWS.map(([family, index]) => {
      const category = GOOGLE_FONT_CATEGORIES[index];
      if (category === undefined) {
        throw new Error(`google-fonts: ${family} has category index ${index}`);
      }
      return { family, category };
    });
  }
  return families;
}

/** The catalog entry for `name`, matched exactly, or null. */
export function findGoogleFontFamily(name: string): GoogleFontFamily | null {
  if (!isGoogleFontFamilyName(name)) {
    return null;
  }
  if (byName === null) {
    byName = new Map(googleFontFamilies().map((entry) => [entry.family, entry]));
  }
  return byName.get(name) ?? null;
}

/** The value a font picker stores for a Google family. */
export function googleFontValue(entry: GoogleFontFamily): string {
  return `"${entry.family}", ${CATEGORY_FALLBACK[entry.category]}`;
}

/**
 * The first family a `font` value names, unquoted, or null for an empty value.
 * Must match `primaryFontFamily` in the module SDK's widget-fonts.ts.
 */
export function primaryFontFamily(value: string): string | null {
  const first = value.split(",")[0]?.trim() ?? "";
  const unquoted = /^(["'])(.*)\1$/.exec(first)?.[2]?.trim() ?? first;
  return unquoted === "" ? null : unquoted;
}
