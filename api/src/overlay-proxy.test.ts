import { describe, expect, it } from "bun:test";
import { buildUpstreamUrl, maskToken, parseOverlayWsPath, proxyRequest } from "./overlay-proxy";

// Minimal SharedLogger stub for testing.
const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
  withContext: () => noopLogger,
} as any;

// ---------------------------------------------------------------------------
// maskToken
// ---------------------------------------------------------------------------

describe("maskToken", () => {
  it("short token (<=8 chars) keeps first 4 chars", () => {
    expect(maskToken("abcd1234")).toBe("abcd…");
  });

  it("long token (>8 chars) keeps first 8 chars", () => {
    expect(maskToken("ovl_abcdefghijklmnop")).toBe("ovl_abcd…");
  });

  it("very short token (4 chars) keeps first 4 chars", () => {
    expect(maskToken("abcd")).toBe("abcd…");
  });

  it("exactly 8 chars is treated as short", () => {
    expect(maskToken("12345678")).toBe("1234…");
  });

  it("9 chars is treated as long", () => {
    expect(maskToken("123456789")).toBe("12345678…");
  });
});

// ---------------------------------------------------------------------------
// buildUpstreamUrl
// ---------------------------------------------------------------------------

describe("buildUpstreamUrl", () => {
  it("rewrites /overlay/{token}/config to /o/{token}/config", () => {
    const result = buildUpstreamUrl("http://localhost:9101", "/overlay/tok123/config");
    expect(result).toBe("http://localhost:9101/o/tok123/config");
  });

  it("rewrites /overlay/{token}/ (trailing slash) to /o/{token}/", () => {
    const result = buildUpstreamUrl("http://localhost:9101", "/overlay/tok123/");
    expect(result).toBe("http://localhost:9101/o/tok123/");
  });

  it("rewrites /overlay/{token}/nested/path to /o/{token}/nested/path", () => {
    const result = buildUpstreamUrl("http://streamware.local:9101", "/overlay/abc/nested/path");
    expect(result).toBe("http://streamware.local:9101/o/abc/nested/path");
  });

  it("preserves query string", () => {
    const result = buildUpstreamUrl("http://localhost:9101", "/overlay/tok/widgets?foo=bar");
    expect(result).toBe("http://localhost:9101/o/tok/widgets?foo=bar");
  });

  it("strips trailing slash from streamware base before joining", () => {
    const result = buildUpstreamUrl("http://localhost:9101/", "/overlay/tok/index.html");
    expect(result).toBe("http://localhost:9101/o/tok/index.html");
  });

  it("throws when path does not start with /overlay/", () => {
    expect(() => buildUpstreamUrl("http://localhost:9101", "/notoverlay/tok/")).toThrow(
      "path must start with /overlay/"
    );
  });
});

// ---------------------------------------------------------------------------
// parseOverlayWsPath
// ---------------------------------------------------------------------------

