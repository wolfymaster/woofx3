import { describe, expect, it, mock } from "bun:test";
import { corsHeadersFor, routeOf } from "../../src/http";
import { handleStorageAssetRoute, handleUploadRoute, MAX_UPLOAD_BYTES } from "../../src/routes/storage";

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

describe("routes for stored files", () => {
  it("answer module and library files, and nothing else under /assets/ but the static catch-all", () => {
    expect(routeOf("/assets/modules/m1/abc123/assets/bell.mp3")).toBe("/assets/modules/*");
    expect(routeOf("/assets/user/res-1/photo.png")).toBe("/assets/user/*");
    expect(routeOf("/assets/vendor/datastar.js")).toBe("/assets/*");
    expect(routeOf("/assets/widget-host-shim.js")).toBe("/assets/*");
    expect(routeOf("/assets/modulesx/m1/a.png")).toBe("/assets/*");
  });
});

describe("handleStorageAssetRoute inert headers", () => {
  const BARKLOADER_CSP = "sandbox; default-src 'none'";
  const html = (extra: Record<string, string> = {}) =>
    upstream(
      new Response("<script>1</script>", {
        headers: {
          "Content-Type": "text/html",
          "Content-Security-Policy": BARKLOADER_CSP,
          "X-Content-Type-Options": "nosniff",
          ...extra,
        },
      })
    );

  it("serves barkloader's headers for a user upload, attachment included", async () => {
    const { req, url } = get("/assets/user/res-1/x.svg");
    const resp = await handleStorageAssetRoute(
      req,
      url,
      BARKLOADER_URL,
      logger,
      html({ "Content-Disposition": "attachment" }) as never
    );
    expect(resp.headers.get("Content-Security-Policy")).toBe(BARKLOADER_CSP);
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resp.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("keeps the sandbox on a module file that is not part of a widget or theme bundle", async () => {
    const { req, url } = get("/assets/modules/m1/abc123/assets/page.html");
    const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, html() as never);
    expect(resp.headers.get("Content-Security-Policy")).toBe(BARKLOADER_CSP);
  });

  it("drops the sandbox from widget and theme bundle files but still never sniffs them", async () => {
    for (const path of [
      "/assets/modules/m1/abc123/widgets/w1/app.js",
      "/assets/modules/pack/abc123/themes/neon/theme.css",
    ]) {
      const { req, url } = get(path);
      const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, html() as never);
      expect(resp.headers.get("Content-Security-Policy")).toBeNull();
      expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("treats an encoded or lookalike path as not exempt", async () => {
    for (const path of [
      "/assets/modules/m1/abc123%2Fwidgets/w1/app.js",
      "/assets/modules/m1/abc123%2Fassets/widgets/x.html",
      "/assets/modules/widgets/abc123/assets/x.html",
      "/assets/user/res-1/widgets/w1/app.js",
    ]) {
      const { req, url } = get(path);
      const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, html() as never);
      expect(resp.headers.get("Content-Security-Policy")).toBe(BARKLOADER_CSP);
    }
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
    const fetchFn = upstream(
      new Response("<!doctype html>", { status: 200, headers: { "Content-Type": "text/html" } })
    );
    const { req, url } = get("/assets/modules/m1/abc123/widgets/w1/index.html");

    const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/html");
    expect(await resp.text()).toBe("<!doctype html>");
  });

  it("forwards the path still percent-encoded, for barkloader to sanitize", async () => {
    const fetchFn = upstream(new Response(null, { status: 404 }));
    const { req, url } = get("/assets/user/res-1/my%20file.png");

    const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(404);
    expect(fetchFn.mock.calls[0]![0]).toBe("http://barkloader.test/assets/user/res-1/my%20file.png");
  });

  it("answers 502 when barkloader is unreachable", async () => {
    const fetchFn = mock(async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      throw new Error("connection refused");
    });
    const { req, url } = get("/assets/user/res-1/photo.png");

    const resp = await handleStorageAssetRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(502);
  });
});

const UPLOAD_PATH = "/assets/upload/eyJrZXkiOiJ1c2VyL2EvYi9jLnBuZyJ9.abc123";

function put(path: string, body: BodyInit | null, headers: Record<string, string> = {}): { req: Request; url: URL } {
  const url = new URL(`http://scene.test${path}`);
  return { req: new Request(url, { method: "PUT", body, headers }), url };
}

describe("the upload route", () => {
  it("answers exactly one grant segment", () => {
    expect(routeOf(UPLOAD_PATH)).toBe("/assets/upload/:grant");
    expect(routeOf("/assets/upload/")).toBe("/assets/*");
    expect(routeOf("/assets/upload/a/b")).toBe("/assets/*");
    expect(routeOf("/assets/user/res-1/photo.png")).toBe("/assets/user/*");
  });
});

describe("handleUploadRoute", () => {
  it("forwards the PUT with its content headers and relays barkloader's answer", async () => {
    const fetchFn = upstream(
      Response.json({ success: true, repositoryKey: "user/a/b/c.png", size: 4 }, { status: 200 })
    );
    const { req, url } = put(UPLOAD_PATH, new Uint8Array([1, 2, 3, 4]), {
      "Content-Type": "image/png",
      "Content-Length": "4",
      Cookie: "session=must-not-leak",
    });

    const resp = await handleUploadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("application/json");
    expect(await resp.json()).toMatchObject({ success: true, repositoryKey: "user/a/b/c.png" });

    const [target, init] = fetchFn.mock.calls[0] ?? [];
    expect(target).toBe(`http://barkloader.test${UPLOAD_PATH}`);
    expect(init?.method).toBe("PUT");
    const sent = new Headers(init?.headers);
    expect(sent.get("Content-Type")).toBe("image/png");
    expect(sent.get("Cookie")).toBeNull();
    // The body goes out chunked; a length alongside it makes the upstream
    // read an empty body.
    expect(sent.get("Content-Length")).toBeNull();
    // Streamed through, not read into memory first.
    expect(init?.body).toBeInstanceOf(ReadableStream);
  });

  it("streams the bytes end to end to a real upstream", async () => {
    const received: Array<{ bytes: number; contentType: string | null; path: string }> = [];
    const barkloader = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const body = new Uint8Array(await req.arrayBuffer());
        received.push({
          bytes: body.length,
          contentType: req.headers.get("Content-Type"),
          path: new URL(req.url).pathname,
        });
        return Response.json({ success: true, size: body.length });
      },
    });
    try {
      const payload = new Uint8Array(2 * 1024 * 1024).fill(7);
      const { req, url } = put(UPLOAD_PATH, payload, { "Content-Type": "video/mp4" });

      const resp = await handleUploadRoute(req, url, `http://127.0.0.1:${barkloader.port}`, logger);

      expect(resp.status).toBe(200);
      expect(await resp.json()).toEqual({ success: true, size: payload.length });
      expect(received).toEqual([{ bytes: payload.length, contentType: "video/mp4", path: UPLOAD_PATH }]);
    } finally {
      barkloader.stop(true);
    }
  });

  it("passes barkloader's rejection through unchanged", async () => {
    const fetchFn = upstream(Response.json({ success: false, error: "upload grant expired" }, { status: 410 }));
    const { req, url } = put(UPLOAD_PATH, "x", { "Content-Type": "image/png" });

    const resp = await handleUploadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(410);
    expect(await resp.json()).toEqual({ success: false, error: "upload grant expired" });
  });

  it("refuses a declared oversize upload without reaching barkloader", async () => {
    const fetchFn = upstream(new Response("unreachable"));
    const url = new URL(`http://scene.test${UPLOAD_PATH}`);
    const req = new Request(url, { method: "PUT", headers: { "Content-Length": String(MAX_UPLOAD_BYTES + 1) } });

    const resp = await handleUploadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(413);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers 502 when barkloader is unreachable", async () => {
    const fetchFn = mock(async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      throw new Error("connection refused");
    });
    const { req, url } = put(UPLOAD_PATH, "x");

    const resp = await handleUploadRoute(req, url, BARKLOADER_URL, logger, fetchFn as never);

    expect(resp.status).toBe(502);
  });
});

describe("corsHeadersFor", () => {
  it("lets a cross-origin page preflight a PUT with a content type to an upload grant", () => {
    const headers = corsHeadersFor(UPLOAD_PATH);

    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toBe("PUT, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Content-Type");
  });

  it("does not open PUT anywhere else", () => {
    for (const path of ["/assets/user/res-1/photo.png", "/scene/s1", "/assets/upload/a/b"]) {
      expect(corsHeadersFor(path)["Access-Control-Allow-Methods"]).not.toContain("PUT");
    }
  });
});
