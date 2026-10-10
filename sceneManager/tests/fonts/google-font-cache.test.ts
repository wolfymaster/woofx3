import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleFontCache, localizeStylesheet } from "../../src/fonts/google-font-cache";

const logger = {
  debug: mock(() => undefined),
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
} as never;

const LATIN = "s/lobster/v32/neILzCirqoswsqX9zoKmMw.woff2";
const GOOGLE_CSS = `/* latin */
@font-face {
  font-family: 'Lobster';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/${LATIN}) format('woff2');
  unicode-range: U+0000-00FF;
}
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "woofx3-fonts-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function upstream(handler: (url: string) => Response) {
  return mock(async (input: string | URL | Request) => handler(String(input)));
}

describe("localizeStylesheet", () => {
  it("points font files at the engine", () => {
    expect(localizeStylesheet(GOOGLE_CSS)).toContain(`src: url(files/${LATIN}) format('woff2');`);
  });

  it("keeps the numbered slices of a large family", () => {
    const sliced = GOOGLE_CSS.replace(LATIN, "s/notosansjp/v57/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.117.woff2");
    expect(localizeStylesheet(sliced)).toContain("url(files/s/notosansjp/v57/");
  });

  it("drops a rule naming a file anywhere else", () => {
    const foreign = GOOGLE_CSS.replace("https://fonts.gstatic.com/", "https://evil.test/");
    expect(localizeStylesheet(foreign)).toBeNull();
    const odd = GOOGLE_CSS.replace(LATIN, "s/lobster/v32/../../x.woff2");
    expect(localizeStylesheet(odd)).toBeNull();
  });
});

describe("GoogleFontCache", () => {
  it("fetches a family once, then serves it and its files from disk", async () => {
    const fetchFn = upstream((url) =>
      url.startsWith("https://fonts.googleapis.com/")
        ? new Response(GOOGLE_CSS)
        : new Response(new Uint8Array([1, 2, 3]))
    );
    const fonts = new GoogleFontCache(dir, logger, fetchFn as unknown as typeof fetch);

    const first = await fonts.stylesheet("Lobster");
    expect(first.status).toBe(200);
    expect(await first.text()).toContain(`url(files/${LATIN})`);
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://fonts.googleapis.com/css2?family=Lobster:wght@400;700&display=swap"
    );

    const file = await fonts.file(LATIN);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("font/woff2");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const offline = new GoogleFontCache(dir, logger, (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    expect((await offline.stylesheet("Lobster")).status).toBe(200);
    expect((await offline.file(LATIN)).status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("asks Google only for catalog families", async () => {
    const fetchFn = upstream(() => new Response(GOOGLE_CSS));
    const fonts = new GoogleFontCache(dir, logger, fetchFn as unknown as typeof fetch);
    for (const family of ["Arial", "lobster", "Lobster:wght@100", "Lobster&x=1", "", null]) {
      expect((await fonts.stylesheet(family)).status).toBe(404);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches only files a served stylesheet names", async () => {
    const fetchFn = upstream(() => new Response(new Uint8Array([1])));
    const fonts = new GoogleFontCache(dir, logger, fetchFn as unknown as typeof fetch);
    expect((await fonts.file(LATIN)).status).toBe(404);
    expect((await fonts.file("../../etc/passwd")).status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers without rules when Google cannot be reached, and tries again later", async () => {
    let online = false;
    const fetchFn = upstream(() => {
      if (!online) {
        throw new Error("offline");
      }
      return new Response(GOOGLE_CSS);
    });
    const fonts = new GoogleFontCache(dir, logger, fetchFn as unknown as typeof fetch);
    const offline = await fonts.stylesheet("Lobster");
    expect(offline.status).toBe(503);
    expect(offline.headers.get("Cache-Control")).toBe("no-store");
    online = true;
    expect((await fonts.stylesheet("Lobster")).status).toBe(200);
  });

  it("knows the files of stylesheets cached before a restart", async () => {
    const fetchFn = upstream((url) =>
      url.startsWith("https://fonts.googleapis.com/") ? new Response(GOOGLE_CSS) : new Response(new Uint8Array([7]))
    );
    await new GoogleFontCache(dir, logger, fetchFn as unknown as typeof fetch).stylesheet("Lobster");
    const restarted = new GoogleFontCache(dir, logger, fetchFn as unknown as typeof fetch);
    expect((await restarted.file(LATIN)).status).toBe(200);
  });
});
