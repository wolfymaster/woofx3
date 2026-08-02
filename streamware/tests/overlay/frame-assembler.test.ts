import { describe, expect, it, mock } from "bun:test";
import {
  buildFrameScaffold,
  FrameAssembler,
  injectFrameScaffold,
  SHIM_SRC,
} from "../../src/overlay/frame-assembler";
import { sanitizeAssetPath } from "../../src/overlay/asset-proxy";
import type { FrameScaffold } from "../../src/overlay/frame-assembler";
import { BUILTIN_MODULE_KEY } from "../../src/overlay/scene-host";
import type { OverlayHost, OverlaySceneState, OverlayWidgetInstance } from "../../src/overlay/scene-host";
import { OverlayPublicUrlResolver } from "../../src/overlay/overlay-public-url-resolver";
import { ModuleVersionResolver, type ModuleVersionDb } from "../../src/overlay/module-version-resolver";

function minimalBoot(): FrameScaffold["boot"] {
  return {
    v: 1,
    nonce: "test-nonce",
    instanceId: "inst-1",
    moduleId: "mod",
    widgetCanonicalId: "mod:widget:w",
    settings: {},
    capabilities: ["storage", "events", "status"],
  };
}

// ---------------------------------------------------------------------------
// buildFrameScaffold
// ---------------------------------------------------------------------------

describe("buildFrameScaffold", () => {
  it("contains inline boot payload, shim script, and base tag in order", () => {
    const scaffold = buildFrameScaffold({ boot: minimalBoot(), baseHref: "../widget-assets/mod/w/" });
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
    // The JSON payload should have < escaped; the value in settings must not
    // appear as a literal < inside the JSON string in the boot script.
    // We check that the XSS value is escaped in the JSON portion.
    expect(scaffold).toContain("\\u003cscript>");
    // Verify the raw string "<script>" does not appear in the JSON payload
    // (only allowed as part of the wrapping <script> tag itself).
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

// ---------------------------------------------------------------------------
// injectFrameScaffold
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// sanitizeAssetPath (traversal pipeline — bound to design 5.2.9)
// ---------------------------------------------------------------------------

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
    expect(sanitizeAssetPath("assets/./hidden")).toBeNull();
  });

  it("rejects %2e%2e encoded traversal", () => {
    // After decodeURIComponent: "../../etc/passwd"
    expect(sanitizeAssetPath("%2e%2e/%2e%2e/etc/passwd")).toBeNull();
  });

  it("rejects ..%5c backslash-encoded traversal", () => {
    // After decodeURIComponent: "..\\"  -> normalized backslash to "/" -> ".." segment
    expect(sanitizeAssetPath("..%5cetc%5cpasswd")).toBeNull();
  });

  it("returns null for paths that throw during decodeURIComponent", () => {
    // A lone % that is not a valid percent-encoding sequence.
    expect(sanitizeAssetPath("%GG")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FrameAssembler.assemble — baseHref resolution (regression coverage for
// the unified overlay.publicUrl scheme: absolute for both module and
// builtin widgets, no more relative/CDN branching).
// ---------------------------------------------------------------------------

function fakeLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as any;
}

function widgetInstance(overrides: Partial<OverlayWidgetInstance>): OverlayWidgetInstance {
  return {
    id: "inst-1",
    widgetCanonicalId: "mod:widget:w",
    moduleId: "mod",
    manifestId: "w",
    position: { x: 0, y: 0, width: 100, height: 100 },
    settings: {},
    acceptedEvents: [],
    frameUrl: "",
    ...overrides,
  };
}

function fakeModuleVersions(compositeKey: string | null): ModuleVersionResolver {
  const db: ModuleVersionDb = {
    getModuleKeyForModuleId: async (_moduleId: string) => compositeKey,
  };
  return new ModuleVersionResolver(db, fakeLogger());
}

function fakeHost(state: OverlaySceneState, entry: string): OverlayHost {
  return {
    async loadScene(_token: string) {
      return state;
    },
    async lookupWidgetDefinition(moduleKey: string, manifestId: string) {
      return { moduleKey, manifestId, entry };
    },
  } as unknown as OverlayHost;
}

describe("FrameAssembler.assemble baseHref", () => {
  it("uses an absolute modules/{id}/widgets/{id}/ base href for a module widget", async () => {
    const instance = widgetInstance({ moduleId: "mymod", manifestId: "mywid" });
    const state: OverlaySceneState = {
      sceneId: "scene-1",
      applicationId: "app-1",
      name: "Scene",
      layout: {},
      instances: [instance],
    };
    const fetchFn = mock(async (_url: string) => new Response("<!doctype html><body></body>", { status: 200 }));
    const resolver = new OverlayPublicUrlResolver(null, "https://streamware.example.com", fakeLogger());
    const assembler = new FrameAssembler(fakeHost(state, "index.html"), fakeLogger(), {
      barkloaderUrl: "http://barkloader",
      publicDir: "/nonexistent",
      overlayPublicUrlResolver: resolver,
      moduleVersions: fakeModuleVersions("mymod:1.0.0:abc1234"),
      fetchFn: fetchFn as any,
    });

    const resp = await assembler.assemble("tok", "inst-1", null);
    const html = await resp.text();
    expect(html).toContain(
      '<base href="https://streamware.example.com/overlay/assets/modules/mymod/widgets/mywid/">'
    );
  });

  it("uses an absolute builtin/widgets/{id}/ base href for a builtin widget, served from repository-seeded local disk", async () => {
    const instance = widgetInstance({ moduleId: BUILTIN_MODULE_KEY, manifestId: "media_alert" });
    const state: OverlaySceneState = {
      sceneId: "scene-1",
      applicationId: "app-1",
      name: "Scene",
      layout: {},
      instances: [instance],
    };
    const resolver = new OverlayPublicUrlResolver(null, "https://streamware.example.com", fakeLogger());
    const assembler = new FrameAssembler(fakeHost(state, "index.html"), fakeLogger(), {
      barkloaderUrl: "http://barkloader",
      // Real public dir — builtin/media_alert/index.html genuinely exists
      // here, so this exercises readBuiltinEntry's actual local-disk read
      // (kept as-is per design: the repository upload is for the
      // browser-facing proxy route, not streamware's own HTML assembly).
      publicDir: `${import.meta.dir}/../../public`,
      overlayPublicUrlResolver: resolver,
      moduleVersions: null,
    });

    const resp = await assembler.assemble("tok", "inst-1", null);
    const html = await resp.text();
    expect(html).toContain(
      '<base href="https://streamware.example.com/overlay/assets/builtin/widgets/media_alert/">'
    );
  });
});
