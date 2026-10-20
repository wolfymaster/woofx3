// The preview's answer to a widget's font settings: Google Fonts families,
// relayed through the preview's own origin as the scene manager serves them
// from the engine's. A themeable widget's frame may load fonts only from the
// origin its files come from, so a font linked straight from Google would
// show in the preview and not on stream, or the other way round.
//
// Unlike the scene manager, nothing is kept on disk: the preview runs on a
// machine that is online, and a stylesheet is held only while it runs.

import { findGoogleFontFamily } from "@woofx3/api/google-fonts";
import { FONT_FILES_PREFIX } from "./protocol";

const STYLESHEET_ORIGIN = "https://fonts.googleapis.com";
const FILE_ORIGIN = "https://fonts.gstatic.com";

/**
 * Google sends woff2 files split by unicode range only to a browser it knows
 * supports both, so the request names a current Chrome. Must match the scene
 * manager's google-font-cache.ts, so a family is drawn from the same files.
 */
const STYLESHEET_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** A font file as Google publishes it; the only paths relayed. */
const FONT_FILE_PATH = /^s\/[a-z0-9]+\/v\d+\/[A-Za-z0-9_-]+(?:\.\d+)?\.woff2$/;
const FONT_FILE_URL = /https:\/\/fonts\.gstatic\.com\/([^'")\s]+)/g;

export const FONT_UPSTREAM_TIMEOUT_MS = 10_000;

const CSS_TYPE = "text/css; charset=utf-8";

export class FontRelay {
  private readonly stylesheets = new Map<string, Promise<string | null>>();

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /** `GET /fonts/css?family={family}`: 404 for a family Google does not publish, which the frame uses by name. */
  async stylesheet(familyParam: string | null): Promise<Response> {
    const entry = findGoogleFontFamily(familyParam ?? "");
    if (entry === null) {
      return new Response("", { status: 404, headers: { "Content-Type": CSS_TYPE } });
    }
    let held = this.stylesheets.get(entry.family);
    if (held === undefined) {
      held = this.fetchStylesheet(entry.family);
      this.stylesheets.set(entry.family, held);
    }
    const css = await held;
    if (css === null) {
      this.stylesheets.delete(entry.family);
      return new Response("/* font unavailable */", { status: 503, headers: { "Content-Type": CSS_TYPE } });
    }
    return new Response(css, { status: 200, headers: { "Content-Type": CSS_TYPE } });
  }

  /** `GET /fonts/files/{path}`, `path` as Google publishes it. */
  async file(relativePath: string): Promise<Response> {
    if (!FONT_FILE_PATH.test(relativePath)) {
      return new Response("Not Found", { status: 404 });
    }
    const upstream = await this.fetchFn(`${FILE_ORIGIN}/${relativePath}`, {
      signal: AbortSignal.timeout(FONT_UPSTREAM_TIMEOUT_MS),
    }).catch(() => null);
    if (upstream === null || !upstream.ok) {
      return new Response("Font unavailable", { status: 503 });
    }
    return new Response(await upstream.arrayBuffer(), { status: 200, headers: { "Content-Type": "font/woff2" } });
  }

  private async fetchStylesheet(family: string): Promise<string | null> {
    const name = encodeURIComponent(family).replace(/%20/g, "+");
    // Regular and bold, as the scene manager asks for; a family that refuses
    // a weight list gets the plain request.
    for (const url of [
      `${STYLESHEET_ORIGIN}/css2?family=${name}:wght@400;700&display=swap`,
      `${STYLESHEET_ORIGIN}/css2?family=${name}&display=swap`,
    ]) {
      const response = await this.fetchFn(url, {
        headers: { "User-Agent": STYLESHEET_USER_AGENT },
        signal: AbortSignal.timeout(FONT_UPSTREAM_TIMEOUT_MS),
      }).catch(() => null);
      if (response?.ok) {
        return (await response.text()).replace(FONT_FILE_URL, (_, file: string) => `${FONT_FILES_PREFIX}${file}`);
      }
    }
    return null;
  }
}
