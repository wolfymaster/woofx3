import { FONT_FILES_PREFIX, FONT_STYLESHEET_PATH, type GoogleFontCache } from "../fonts/google-font-cache";

/** Whether `pathname` is one of the font routes. */
export function isFontPath(pathname: string): boolean {
  return pathname === FONT_STYLESHEET_PATH || pathname.startsWith(FONT_FILES_PREFIX);
}

/**
 * `GET /fonts/css?family={family}` and `GET /fonts/files/{path}`: the Google
 * families widget frames link for their `font` settings (see
 * google-font-cache.ts). Public, like the frame documents that link them.
 */
export async function handleFontRoute(req: Request, url: URL, fonts: GoogleFontCache): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(null, { status: 405 });
  }
  if (url.pathname === FONT_STYLESHEET_PATH) {
    return fonts.stylesheet(url.searchParams.get("family"));
  }
  return fonts.file(url.pathname.slice(FONT_FILES_PREFIX.length));
}
