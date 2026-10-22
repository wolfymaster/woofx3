import { describe, expect, it, mock } from "bun:test";
import type { FrameTheme } from "@woofx3/widget-host/frame";
import type { BarkloaderFrameClient } from "../../src/scene/frame-assembler";
import { FrameAssembler, HttpBarkloaderFrameClient } from "../../src/scene/frame-assembler";
import { frameVersion } from "../../src/scene/frame-catalog";

function fakeLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as any;
}

describe("HttpBarkloaderFrameClient — logging on failure", () => {
  it("logs and returns null on a non-OK response (was previously silent)", async () => {
    const warn = mock((_message: string, _meta?: unknown) => {});
    const logger = { debug: () => {}, info: () => {}, warn, error: () => {} } as any;
    const fetchFn = mock(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const client = new HttpBarkloaderFrameClient("http://barkloader.local", logger, fetchFn);

    const result = await client.fetchWidgetFrame("mymod", "mywid");
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0]!;
    expect(message).toContain("non-OK");
    expect(meta).toMatchObject({ moduleKey: "mymod", manifestId: "mywid", status: 404 });
  });

  it("logs and returns null when the response body is missing entryHtml/resourceBaseUrl", async () => {
    const warn = mock((_message: string, _meta?: unknown) => {});
    const logger = { debug: () => {}, info: () => {}, warn, error: () => {} } as any;
    const fetchFn = mock(async () => Response.json({ unexpected: true })) as unknown as typeof fetch;
    const client = new HttpBarkloaderFrameClient("http://barkloader.local", logger, fetchFn);

    const result = await client.fetchWidgetFrame("mymod", "mywid");
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("missing entryHtml");
  });

  it("gives up on a barkloader that does not answer, which the assembler serves as unavailable", async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
    const hung = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const client = new HttpBarkloaderFrameClient("http://barkloader.local", logger, hung, 10);

    await expect(client.fetchWidgetFrame("mymod", "mywid")).rejects.toThrow();
    const assembler = new FrameAssembler(logger, { barkloader: client });
    const resp = await assembler.assembleDocument("mymod", "mywid", null, null);
    expect(resp.status).toBe(502);
  });

  it("returns the parsed frame info on success without logging", async () => {
    const warn = mock((_message: string, _meta?: unknown) => {});
    const logger = { debug: () => {}, info: () => {}, warn, error: () => {} } as any;
    const fetchFn = mock(async () =>
      Response.json({ entryHtml: "<html></html>", resourceBaseUrl: "https://cdn.example.com/w/" })
    ) as unknown as typeof fetch;
    const client = new HttpBarkloaderFrameClient("http://barkloader.local", logger, fetchFn);

    const result = await client.fetchWidgetFrame("mymod", "mywid");
    expect(result).toEqual({
      entryHtml: "<html></html>",
      resourceBaseUrl: "https://cdn.example.com/w/",
      theme: null,
      fontSettings: [],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads the widget's font settings", async () => {
    const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
    const fetchFn = mock(async () =>
      Response.json({ entryHtml: "<html></html>", resourceBaseUrl: "https://e/w/", fontSettings: ["fontFamily", 3] })
    ) as unknown as typeof fetch;
    const client = new HttpBarkloaderFrameClient("http://barkloader.local", logger, fetchFn);

    const result = await client.fetchWidgetFrame("mymod", "mywid");
    expect(result?.fontSettings).toEqual(["fontFamily"]);
  });
});

describe("FrameAssembler.assembleDocument", () => {
  const info = {
    entryHtml: "<!doctype html><body></body>",
    resourceBaseUrl: "https://cdn.example.com/modules/mymod/abc123/widgets/mywid/",
    theme: null,
    fontSettings: [],
  };

  it("frames the widget with no placement in the document", async () => {
    const barkloader: BarkloaderFrameClient = {
      fetchWidgetFrame: mock(async (moduleKey: string, manifestId: string) => {
        expect(moduleKey).toBe("mymod");
        expect(manifestId).toBe("mywid");
        return info;
      }),
    };
    const assembler = new FrameAssembler(fakeLogger(), { barkloader });

    const resp = await assembler.assembleDocument("mymod", "mywid", null, frameVersion(info));
    const html = await resp.text();
    expect(html).toContain('<base href="https://cdn.example.com/modules/mymod/abc123/widgets/mywid/">');
    expect(resp.headers.get("Content-Security-Policy")).toBe("connect-src 'none'; sandbox allow-scripts");
    const boot = bootOf(html);
    expect(boot).toMatchObject({ moduleId: "mymod", widgetCanonicalId: "mymod:widget:mywid", surface: "scene" });
    expect(boot.theme).toBeNull();
    for (const placementField of ["nonce", "instanceId", "settings", "linkedResources"]) {
      expect(boot).not.toHaveProperty(placementField);
    }
  });

  it("says in Server-Timing how long barkloader took", async () => {
    let time = 0;
    const assembler = new FrameAssembler(fakeLogger(), {
      barkloader: { fetchWidgetFrame: async () => info },
      now: () => {
        time += 2;
        return time;
      },
    });
    const resp = await assembler.assembleDocument("mymod", "mywid", null, null);
    expect(resp.headers.get("Server-Timing")).toBe("frame;dur=2, total;dur=6");
  });

  it("tells the shim which settings are fonts and where their stylesheets are", async () => {
    const withFonts = { ...info, fontSettings: ["fontFamily"] };
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => withFonts) };
    const assembler = new FrameAssembler(fakeLogger(), { barkloader });

    const boot = bootOf(await (await assembler.assembleDocument("mymod", "mywid", null, null)).text());
    expect(boot.fonts).toEqual({ settings: ["fontFamily"], stylesheetUrl: "/fonts/css" });
    const plain = bootOf(
      await (
        await new FrameAssembler(fakeLogger(), {
          barkloader: { fetchWidgetFrame: mock(async () => info) },
        }).assembleDocument("mymod", "mywid", null, null)
      ).text()
    );
    expect(plain).not.toHaveProperty("fonts");
  });

  it("is cached for good while its version is current, and not otherwise", async () => {
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => info) };
    const assembler = new FrameAssembler(fakeLogger(), { barkloader });
    const current = await assembler.assembleDocument("mymod", "mywid", null, frameVersion(info));
    expect(current.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const stale = await assembler.assembleDocument("mymod", "mywid", null, "an-old-version");
    expect(stale.headers.get("Cache-Control")).toBe("no-cache");
    const unversioned = await assembler.assembleDocument("mymod", "mywid", null, null);
    expect(unversioned.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("returns 502, uncached, when barkloader has no frame for the widget", async () => {
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => null) };
    const assembler = new FrameAssembler(fakeLogger(), { barkloader });
    const resp = await assembler.assembleDocument("mymod", "mywid", null, "v");
    expect(resp.status).toBe(502);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
  });
});

