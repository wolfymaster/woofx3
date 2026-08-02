import { describe, expect, it, mock } from "bun:test";
import { sanitizeAssetPath, WidgetAssetProxy } from "../../src/overlay/asset-proxy";
import { ModuleVersionResolver, type ModuleVersionDb } from "../../src/overlay/module-version-resolver";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

/** A `ModuleVersionDb` that always resolves to the given composite module key. */
function fakeDb(compositeKey: string | null): ModuleVersionDb {
  return {
    getModuleKeyForModuleId: mock(async (_moduleId: string) => compositeKey),
  };
}

function resolverFor(compositeKey: string | null, logger = fakeLogger()): ModuleVersionResolver {
  return new ModuleVersionResolver(fakeDb(compositeKey), logger);
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

describe("WidgetAssetProxy.proxyModuleWidgetAsset", () => {
  it("returns 404 when moduleKey fails sanitization", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), resolverFor("mod:1.0.0:abc1234"));
    const resp = await proxy.proxyModuleWidgetAsset("../evil", "w", "index.html");
    expect(resp.status).toBe(404);
  });

  it("returns 404 when manifestId fails sanitization", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), resolverFor("mod:1.0.0:abc1234"));
    const resp = await proxy.proxyModuleWidgetAsset("mod", "../../etc", "index.html");
    expect(resp.status).toBe(404);
  });

  it("returns 404 when tail fails sanitization", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), resolverFor("mod:1.0.0:abc1234"));
    const resp = await proxy.proxyModuleWidgetAsset("mod", "w", "../../passwd");
    expect(resp.status).toBe(404);
  });

  it("returns 404 when the module's current version can't be resolved (no resolver configured)", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), null);
    const resp = await proxy.proxyModuleWidgetAsset("mod", "w", "index.html");
    expect(resp.status).toBe(404);
  });

  it("returns 404 when the module lookup resolves to nothing (module not installed)", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), resolverFor(null));
    const resp = await proxy.proxyModuleWidgetAsset("mod", "w", "index.html");
    expect(resp.status).toBe(404);
  });

  it("proxies a successful barkloader response, injecting the resolved version dir", async () => {
    const fakeFetch = mock(async (_url: string) => {
      return new Response("body-content", {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    });
    const proxy = new WidgetAssetProxy(
      "http://barkloader",
      fakeLogger(),
      resolverFor("mymod:1.0.0:abc1234"),
      fakeFetch as any
    );
    const resp = await proxy.proxyModuleWidgetAsset("mymod", "mywid", "index.js");
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/javascript");
    const body = await resp.text();
    expect(body).toBe("body-content");

    // Verify the URL was assembled correctly, including the version dir
    // (the trailing hash segment of the composite module key).
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const calledUrl = (fakeFetch.mock.calls[0] as string[])[0];
    expect(calledUrl).toContain("/assets/modules/mymod/abc1234/widgets/mywid/index.js");
  });

  it("caches the resolved version dir across requests within the TTL", async () => {
    const fakeFetch = mock(async (_url: string) => new Response("ok", { status: 200 }));
    const db = fakeDb("mymod:1.0.0:abc1234");
    const resolver = new ModuleVersionResolver(db, fakeLogger());
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), resolver, fakeFetch as any);
    await proxy.proxyModuleWidgetAsset("mymod", "mywid", "a.js");
    await proxy.proxyModuleWidgetAsset("mymod", "mywid", "b.js");
    expect(db.getModuleKeyForModuleId).toHaveBeenCalledTimes(1);
  });

  it("re-resolves after invalidateAll()", async () => {
    const fakeFetch = mock(async (_url: string) => new Response("ok", { status: 200 }));
    const db = fakeDb("mymod:1.0.0:abc1234");
    const resolver = new ModuleVersionResolver(db, fakeLogger());
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), resolver, fakeFetch as any);
    await proxy.proxyModuleWidgetAsset("mymod", "mywid", "a.js");
    resolver.invalidateAll();
    await proxy.proxyModuleWidgetAsset("mymod", "mywid", "b.js");
    expect(db.getModuleKeyForModuleId).toHaveBeenCalledTimes(2);
  });

  it("returns 404 when barkloader returns 404", async () => {
    const fakeFetch = mock(async (_url: string) => {
      return new Response(null, { status: 404 });
    });
    const proxy = new WidgetAssetProxy(
      "http://barkloader",
      fakeLogger(),
      resolverFor("mod:1.0.0:abc1234"),
      fakeFetch as any
    );
    const resp = await proxy.proxyModuleWidgetAsset("mod", "w", "missing.js");
    expect(resp.status).toBe(404);
  });

  it("returns 502 when fetch throws", async () => {
    const fakeFetch = mock(async (_url: string) => {
      throw new Error("ECONNREFUSED");
    });
    const logger = fakeLogger();
    const proxy = new WidgetAssetProxy(
      "http://barkloader",
      logger,
      resolverFor("mod:1.0.0:abc1234"),
      fakeFetch as any
    );
    const resp = await proxy.proxyModuleWidgetAsset("mod", "w", "file.js");
    expect(resp.status).toBe(502);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("WidgetAssetProxy.proxyModuleAsset", () => {
  it("returns 404 when moduleKey or tail fails sanitization", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), resolverFor("mod:1.0.0:abc1234"));
    expect((await proxy.proxyModuleAsset("../evil", "bell.mp3")).status).toBe(404);
    expect((await proxy.proxyModuleAsset("mod", "../../etc/passwd")).status).toBe(404);
  });

  it("assembles the modules/{id}/{versionDir}/assets/{tail} URL", async () => {
    const fakeFetch = mock(async (_url: string) => new Response("bytes", { status: 200 }));
    const proxy = new WidgetAssetProxy(
      "http://barkloader",
      fakeLogger(),
      resolverFor("mymod:1.0.0:abc1234"),
      fakeFetch as any
    );
    const resp = await proxy.proxyModuleAsset("mymod", "bell.mp3");
    expect(resp.status).toBe(200);
    const calledUrl = (fakeFetch.mock.calls[0] as string[])[0];
    expect(calledUrl).toContain("/assets/modules/mymod/abc1234/assets/bell.mp3");
  });
});

describe("WidgetAssetProxy.proxyBuiltinWidgetAsset", () => {
  it("returns 404 when manifestId or tail fails sanitization", async () => {
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger());
    expect((await proxy.proxyBuiltinWidgetAsset("../evil", "index.html")).status).toBe(404);
    expect((await proxy.proxyBuiltinWidgetAsset("media_alert", "../../etc")).status).toBe(404);
  });

  it("assembles the builtin/widgets/{id}/{tail} URL — no module key or version segment", async () => {
    const fakeFetch = mock(async (_url: string) => new Response("bytes", { status: 200 }));
    const proxy = new WidgetAssetProxy("http://barkloader", fakeLogger(), null, fakeFetch as any);
    const resp = await proxy.proxyBuiltinWidgetAsset("media_alert", "index.html");
    expect(resp.status).toBe(200);
    const calledUrl = (fakeFetch.mock.calls[0] as string[])[0];
    expect(calledUrl).toContain("/assets/builtin/widgets/media_alert/index.html");
  });
});
