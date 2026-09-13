import { describe, expect, it, mock } from "bun:test";
import { handleStorageAssetRoute, isStorageAssetPath } from "../../src/routes/storage";

const BARKLOADER_URL = "http://barkloader.test/";

const logger = {
  debug: mock(() => undefined),
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
} as never;

function get(path: string): { req: Request; url: URL } {
  const url = new URL(`http://scene.test${path}`);
  return { req: new Request(url, { method: "GET" }), url };
}

function upstream(response: Response) {
  return mock(async (_input: string | URL | Request, _init?: RequestInit) => response);
}

describe("isStorageAssetPath", () => {
  it("claims repository keys and leaves sceneManager's own files alone", () => {
    expect(isStorageAssetPath("/assets/modules/m1/abc123/assets/bell.mp3")).toBe(true);
    expect(isStorageAssetPath("/assets/user/app-1/res-1/photo.png")).toBe(true);
    expect(isStorageAssetPath("/assets/vendor/datastar.js")).toBe(false);
    expect(isStorageAssetPath("/assets/widget-host-shim.js")).toBe(false);
    expect(isStorageAssetPath("/assets/modulesx/m1/a.png")).toBe(false);
  });
});

describe("handleStorageAssetRoute", () => {
  it("relays a presigned redirect to the browser instead of following it", async () => {
    const signed = "https://bucket.test/modules/m1/abc123/assets/bell.mp3?X-Amz-Signature=abc";
    const fetchFn = upstream(
      new Response(null, { status: 302, headers: { Location: signed, "Cache-Control": "public, max-age=3600" } })
    );
    const { req, url } = get("/assets/modules/m1/abc123/assets/bell.mp3");

    const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe(signed);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const [target, init] = fetchFn.mock.calls[0]!;
    expect(target).toBe("http://barkloader.test/assets/modules/m1/abc123/assets/bell.mp3");
    expect(init?.redirect).toBe("manual");
  });

  it("relays inline bytes with their content type", async () => {
    const fetchFn = upstream(new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    const { req, url } = get("/assets/modules/m1/abc123/widgets/w1/index.html");

    const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/html");
    expect(await resp.text()).toBe("<!doctype html>");
  });

  it("forwards the path still percent-encoded, for barkloader to sanitize", async () => {
    const fetchFn = upstream(new Response(null, { status: 404 }));
    const { req, url } = get("/assets/user/app-1/res-1/my%20file.png");

    const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(404);
    expect(fetchFn.mock.calls[0]![0]).toBe("http://barkloader.test/assets/user/app-1/res-1/my%20file.png");
  });

  it("404s a non-GET request without reaching barkloader", async () => {
    const fetchFn = upstream(new Response("unreachable"));
    const url = new URL("http://scene.test/assets/user/app-1/res-1/photo.png");

    const resp = await handleStorageAssetRoute(new Request(url, { method: "POST" }), url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers 502 when barkloader is unreachable", async () => {
    const fetchFn = mock(async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      throw new Error("connection refused");
    });
    const { req, url } = get("/assets/user/app-1/res-1/photo.png");

    const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(502);
  });
});