describe("parseOverlayWsPath", () => {
  it("returns upstreamUrl and token for /overlay/{token}/events", () => {
    const result = parseOverlayWsPath("/overlay/tok123/events", "http://localhost:9101");
    expect(result).not.toBeNull();
    expect(result!.token).toBe("tok123");
    expect(result!.upstreamUrl).toBe("ws://localhost:9101/o/tok123/events");
  });

  it("converts https base to wss upstream", () => {
    const result = parseOverlayWsPath("/overlay/tok/events", "https://streamware.example.com");
    expect(result).not.toBeNull();
    expect(result!.upstreamUrl).toBe("wss://streamware.example.com/o/tok/events");
  });

  it("returns null for non-events WS path", () => {
    expect(parseOverlayWsPath("/overlay/tok/other", "http://localhost:9101")).toBeNull();
  });

  it("returns null for /api path", () => {
    expect(parseOverlayWsPath("/api", "http://localhost:9101")).toBeNull();
  });

  it("returns null for /overlay/{token} without events", () => {
    expect(parseOverlayWsPath("/overlay/tok", "http://localhost:9101")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// proxyRequest — redirect for bare token path
// ---------------------------------------------------------------------------

describe("proxyRequest - trailing-slash redirect", () => {
  it("GET /overlay/{token} (no trailing slash) → 302 redirect", async () => {
    const req = new Request("http://localhost:8080/overlay/tok123");
    const resp = await proxyRequest(req, "http://localhost:9101", noopLogger);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("location")).toBe("./tok123/");
  });
});

// ---------------------------------------------------------------------------
// proxyRequest — 405 for non-GET/HEAD
// ---------------------------------------------------------------------------

describe("proxyRequest - method enforcement", () => {
  it("POST to /overlay/ path → 405", async () => {
    const req = new Request("http://localhost:8080/overlay/tok123/", { method: "POST" });
    const resp = await proxyRequest(req, "http://localhost:9101", noopLogger);
    expect(resp.status).toBe(405);
    expect(resp.headers.get("allow")).toBe("GET, HEAD");
  });

  it("DELETE to /overlay/ path → 405", async () => {
    const req = new Request("http://localhost:8080/overlay/tok/", { method: "DELETE" });
    const resp = await proxyRequest(req, "http://localhost:9101", noopLogger);
    expect(resp.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// proxyRequest — header forwarding with mocked fetch
// ---------------------------------------------------------------------------

describe("proxyRequest - header forwarding", () => {
  it("strips X-Woofx3-* headers from inbound request", async () => {
    let capturedHeaders: Headers | null = null;
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedHeaders = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers as HeadersInit);
      return new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

    const req = new Request("http://localhost:8080/overlay/tok123/", {
      headers: {
        "X-Woofx3-Secret": "should-be-dropped",
        "accept": "text/html",
      },
    });
    await proxyRequest(req, "http://localhost:9101", noopLogger, mockFetch as unknown as typeof fetch);

    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get("x-woofx3-secret")).toBeNull();
    expect(capturedHeaders!.get("accept")).toBe("text/html");
  });

  it("strips hop-by-hop headers from inbound request", async () => {
    let capturedHeaders: Headers | null = null;
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedHeaders = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers as HeadersInit);
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    };

    const req = new Request("http://localhost:8080/overlay/tok/", {
      headers: {
        "connection": "keep-alive",
        "keep-alive": "timeout=5",
        "accept": "text/html",
      },
    });
    await proxyRequest(req, "http://localhost:9101", noopLogger, mockFetch as unknown as typeof fetch);

    expect(capturedHeaders!.get("connection")).toBeNull();
    expect(capturedHeaders!.get("keep-alive")).toBeNull();
    expect(capturedHeaders!.get("accept")).toBe("text/html");
  });

  it("injects Cache-Control: no-store and Referrer-Policy on HTML responses", async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response("<html></html>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      });
    };

    const req = new Request("http://localhost:8080/overlay/tok/");
    const resp = await proxyRequest(req, "http://localhost:9101", noopLogger, mockFetch as unknown as typeof fetch);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(resp.headers.get("referrer-policy")).toBe("no-referrer");
    expect(resp.headers.get("x-robots-tag")).toBe("noindex");
    // Streamware CORS/CORP headers must be forwarded verbatim.
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("does NOT inject security headers on non-HTML responses", async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = new Request("http://localhost:8080/overlay/tok/widget-data");
    const resp = await proxyRequest(req, "http://localhost:9101", noopLogger, mockFetch as unknown as typeof fetch);

    expect(resp.headers.get("cache-control")).toBeNull();
    expect(resp.headers.get("referrer-policy")).toBeNull();
  });

  it("returns 502 when upstream fetch throws", async () => {
    const mockFetch = async (): Promise<Response> => {
      throw new Error("connection refused");
    };

    const req = new Request("http://localhost:8080/overlay/tok/");
    const resp = await proxyRequest(req, "http://localhost:9101", noopLogger, mockFetch as unknown as typeof fetch);
    expect(resp.status).toBe(502);
  });

  it("forwards all non-hop-by-hop upstream response headers", async () => {
    const mockFetch = async (): Promise<Response> => {
      return new Response("ok", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "cross-origin-resource-policy": "cross-origin",
          "access-control-allow-origin": "*",
          "x-custom-header": "value",
          "transfer-encoding": "chunked",
        },
      });
    };

    const req = new Request("http://localhost:8080/overlay/tok/asset.js");
    const resp = await proxyRequest(req, "http://localhost:9101", noopLogger, mockFetch as unknown as typeof fetch);

    expect(resp.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("x-custom-header")).toBe("value");
    // Hop-by-hop must be stripped from upstream response.
    expect(resp.headers.get("transfer-encoding")).toBeNull();
  });
});
