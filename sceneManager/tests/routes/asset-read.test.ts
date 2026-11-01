import { describe, expect, it, mock } from "bun:test";
import { corsHeadersFor, routeOf } from "../../src/http";
import { handleAssetReadRoute } from "../../src/routes/asset-read";

const BARKLOADER_URL = "http://barkloader.test/";

const logger = {
  debug: mock(() => undefined),
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
} as never;

function get(path: string, headers: Record<string, string> = {}): { req: Request; url: URL } {
  const url = new URL(`http://scene.test${path}`);
  return { req: new Request(url, { method: "GET", headers }), url };
}

/** Answers each request with the next response, recording what was asked. */
function upstream(...responses: Response[]) {
  return mock(async (_input: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) {
      throw new Error("unexpected request");
    }
    return next;
  });
}

const SIGNED = "https://bucket.test/user/res-1/anim.json?X-Amz-Signature=abc";

describe("the read route", () => {
  it("answers only paths below its prefix", () => {
    expect(routeOf("/assets/read/user/res-1/anim.json")).toBe("/assets/read/*");
    expect(routeOf("/assets/user/res-1/anim.json")).toBe("/assets/user/*");
    expect(routeOf("/assets/reader/x")).toBe("/assets/*");
  });
});

describe("handleAssetReadRoute", () => {
  it("follows barkloader's redirect to storage and streams the bytes back", async () => {
    const fetchFn = upstream(
      new Response(null, { status: 302, headers: { Location: SIGNED } }),
      new Response('{"layers":[]}', {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: '"e1"', "x-amz-request-id": "r" },
      })
    );
    const { req, url } = get("/assets/read/user/res-1/anim.json");

    const resp = await handleAssetReadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('{"layers":[]}');
    expect(resp.headers.get("Content-Type")).toBe("application/json");
    expect(resp.headers.get("ETag")).toBe('"e1"');
    expect(resp.headers.get("x-amz-request-id")).toBeNull();
    expect(resp.headers.get("Cache-Control")).toBe("no-cache");
    expect(resp.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(fetchFn.mock.calls[0]![0]).toBe("http://barkloader.test/assets/user/res-1/anim.json");
    expect(fetchFn.mock.calls[0]![1]?.redirect).toBe("manual");
    expect(fetchFn.mock.calls[1]![0]).toBe(SIGNED);
  });

  it("relays bytes barkloader serves itself, cached for good under a module's version", async () => {
    const fetchFn = upstream(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    const { req, url } = get("/assets/read/modules/m1/abc123/widgets/w1/data.json");

    const resp = await handleAssetReadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("passes revalidation through to storage and a 304 back", async () => {
    const fetchFn = upstream(
      new Response(null, { status: 302, headers: { Location: SIGNED } }),
      new Response(null, { status: 304, headers: { ETag: '"e1"' } })
    );
    const { req, url } = get("/assets/read/user/res-1/anim.json", { "If-None-Match": '"e1"' });

    const resp = await handleAssetReadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(304);
    expect(new Headers(fetchFn.mock.calls[1]![1]?.headers).get("If-None-Match")).toBe('"e1"');
  });

  it("404s a missing file", async () => {
    const fetchFn = upstream(new Response(null, { status: 404 }));
    const { req, url } = get("/assets/read/user/res-1/missing.json");

    const resp = await handleAssetReadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(404);
  });

  it("404s a key that names no engine file, or steps out of one, without reaching barkloader", async () => {
    const fetchFn = upstream();
    for (const path of [
      "/assets/read/vendor/lib.js",
      "/assets/read/media/token",
      "/assets/read/",
      "/assets/read/user/res-1",
      "/assets/read/modules/woofx3%2F..%2Fother/v1/a.json",
    ]) {
      const { req, url } = get(path);
      const resp = await handleAssetReadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);
      expect(resp.status).toBe(404);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("502s when storage refuses or cannot be reached", async () => {
    const refused = upstream(
      new Response(null, { status: 302, headers: { Location: SIGNED } }),
      new Response(null, { status: 403 })
    );
    const a = get("/assets/read/user/res-1/anim.json");
    expect((await handleAssetReadRoute(a.req, a.url, BARKLOADER_URL, logger, refused as never)).status).toBe(502);

    const down = mock(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const b = get("/assets/read/user/res-1/anim.json");
    expect((await handleAssetReadRoute(b.req, b.url, BARKLOADER_URL, logger, down as never)).status).toBe(502);
  });

  it("refuses a redirect from storage instead of following it", async () => {
    const fetchFn = upstream(
      new Response(null, { status: 302, headers: { Location: SIGNED } }),
      new Response(null, { status: 302, headers: { Location: "https://elsewhere.test/" } })
    );
    const { req, url } = get("/assets/read/user/res-1/anim.json");

    const resp = await handleAssetReadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(502);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("revalidates through real fetch, whose redirect handling the mocks above do not model", async () => {
    const storage = Bun.serve({
      port: 0,
      fetch: (req) =>
        req.headers.get("If-None-Match") === '"e1"'
          ? new Response(null, { status: 304, headers: { ETag: '"e1"' } })
          : new Response("{}", { headers: { "Content-Type": "application/json", ETag: '"e1"' } }),
    });
    const barkloader = Bun.serve({
      port: 0,
      fetch: (req) =>
        new Response(null, {
          status: 302,
          headers: { Location: `http://localhost:${storage.port}${new URL(req.url).pathname}?sig=1` },
        }),
    });
    try {
      const fresh = get("/assets/read/user/res-1/anim.json");
      const first = await handleAssetReadRoute(fresh.req, fresh.url, `http://localhost:${barkloader.port}`, logger);
      expect(first.status).toBe(200);
      expect(await first.text()).toBe("{}");

      const again = get("/assets/read/user/res-1/anim.json", { "If-None-Match": '"e1"' });
      const second = await handleAssetReadRoute(again.req, again.url, `http://localhost:${barkloader.port}`, logger);
      expect(second.status).toBe(304);
    } finally {
      barkloader.stop(true);
      storage.stop(true);
    }
  });

  it("grants no CORS", () => {
    expect(corsHeadersFor("/assets/read/user/res-1/anim.json")).toEqual({});
  });
});
