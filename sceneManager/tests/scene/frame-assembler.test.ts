import { describe, expect, it, mock } from "bun:test";
import {
  buildFrameScaffold,
  FrameAssembler,
  HttpBarkloaderFrameClient,
  injectFrameScaffold,
  SHIM_SRC,
} from "../../src/scene/frame-assembler";
import { frameVersion } from "../../src/scene/frame-catalog";
import type { BarkloaderFrameClient, FrameScaffold } from "../../src/scene/frame-assembler";
import type { FrameTheme } from "../../src/scene/widget-theme";
import type { OverlayHost, OverlaySceneState } from "../../src/scene/scene-host";

function minimalBoot(): FrameScaffold["boot"] {
  return {
    v: 1,
    nonce: "test-nonce",
    instanceId: "inst-1",
    moduleId: "mod",
    widgetCanonicalId: "mod:widget:w",
    surface: "scene",
    settings: {},
    capabilities: ["storage", "events", "status"],
    resourceBaseUrl: "https://cdn.example.com/mod/w/",
  };
}

describe("buildFrameScaffold", () => {
  it("contains inline boot payload, shim script, and base tag in order", () => {
    const scaffold = buildFrameScaffold({ boot: minimalBoot(), baseHref: "https://cdn.example.com/mod/w/" });
    const bootIdx = scaffold.indexOf("window.__WOOFX3_WIDGET_BOOT__");
    const shimIdx = scaffold.indexOf(SHIM_SRC);
    const baseIdx = scaffold.indexOf("<base ");
    expect(bootIdx).toBeGreaterThanOrEqual(0);
    expect(shimIdx).toBeGreaterThan(bootIdx);
    expect(baseIdx).toBeGreaterThan(shimIdx);
  });

  it("escapes < in boot payload JSON to \\u003c", () => {
    const boot = minimalBoot();
    (boot as any).settings = { xss: "<script>" };
    const scaffold = buildFrameScaffold({ boot, baseHref: "/" });
    expect(scaffold).toContain("\\u003cscript>");
    const bootJsonStart = scaffold.indexOf("window.__WOOFX3_WIDGET_BOOT__");
    const bootJsonEnd = scaffold.indexOf(";</script>", bootJsonStart);
    const bootJsonStr = scaffold.slice(bootJsonStart, bootJsonEnd);
    expect(bootJsonStr).not.toContain("<script>");
  });

  it('escapes & and " in baseHref attribute', () => {
    const scaffold = buildFrameScaffold({
      boot: minimalBoot(),
      baseHref: 'https://cdn.example.com/&foo"bar',
    });
    expect(scaffold).toContain("&amp;");
    expect(scaffold).toContain("&quot;");
    expect(scaffold).not.toContain('"bar"');
  });
});

describe("injectFrameScaffold", () => {
  it("injects after <head> when present", () => {
    const html = "<html><head><title>T</title></head><body></body></html>";
    const result = injectFrameScaffold(html, "INJECTED");
    expect(result).toBe("<html><head>INJECTED<title>T</title></head><body></body></html>");
  });

  it("handles <head> with attributes (head-open injection)", () => {
    const html = '<html><head lang="en"><title>T</title></head></html>';
    const result = injectFrameScaffold(html, "INJECTED");
    expect(result.indexOf("INJECTED")).toBe(result.indexOf('<head lang="en">') + '<head lang="en">'.length);
  });

  it("synthesizes <head> after <html> when no head tag exists", () => {
    const html = "<html><body>content</body></html>";
    const result = injectFrameScaffold(html, "INJECTED");
    expect(result).toContain("<html><head>INJECTED</head><body>content</body></html>");
  });

  it("injects after doctype when neither <html> nor <head> is present", () => {
    const html = "<!doctype html><body>content</body>";
    const result = injectFrameScaffold(html, "INJECTED");
    expect(result).toBe("<!doctype html>INJECTED<body>content</body>");
  });

  it("injects at the very front when there is nothing to anchor to", () => {
    const html = "<body>bare</body>";
    const result = injectFrameScaffold(html, "INJECTED");
    expect(result).toBe("INJECTED<body>bare</body>");
  });

  it("preserves a leading BOM", () => {
    const bom = "﻿";
    const html = bom + "<html><head></head><body></body></html>";
    const result = injectFrameScaffold(html, "INJECTED");
    expect(result.charCodeAt(0)).toBe(0xfeff);
    expect(result).toContain("INJECTED");
  });
});

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

