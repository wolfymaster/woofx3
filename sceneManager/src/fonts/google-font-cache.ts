import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findGoogleFontFamily } from "@woofx3/api/google-fonts";
import type { Logger } from "@woofx3/common/runtime";

/**
 * Where a widget frame links a family's stylesheet (`?family=`). Font files
 * are served from `FONT_FILES_PREFIX`, which the stylesheet's relative
 * `url(files/…)` resolves to.
 */
export const FONT_STYLESHEET_PATH = "/fonts/css";
export const FONT_FILES_PREFIX = "/fonts/files/";

const STYLESHEET_ORIGIN = "https://fonts.googleapis.com";
const FILE_ORIGIN = "https://fonts.gstatic.com";

/**
 * Google answers with woff2 split by unicode range only to a browser it knows
 * supports both, and the stylesheet it sends depends on the user agent, so the
 * request names a current Chrome.
 */
const STYLESHEET_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * A font file as Google publishes it; a family split into many slices numbers
 * them (`….117.woff2`). Its version is in the path, so a path's bytes never
 * change.
 */
const FONT_FILE_PATH = /^s\/[a-z0-9]+\/v\d+\/[A-Za-z0-9_-]+(?:\.\d+)?\.woff2$/;
const FONT_FILE_URL = /url\(\s*['"]?https:\/\/fonts\.gstatic\.com\/([^'")\s]+)['"]?\s*\)/g;

const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_STYLESHEET_BYTES = 1024 * 1024;
const MAX_FONT_FILE_BYTES = 10 * 1024 * 1024;

const CSS_TYPE = "text/css; charset=utf-8";
const STYLESHEET_CACHE_CONTROL = "public, max-age=86400";
const FONT_FILE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Serves Google Fonts families to widget frames from the engine's own disk.
 *
 * A family is fetched from Google the first time a frame asks for it, and each
 * of its files the first time a frame's text needs that file's characters;
 * both are kept under `dir` and served from there ever after, so a family
 * once shown keeps working with no connection. The browser only asks for the
 * files covering characters it draws, which keeps a large family (a CJK one
 * is over a hundred files) to the few the overlay uses.
 *
 * Only families in the generated catalog are requested, and only files a
 * served stylesheet names are fetched, so the route cannot be used to make the
 * engine fetch anything else. When Google cannot be reached, the frame gets no
 * rules for the family and renders with the rest of its font-family list.
 */
export class GoogleFontCache {
  /** Files the served stylesheets name: the only ones fetched on request. */
  private readonly knownFiles = new Set<string>();
  private knownFilesLoaded: Promise<void> | null = null;
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /** `GET /fonts/css?family={family}`. */
  async stylesheet(familyParam: string | null): Promise<Response> {
    const entry = findGoogleFontFamily(familyParam ?? "");
    if (entry === null) {
      // Most often a family installed on the streaming machine, which the
      // frame then uses by name; the answer will not change, so it is cached.
      return new Response("", {
        status: 404,
        headers: { "Content-Type": CSS_TYPE, "Cache-Control": STYLESHEET_CACHE_CONTROL },
      });
    }
    const path = this.stylesheetPath(entry.family);
    if (!(await Bun.file(path).exists())) {
      const fetched = await this.once(`css:${entry.family}`, () => this.fetchStylesheet(entry.family, path));
      if (!fetched) {
        return new Response("/* font unavailable */", {
          status: 503,
          headers: { "Content-Type": CSS_TYPE, "Cache-Control": "no-store" },
        });
      }
    }
    const css = await Bun.file(path).text();
    this.noteFiles(css);
    return new Response(css, {
      status: 200,
      headers: { "Content-Type": CSS_TYPE, "Cache-Control": STYLESHEET_CACHE_CONTROL },
    });
  }

