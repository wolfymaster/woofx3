import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, mock } from "bun:test";
import {
  buildFrameScaffold,
  FrameAssembler,
  HttpBarkloaderFrameClient,
  injectFrameScaffold,
  SHIM_SRC,
} from "../../src/scene/frame-assembler";
import type { BarkloaderFrameClient, FrameScaffold } from "../../src/scene/frame-assembler";
import { sanitizeAssetPath } from "../../src/scene/asset-path";
import type { OverlayHost, OverlaySceneState, OverlayWidgetInstance } from "../../src/scene/scene-host";
import { PublicUrlResolver } from "../../src/scene/public-url-resolver";

function fakePublicUrlResolver(url = "https://scene.example.com"): PublicUrlResolver {
  return new PublicUrlResolver(null, url, {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as any);
}

function minimalBoot(): FrameScaffold["boot"] {
  return {
    v: 1,
    nonce: "test-nonce",
    instanceId: "inst-1",
    moduleId: "mod",
    widgetCanonicalId: "mod:widget:w",
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

  it("escapes & and \" in baseHref attribute", () => {
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

describe("sanitizeAssetPath", () => {
  it("passes normal relative paths unchanged", () => {
    expect(sanitizeAssetPath("index.html")).toBe("index.html");
    expect(sanitizeAssetPath("assets/main.js")).toBe("assets/main.js");
  });

  it("strips a leading slash", () => {
    expect(sanitizeAssetPath("/index.html")).toBe("index.html");
  });

  it("collapses multiple slashes", () => {
    expect(sanitizeAssetPath("a//b///c.js")).toBe("a/b/c.js");
  });

  it("rejects a .. segment", () => {
    expect(sanitizeAssetPath("../../etc/passwd")).toBeNull();
    expect(sanitizeAssetPath("assets/../secret")).toBeNull();
  });

  it("rejects a . segment", () => {
    expect(sanitizeAssetPath("./index.html")).toBeNull();
  });

  it("rejects %2e%2e encoded traversal", () => {
    expect(sanitizeAssetPath("%2e%2e/%2e%2e/etc/passwd")).toBeNull();
  });

  it("rejects ..%5c backslash-encoded traversal", () => {
    expect(sanitizeAssetPath("..%5cetc%5cpasswd")).toBeNull();
  });

  it("returns null for paths that throw during decodeURIComponent", () => {
    expect(sanitizeAssetPath("%GG")).toBeNull();
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
    expect(result).toEqual({ entryHtml: "<html></html>", resourceBaseUrl: "https://cdn.example.com/w/" });
    expect(warn).not.toHaveBeenCalled();
  });
});

function widgetInstance(overrides: Partial<OverlayWidgetInstance>): OverlayWidgetInstance {
  return {
    id: "inst-1",
    widgetCanonicalId: "mod:widget:w",
    moduleId: "mod",
    manifestId: "w",
    position: { x: 0, y: 0, width: 100, height: 100 },
    settings: {},
    resolved: true,
    acceptedEvents: [],
    frameUrl: "",
    ...overrides,
  };
}

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

describe("FrameAssembler.assemble", () => {
  it("fetches module widget entry+resourceBaseUrl from Barkloader and uses it as <base href>", async () => {
    const instance = widgetInstance({ moduleId: "mymod", manifestId: "mywid" });
    const state: OverlaySceneState = {
      sceneId: "scene-1",
      applicationId: "app-1",
      name: "Scene",
      layout: {},
      instances: [instance],
    };
    const barkloader: BarkloaderFrameClient = {
      fetchWidgetFrame: mock(async (moduleKey: string, manifestId: string) => {
        expect(moduleKey).toBe("mymod");
        expect(manifestId).toBe("mywid");
        return {
          entryHtml: "<!doctype html><body></body>",
          resourceBaseUrl: "https://cdn.example.com/modules/mymod/abc123/widgets/mywid/",
        };
      }),
    };
    const assembler = new FrameAssembler(fakeHost(state, "index.html"), fakeLogger(), {
      barkloader,
      publicDir: "/nonexistent",
      selfPublicUrlResolver: fakePublicUrlResolver(),
    });

    const resp = await assembler.assemble("scene-1", "inst-1", null);
    const html = await resp.text();
    expect(html).toContain('<base href="https://cdn.example.com/modules/mymod/abc123/widgets/mywid/">');
    expect(barkloader.fetchWidgetFrame).toHaveBeenCalledTimes(1);
  });

  it("returns 502 (uniform blank-adjacent doc) when Barkloader has no frame info for the module widget", async () => {
    const instance = widgetInstance({ moduleId: "mymod", manifestId: "mywid" });
    const state: OverlaySceneState = {
      sceneId: "scene-1",
      applicationId: "app-1",
      name: "Scene",
      layout: {},
      instances: [instance],
    };
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => null) };
    const assembler = new FrameAssembler(fakeHost(state, "index.html"), fakeLogger(), {
      barkloader,
      publicDir: "/nonexistent",
      selfPublicUrlResolver: fakePublicUrlResolver(),
    });
    const resp = await assembler.assemble("scene-1", "inst-1", null);
    expect(resp.status).toBe(502);
  });

  it("returns the uniform blank document for an unknown scene", async () => {
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => null) };
    const host = { async loadSceneById() { return null; } } as unknown as OverlayHost;
    const assembler = new FrameAssembler(host, fakeLogger(), {
      barkloader,
      publicDir: "/nonexistent",
      selfPublicUrlResolver: fakePublicUrlResolver(),
    });
    const resp = await assembler.assemble("nope", "inst-1", null);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("<!doctype html><html><head></head><body></body></html>");
  });

  it("returns the same uniform blank document for a valid scene with an unknown instance id", async () => {
    const state: OverlaySceneState = {
      sceneId: "scene-1",
      applicationId: "app-1",
      name: "Scene",
      layout: {},
      instances: [],
    };
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => null) };
    const assembler = new FrameAssembler(fakeHost(state, "index.html"), fakeLogger(), {
      barkloader,
      publicDir: "/nonexistent",
      selfPublicUrlResolver: fakePublicUrlResolver(),
    });
    const resp = await assembler.assemble("scene-1", "missing-instance", null);
    expect(await resp.text()).toBe("<!doctype html><html><head></head><body></body></html>");
  });

});