function fakeHost(state: OverlaySceneState, entry: string): OverlayHost {
  return {
    async loadSceneById(_sceneId: string) {
      return state;
    },
    async lookupWidgetDefinition(moduleKey: string, manifestId: string) {
      return { moduleKey, manifestId, entry };
    },
  } as unknown as OverlayHost;
}

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
    const assembler = new FrameAssembler(fakeHost(emptyState(), "index.html"), fakeLogger(), { barkloader });

    const resp = await assembler.assembleDocument("mymod", "mywid", null, frameVersion(info));
    const html = await resp.text();
    expect(html).toContain('<base href="https://cdn.example.com/modules/mymod/abc123/widgets/mywid/">');
    expect(resp.headers.get("Content-Security-Policy")).toBeNull();
    const boot = bootOf(html);
    expect(boot).toMatchObject({ moduleId: "mymod", widgetCanonicalId: "mymod:widget:mywid", surface: "scene" });
    expect(boot.theme).toBeNull();
    for (const placementField of ["nonce", "instanceId", "settings", "linkedResources"]) {
      expect(boot).not.toHaveProperty(placementField);
    }
  });

  it("tells the shim which settings are fonts and where their stylesheets are", async () => {
    const withFonts = { ...info, fontSettings: ["fontFamily"] };
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => withFonts) };
    const assembler = new FrameAssembler(fakeHost(emptyState(), "index.html"), fakeLogger(), { barkloader });

    const boot = bootOf(await (await assembler.assembleDocument("mymod", "mywid", null, null)).text());
    expect(boot.fonts).toEqual({ settings: ["fontFamily"], stylesheetUrl: "/fonts/css" });
    const plain = bootOf(
      await (
        await new FrameAssembler(fakeHost(emptyState(), "index.html"), fakeLogger(), {
          barkloader: { fetchWidgetFrame: mock(async () => info) },
        }).assembleDocument("mymod", "mywid", null, null)
      ).text()
    );
    expect(plain).not.toHaveProperty("fonts");
  });

  it("is cached for good while its version is current, and not otherwise", async () => {
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => info) };
    const assembler = new FrameAssembler(fakeHost(emptyState(), "index.html"), fakeLogger(), { barkloader });
    const current = await assembler.assembleDocument("mymod", "mywid", null, frameVersion(info));
    expect(current.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const stale = await assembler.assembleDocument("mymod", "mywid", null, "an-old-version");
    expect(stale.headers.get("Cache-Control")).toBe("no-cache");
    const unversioned = await assembler.assembleDocument("mymod", "mywid", null, null);
    expect(unversioned.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("returns 502, uncached, when barkloader has no frame for the widget", async () => {
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => null) };
    const assembler = new FrameAssembler(fakeHost(emptyState(), "index.html"), fakeLogger(), { barkloader });
    const resp = await assembler.assembleDocument("mymod", "mywid", null, "v");
    expect(resp.status).toBe(502);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
  });
});

function emptyState(): OverlaySceneState {
  return { sceneId: "scene-1", name: "Scene", layout: {}, instances: [] };
}

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
  const assembler = new FrameAssembler(fakeHost(emptyState(), "index.html"), fakeLogger(), {
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

  it("restricts styles and fonts to the engine, and lets images and media come from any http(s) host", async () => {
    const { resp } = await assembleThemed({}, frameTheme({ id: null, stylesheetUrl: null }));
    const csp = resp.headers.get("Content-Security-Policy");
    expect(csp).toContain("style-src 'self' https://engine.example.com 'unsafe-inline'");
    expect(csp).toContain("font-src 'self' https://engine.example.com data:");
    expect(csp).toContain("img-src 'self' https://engine.example.com https: http: data: blob:");
    expect(csp).toContain("media-src 'self' https://engine.example.com https: http: data: blob:");
    expect(csp).not.toContain("script-src");
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