function bootOf(html: string): Record<string, unknown> {
  const match = /window\.__WOOFX3_WIDGET_BOOT__ = (.*?);<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

const THEMED_BASE = "https://engine.example.com/assets/modules/timerpro/abc123/widgets/countdown/";

function frameTheme(overrides: Partial<FrameTheme> = {}): FrameTheme {
  return {
    id: "neonpack:theme:neon",
    contractVersion: 1,
    variables: { accent: "#ff2bd6", font: '"Orbitron", sans-serif' },
    assets: { background: "https://engine.example.com/assets/modules/neonpack/def/themes/neon/assets/grid.webm" },
    defaultAssets: { background: null },
    fallback: null,
    stylesheetUrl: "https://engine.example.com/assets/modules/neonpack/def/themes/neon/themes/neon.css",
    ...overrides,
  };
}

async function assembleThemed(settings: Record<string, unknown>, theme: FrameTheme | null) {
  const fetchWidgetFrame = mock(async (_moduleKey: string, _manifestId: string, _themeId?: string) => ({
    entryHtml: "<!doctype html><html><head><style>#t{}</style></head><body><script>1</script></body></html>",
    resourceBaseUrl: THEMED_BASE,
    theme,
    fontSettings: [],
  }));
  const assembler = new FrameAssembler(fakeLogger(), {
    barkloader: { fetchWidgetFrame },
  });
  const selected = typeof settings.theme === "string" ? settings.theme : null;
  const resp = await assembler.assembleDocument("timerpro", "countdown", selected, null);
  return { resp, html: await resp.text(), fetchWidgetFrame };
}

describe("FrameAssembler — widget themes", () => {
  it("asks barkloader for the theme the placement's settings select", async () => {
    const { fetchWidgetFrame } = await assembleThemed({ theme: "neonpack:theme:neon" }, frameTheme());
    expect(fetchWidgetFrame.mock.calls[0]).toEqual(["timerpro", "countdown", "neonpack:theme:neon"]);
  });

  it("asks for no theme when none is selected", async () => {
    const { fetchWidgetFrame } = await assembleThemed({}, frameTheme({ id: null, stylesheetUrl: null }));
    expect(fetchWidgetFrame.mock.calls[0]![2]).toBeUndefined();
  });

  it("sets variables and asset slots as custom properties before the widget's own styles", async () => {
    const { html } = await assembleThemed({ theme: "neonpack:theme:neon" }, frameTheme());
    const themeStyle = html.indexOf("<style data-woofx3-theme>");
    expect(themeStyle).toBeGreaterThan(0);
    expect(themeStyle).toBeLessThan(html.indexOf("<style>#t{}"));
    expect(html).toContain("--theme-accent: #ff2bd6;");
    expect(html).toContain('--theme-font: "Orbitron", sans-serif;');
    expect(html).toContain(
      '--theme-asset-background: url("https://engine.example.com/assets/modules/neonpack/def/themes/neon/assets/grid.webm");'
    );
  });

  it("links the theme stylesheet after the widget's own styles and before its scripts", async () => {
    const { html } = await assembleThemed({ theme: "neonpack:theme:neon" }, frameTheme());
    const link = html.indexOf('<link rel="stylesheet" href="https://engine.example.com/assets/modules/neonpack');
    expect(link).toBeGreaterThan(html.indexOf("<style>#t{}"));
    expect(link).toBeLessThan(html.indexOf("</head>"));
    expect(link).toBeLessThan(html.indexOf("<script>1</script>"));
  });

  it("hands the widget its theme as host.theme, without the stylesheet", async () => {
    const { html } = await assembleThemed({ theme: "neonpack:theme:neon" }, frameTheme());
    expect(bootOf(html).theme).toEqual({
      id: "neonpack:theme:neon",
      contractVersion: 1,
      variables: { accent: "#ff2bd6", font: '"Orbitron", sans-serif' },
      assets: { background: "https://engine.example.com/assets/modules/neonpack/def/themes/neon/assets/grid.webm" },
      defaultAssets: { background: null },
      fallback: null,
    });
  });

  it("restricts styles, fonts, images and media to the engine for a themeable widget", async () => {
    const { resp } = await assembleThemed({}, frameTheme({ id: null, stylesheetUrl: null }));
    const csp = resp.headers.get("Content-Security-Policy") ?? "";
    const directives = Object.fromEntries(
      csp.split(";").map((directive) => {
        const [name, ...sources] = directive.trim().split(/\s+/);
        return [name, sources];
      })
    );
    // Exact values, so the policy cannot widen without this test changing.
    expect(directives).toEqual({
      "style-src": ["'self'", "https://engine.example.com", "'unsafe-inline'"],
      "font-src": ["'self'", "https://engine.example.com", "data:"],
      "img-src": ["'self'", "https://engine.example.com", "https://static-cdn.jtvnw.net", "data:", "blob:"],
      "media-src": ["'self'", "https://engine.example.com", "data:", "blob:"],
      "connect-src": ["'none'"],
      sandbox: ["allow-scripts"],
    });
    expect(csp).toBe(
      "style-src 'self' https://engine.example.com 'unsafe-inline'; " +
        "font-src 'self' https://engine.example.com data:; " +
        "img-src 'self' https://engine.example.com https://static-cdn.jtvnw.net data: blob:; " +
        "media-src 'self' https://engine.example.com data: blob:; " +
        "connect-src 'none'; sandbox allow-scripts"
    );
    for (const sources of Object.values(directives) as string[][]) {
      for (const source of sources) {
        expect(["https:", "http:", "*"]).not.toContain(source);
      }
    }
  });

  it("renders the defaults, and still loads, when the selected theme is missing", async () => {
    const { resp, html } = await assembleThemed(
      { theme: "gone:theme:neon" },
      frameTheme({ id: null, variables: { accent: "#7ad7ff" }, assets: {}, fallback: "missing", stylesheetUrl: null })
    );
    expect(resp.status).toBe(200);
    expect(html).toContain("--theme-accent: #7ad7ff;");
    expect(html).not.toContain('rel="stylesheet"');
    expect((bootOf(html).theme as { fallback: string }).fallback).toBe("missing");
  });

  it("drops a variable value that could end the declaration", async () => {
    const { html } = await assembleThemed(
      {},
      frameTheme({ variables: { accent: "red; } body { display: none" }, stylesheetUrl: null })
    );
    const style = html.slice(html.indexOf("<style data-woofx3-theme>"), html.indexOf("<style>#t{}"));
    expect(style).not.toContain("--theme-accent");
    expect(style).not.toContain("display: none");
  });
});
