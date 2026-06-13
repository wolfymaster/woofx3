import { describe, expect, it, mock } from "bun:test";
import { sanitizeAssetPath, WidgetAssetProxy } from "./widget-asset-proxy";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

// ---------------------------------------------------------------------------
// sanitizeAssetPath — traversal rejection cases
// ---------------------------------------------------------------------------

describe("sanitizeAssetPath traversal rejection", () => {
  it("rejects .. segment", () => {
    expect(sanitizeAssetPath("../secret")).toBeNull();
    expect(sanitizeAssetPath("a/../b")).toBeNull();
  });

  it("rejects . segment", () => {
    expect(sanitizeAssetPath("./index.html")).toBeNull();
  });

  it("rejects %2e%2e encoded as ..", () => {
    expect(sanitizeAssetPath("%2e%2e/secret")).toBeNull();
  });

  it("rejects ..%5c (backslash-encoded) traversal", () => {
    expect(sanitizeAssetPath("..%5cetc")).toBeNull();
  });

  it("returns null for invalid percent encoding", () => {
    expect(sanitizeAssetPath("%ZZ")).toBeNull();
  });

  it("accepts normal paths", () => {
    expect(sanitizeAssetPath("index.html")).toBe("index.html");
    expect(sanitizeAssetPath("assets/style.css")).toBe("assets/style.css");
  });
});

// ---------------------------------------------------------------------------
// WidgetAssetProxy
// ---------------------------------------------------------------------------

describe("WidgetAssetProxy.proxy", () => {
  it("returns 404 when moduleKey fails sanitization", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger());
    const resp = await proxy.proxy("../evil", "w", "index.html");
    expect(resp.status).toBe(404);
  });

  it("returns 404 when manifestId fails sanitization", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger());
    const resp = await proxy.proxy("mod", "../../etc", "index.html");
    expect(resp.status).toBe(404);
  });

  it("returns 404 when tail fails sanitization", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger());
    const resp = await proxy.proxy("mod", "w", "../../passwd");
    expect(resp.status).toBe(404);
  });

  it("proxies a successful barkloader response", async () => {
    const fakeFetch = mock(async (_url: string) => {
      return new Response("body-content", {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), fakeFetch as any);
    const resp = await proxy.proxy("mymod", "mywid", "index.js");
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/javascript");
    const body = await resp.text();
    expect(body).toBe("body-content");

    // Verify the URL was assembled correctly.
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const calledUrl = (fakeFetch.mock.calls[0] as string[])[0];
    expect(calledUrl).toContain("/assets/modules/mymod/widgets/mywid/index.js");
  });

  it("returns 404 when barkloader returns 404", async () => {
    const fakeFetch = mock(async (_url: string) => {
      return new Response(null, { status: 404 });
    });
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), fakeFetch as any);
    const resp = await proxy.proxy("mod", "w", "missing.js");
    expect(resp.status).toBe(404);
  });

  it("returns 502 when fetch throws", async () => {
    const fakeFetch = mock(async (_url: string) => {
      throw new Error("ECONNREFUSED");
    });
    const logger = fakeLogger();
    const proxy = new WidgetAssetProxy("http://barkloader", logger, fakeFetch as any);
    const resp = await proxy.proxy("mod", "w", "file.js");
    expect(resp.status).toBe(502);
    expect(logger.warn).toHaveBeenCalled();
  });
});