  /** `GET /fonts/files/{path}`, `path` as Google publishes it. */
  async file(relativePath: string): Promise<Response> {
    if (!FONT_FILE_PATH.test(relativePath)) {
      return new Response("Not Found", { status: 404 });
    }
    const path = join(this.dir, "files", relativePath);
    if (!(await Bun.file(path).exists())) {
      await this.loadKnownFiles();
      if (!this.knownFiles.has(relativePath)) {
        return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      const fetched = await this.once(`file:${relativePath}`, () => this.fetchFile(relativePath, path));
      if (!fetched) {
        return new Response("Font unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }
    return new Response(Bun.file(path), {
      status: 200,
      headers: { "Content-Type": "font/woff2", "Cache-Control": FONT_FILE_CACHE_CONTROL },
    });
  }

  private stylesheetPath(family: string): string {
    // Catalog names are letters, digits and spaces, so this is a safe file
    // name, and distinct per family because no catalog name holds an `_`.
    return join(this.dir, "css", `${family.replace(/ /g, "_")}.css`);
  }

  /** Share one upstream fetch between frames asking for the same thing at once. */
  private once(key: string, fetchOnce: () => Promise<boolean>): Promise<boolean> {
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }
    const started = fetchOnce().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, started);
    return started;
  }

  private async fetchStylesheet(family: string, path: string): Promise<boolean> {
    const name = encodeURIComponent(family).replace(/%20/g, "+");
    // Regular and bold, which is what widgets draw with; Google leaves out a
    // weight a family lacks and the browser synthesises it. Some families
    // refuse a weight list, so the plain request is the fallback.
    const candidates = [
      `${STYLESHEET_ORIGIN}/css2?family=${name}:wght@400;700&display=swap`,
      `${STYLESHEET_ORIGIN}/css2?family=${name}&display=swap`,
    ];
    for (const url of candidates) {
      const text = await this.fetchText(url);
      if (text === null) {
        continue;
      }
      const css = localizeStylesheet(text);
      if (css === null) {
        this.logger.warn("google font stylesheet named no usable font files", { family, url });
        continue;
      }
      await writeAtomically(path, css);
      this.noteFiles(css);
      return true;
    }
    return false;
  }

  private async fetchFile(relativePath: string, path: string): Promise<boolean> {
    const url = `${FILE_ORIGIN}/${relativePath}`;
    try {
      const response = await this.fetchFn(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (!response.ok) {
        this.logger.warn("google font file request failed", { url, status: response.status });
        return false;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_FONT_FILE_BYTES) {
        this.logger.warn("google font file has an unexpected size", { url, bytes: bytes.byteLength });
        return false;
      }
      await writeAtomically(path, bytes);
      return true;
    } catch (err) {
      this.logger.warn("google font file unavailable", {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private async fetchText(url: string): Promise<string | null> {
    try {
      const response = await this.fetchFn(url, {
        headers: { "User-Agent": STYLESHEET_USER_AGENT },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn("google font stylesheet request failed", { url, status: response.status });
        return null;
      }
      const text = await response.text();
      if (text.length > MAX_STYLESHEET_BYTES) {
        this.logger.warn("google font stylesheet is too large", { url, bytes: text.length });
        return null;
      }
      return text;
    } catch (err) {
      this.logger.warn("google font stylesheet unavailable", {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private noteFiles(css: string): void {
    for (const match of css.matchAll(/url\(files\/([^)]+)\)/g)) {
      this.knownFiles.add(match[1]!);
    }
  }

  /** After a restart, the stylesheets already on disk name the files a frame may still ask for. */
  private loadKnownFiles(): Promise<void> {
    if (this.knownFilesLoaded === null) {
      this.knownFilesLoaded = (async () => {
        const cssDir = join(this.dir, "css");
        const names = await readdir(cssDir).catch(() => [] as string[]);
        for (const name of names) {
          if (name.endsWith(".css")) {
            this.noteFiles(await Bun.file(join(cssDir, name)).text());
          }
        }
      })();
    }
    return this.knownFilesLoaded;
  }
}

/**
 * Google's stylesheet with every font file pointed at the engine, or null when
 * it names none. A rule naming a file anywhere but where Google publishes them
 * is dropped rather than served, so a frame never loads a font from outside
 * the engine.
 */
export function localizeStylesheet(css: string): string | null {
  const rules: string[] = [];
  for (const match of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const rule = match[0];
    const sources = [...rule.matchAll(/url\(([^)]*)\)/g)];
    const files = [...rule.matchAll(FONT_FILE_URL)].map((m) => m[1]!);
    if (sources.length === 0 || files.length !== sources.length || !files.every((f) => FONT_FILE_PATH.test(f))) {
      continue;
    }
    rules.push(rule.replace(FONT_FILE_URL, (_, file: string) => `url(files/${file})`));
  }
  return rules.length === 0 ? null : `${rules.join("\n")}\n`;
}

/** A reader never sees half a file: it is written beside its path and moved into place. */
async function writeAtomically(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}
