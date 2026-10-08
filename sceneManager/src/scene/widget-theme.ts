import { isWidgetTheme, type WidgetTheme } from "@woofx3/module-sdk";

/** Settings key of the theme picker barkloader adds to a themeable widget.
 *  Must match `THEME_SETTING_ID` in barkloader's module_manifest.rs. */
export const THEME_SETTING_ID = "theme";

/**
 * A widget's theme as barkloader resolves it for one frame: what the widget
 * sees as `host.theme`, plus the stylesheet only the frame document needs.
 * Barkloader has already fallen back to the contract defaults wherever the
 * selected theme is missing or does not fit, so everything here renders.
 */
export interface FrameTheme extends WidgetTheme {
  stylesheetUrl: string | null;
}

/** Parse the `theme` of a barkloader frame response: `null` for a widget
 *  without a contract, and also for anything malformed, which renders the
 *  widget unthemed rather than not at all. */
export function parseFrameTheme(raw: unknown): FrameTheme | null {
  if (!isWidgetTheme(raw)) {
    return null;
  }
  const stylesheetUrl = (raw as { stylesheetUrl?: unknown }).stylesheetUrl;
  return {
    id: raw.id,
    contractVersion: raw.contractVersion,
    variables: { ...raw.variables },
    assets: { ...raw.assets },
    defaultAssets: { ...raw.defaultAssets },
    fallback: raw.fallback,
    stylesheetUrl: typeof stylesheetUrl === "string" && stylesheetUrl.length > 0 ? stylesheetUrl : null,
  };
}

/** The theme canonical id a placement's settings select, if any. */
export function selectedThemeId(settings: Record<string, unknown>): string | undefined {
  const value = settings[THEME_SETTING_ID];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** What `host.theme` carries: the frame theme without the stylesheet. */
export function hostTheme(theme: FrameTheme): WidgetTheme {
  return {
    id: theme.id,
    contractVersion: theme.contractVersion,
    variables: theme.variables,
    assets: theme.assets,
    defaultAssets: theme.defaultAssets,
    fallback: theme.fallback,
  };
}

const IDENT = /^[A-Za-z0-9._-]+$/;

/**
 * Whether a variable value can be written into the `:root` rule as is.
 * Barkloader validated it at install; this repeats the part that keeps a
 * value from ending the declaration or the `<style>` block, because this is
 * the place a lapse would become markup.
 */
function isSafeCssValue(value: string): boolean {
  return value.trim() !== "" && !/[;{}<>\\\u0000-\u001f\u007f]/.test(value) && !/url\(|@import/i.test(value);
}

/** A quoted CSS `url()`. Every character that could end the string, the
 *  declaration or the `<style>` block is written as a CSS hex escape. */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\<>\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}")`;
}

/**
 * The `<style>` block that sets every theme variable as `--theme-{id}` and
 * every filled asset slot as `--theme-asset-{id}`. Injected ahead of the
 * widget's own styles, so a widget reads them with `var()` and its own rules
 * still decide what they are used for.
 */
export function buildThemeStyle(theme: FrameTheme): string {
  const declarations: string[] = [];
  for (const [id, value] of Object.entries(theme.variables)) {
    if (IDENT.test(id) && isSafeCssValue(value)) {
      declarations.push(`--theme-${id}: ${value};`);
    }
  }
  for (const [id, url] of Object.entries(theme.assets)) {
    if (IDENT.test(id) && url !== null) {
      declarations.push(`--theme-asset-${id}: ${cssUrl(url)};`);
    }
  }
  return `<style data-woofx3-theme>:root { ${declarations.join(" ")} }</style>`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Link the theme stylesheet at the end of the entry document's head, after
 * the widget's own styles, so a theme's rules win over the defaults they
 * restyle. A document without `</head>` gets it at the front of the body,
 * which still loads before any widget script below it runs.
 */
export function injectThemeStylesheet(html: string, stylesheetUrl: string): string {
  const link = `<link rel="stylesheet" href="${escapeHtmlAttribute(stylesheetUrl)}" data-woofx3-theme>`;
  const headClose = /<\/head\s*>/i.exec(html);
  if (headClose) {
    return html.slice(0, headClose.index) + link + html.slice(headClose.index);
  }
  const bodyOpen = /<body(?:\s[^>]*)?>/i.exec(html);
  if (bodyOpen) {
    const at = bodyOpen.index + bodyOpen[0].length;
    return html.slice(0, at) + link + html.slice(at);
  }
  return link + html;
}

/**
 * The Content-Security-Policy for a themeable widget's frame: styles and fonts
 * from the engine only. A theme stylesheet is author data, and its `url(...)`
 * or `@import` could otherwise pull in more CSS or fonts from any host; nothing
 * a theme ships is a script, so scripts and connections are left as they were.
 *
 * Images and media may come from any http(s) host, because a placement's media
 * settings can name a file hosted outside the engine and the widget loads it
 * from there. The policy is fixed when the frame loads while settings change
 * live, so it cannot list just the hosts the settings name. A theme can
 * therefore reference an outside image too; that only fetches an image.
 *
 * `'self'` alone is not enough for styles and fonts: the frame is sandboxed
 * and its resources come from barkloader's public origin, not the scene
 * manager's, so each engine origin is listed. `'unsafe-inline'` is for the
 * widget's own inline styles and the variables block this module injects.
 */
export function themeContentSecurityPolicy(engineOrigins: string[]): string {
  const origins = ["'self'", ...new Set(engineOrigins.filter((o) => o !== "" && o !== "null"))].join(" ");
  return [
    `style-src ${origins} 'unsafe-inline'`,
    `font-src ${origins} data:`,
    `img-src ${origins} https: http: data: blob:`,
    `media-src ${origins} https: http: data: blob:`,
  ].join("; ");
}

/** The origin of an absolute URL, or `""` when it has none. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
