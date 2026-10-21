import { describe, expect, it } from "bun:test";
import {
  buildFrameScaffold,
  type FrameScaffold,
  frameDocument,
  injectFrameScaffold,
  SHIM_SRC,
} from "../frame/document";
import type { FrameTheme } from "../frame/theme";

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

describe("frameDocument", () => {
  const source = {
    entryHtml: "<html><head></head><body></body></html>",
    resourceBaseUrl: "https://cdn.example.com/mod/w/",
  };

  it("closes connections and sandboxes the frame, whatever it holds", () => {
    const { html, headers } = frameDocument({ ...source, theme: null }, minimalBoot());
    expect(headers["Content-Security-Policy"]).toBe("connect-src 'none'; sandbox allow-scripts");
    expect(headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Cache-Control"]).toBeUndefined();
    expect(html.indexOf(SHIM_SRC)).toBeGreaterThan(html.indexOf("<head>"));
  });

  it("puts a themeable widget under the theme policy, with its variables and stylesheet", () => {
    const theme = {
      id: "mod:theme:dark",
      contractVersion: 1,
      variables: { accent: "#f00" },
      assets: {},
      defaultAssets: {},
      fallback: undefined,
      stylesheetUrl: "https://themes.example.com/dark.css",
    } as unknown as FrameTheme;
    const { html, headers } = frameDocument({ ...source, theme }, minimalBoot());
    const policy = headers["Content-Security-Policy"];
    expect(policy).toContain("style-src 'self' https://cdn.example.com https://themes.example.com 'unsafe-inline'");
    expect(policy).toContain("connect-src 'none'");
    expect(html).toContain("--theme-accent: #f00;");
    expect(html.indexOf("dark.css")).toBeLessThan(html.indexOf("</head>"));
  });
});
