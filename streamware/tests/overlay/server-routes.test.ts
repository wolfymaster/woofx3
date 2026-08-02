import { describe, expect, it, mock } from "bun:test";
import { handleAssetRoutes, normalizeOverlayPrefix } from "../../src/server";

function fakeLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as any;
}

function req(path: string): { req: Request; url: URL } {
  const url = new URL(`http://localhost${path}`);
  return { req: new Request(url), url };
}

function fakeProxy() {
  return {
    proxyModuleWidgetAsset: mock(async () => new Response(null, { status: 404 })),
    proxyModuleAsset: mock(async () => new Response(null, { status: 404 })),
    proxyBuiltinWidgetAsset: mock(async () => new Response(null, { status: 404 })),
  };
}

describe("handleAssetRoutes — unified, public modules/builtin/user asset routes", () => {
  it("proxies to proxyModuleWidgetAsset", async () => {
    const proxy = fakeProxy();
    proxy.proxyModuleWidgetAsset = mock(async () => new Response("ok", { status: 200 }));
    const { req: request, url } = req("/o/assets/modules/mymod/widgets/mywid/index.js");

    const resp = await handleAssetRoutes(request, url, proxy as any, fakeLogger());

    expect(resp.status).toBe(200);
    expect(proxy.proxyModuleWidgetAsset).toHaveBeenCalledWith("mymod", "mywid", "index.js");
  });

  it("proxies to proxyModuleAsset", async () => {
    const proxy = fakeProxy();
    proxy.proxyModuleAsset = mock(async () => new Response("ok", { status: 200 }));
    const { req: request, url } = req("/o/assets/modules/mymod/assets/bell.mp3");

    const resp = await handleAssetRoutes(request, url, proxy as any, fakeLogger());

    expect(resp.status).toBe(200);
    expect(proxy.proxyModuleAsset).toHaveBeenCalledWith("mymod", "bell.mp3");
  });

  it("proxies to proxyBuiltinWidgetAsset", async () => {
    const proxy = fakeProxy();
    proxy.proxyBuiltinWidgetAsset = mock(async () => new Response("ok", { status: 200 }));
    const { req: request, url } = req("/o/assets/builtin/widgets/media_alert/index.html");

    const resp = await handleAssetRoutes(request, url, proxy as any, fakeLogger());

    expect(resp.status).toBe(200);
    expect(proxy.proxyBuiltinWidgetAsset).toHaveBeenCalledWith("media_alert", "index.html");
  });

  it("404s cleanly on the reserved user/ prefix without proxying", async () => {
    const proxy = fakeProxy();
    const { req: request, url } = req("/o/assets/user/avatar.png");

    const resp = await handleAssetRoutes(request, url, proxy as any, fakeLogger());

    expect(resp.status).toBe(404);
    expect(proxy.proxyModuleWidgetAsset).not.toHaveBeenCalled();
    expect(proxy.proxyModuleAsset).not.toHaveBeenCalled();
    expect(proxy.proxyBuiltinWidgetAsset).not.toHaveBeenCalled();
  });

  it("404s on an unrecognized top-level prefix", async () => {
    const proxy = fakeProxy();
    const { req: request, url } = req("/o/assets/nonsense/foo");

    const resp = await handleAssetRoutes(request, url, proxy as any, fakeLogger());

    expect(resp.status).toBe(404);
  });

  it("404s on non-GET methods", async () => {
    const proxy = fakeProxy();
    const url = new URL("http://localhost/o/assets/modules/mymod/assets/bell.mp3");
    const request = new Request(url, { method: "POST" });

    const resp = await handleAssetRoutes(request, url, proxy as any, fakeLogger());

    expect(resp.status).toBe(404);
    expect(proxy.proxyModuleAsset).not.toHaveBeenCalled();
  });

  it("does not require an overlay token anywhere in the path", async () => {
    // Regression: this route family used to live under /o/{token}/... and
    // require a resolvable token. Confirm a request with no token concept
    // at all (just /o/assets/...) succeeds — asset URLs built by workflow
    // (server-side, before any overlay/token is known) must be fetchable.
    const proxy = fakeProxy();
    proxy.proxyModuleWidgetAsset = mock(async () => new Response("ok", { status: 200 }));
    const { req: request, url } = req("/o/assets/modules/mymod/widgets/mywid/index.js");

    const resp = await handleAssetRoutes(request, url, proxy as any, fakeLogger());

    expect(resp.status).toBe(200);
  });
});

describe("normalizeOverlayPrefix", () => {
  it("rewrites /overlay/ to /o/ for token-scoped paths", () => {
    expect(normalizeOverlayPrefix("/overlay/ovl_abc123/config")).toBe("/o/ovl_abc123/config");
    expect(normalizeOverlayPrefix("/overlay/ovl_abc123/")).toBe("/o/ovl_abc123/");
  });

  it("rewrites /overlay/assets/... the same way, landing on the public asset routes", () => {
    expect(normalizeOverlayPrefix("/overlay/assets/modules/mymod/assets/bell.mp3")).toBe(
      "/o/assets/modules/mymod/assets/bell.mp3"
    );
  });

  it("leaves /o/-prefixed paths unchanged (idempotent, direct-to-streamware requests already use this shape)", () => {
    expect(normalizeOverlayPrefix("/o/ovl_abc123/config")).toBe("/o/ovl_abc123/config");
    expect(normalizeOverlayPrefix("/o/assets/modules/mymod/assets/bell.mp3")).toBe(
      "/o/assets/modules/mymod/assets/bell.mp3"
    );
  });

  it("leaves unrelated paths unchanged", () => {
    expect(normalizeOverlayPrefix("/health")).toBe("/health");
    expect(normalizeOverlayPrefix("/api/builtin-widgets")).toBe("/api/builtin-widgets");
    // No trailing slash — doesn't match the /overlay/ prefix, left as-is
    // (mirrors api's own proxy, which 302-redirects this case rather than
    // rewriting it directly).
    expect(normalizeOverlayPrefix("/overlay")).toBe("/overlay");
  });
});
