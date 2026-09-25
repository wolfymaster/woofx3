import { describe, expect, it, mock } from "bun:test";
import { corsHeadersFor } from "../../src/http";
import {
  handleStorageAssetRoute,
  handleUploadRoute,
  isStorageAssetPath,
  isUploadPath,
  MAX_UPLOAD_BYTES,
} from "../../src/routes/storage";

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
    expect(isStorageAssetPath("/assets/user/res-1/photo.png")).toBe(true);
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

  it("404s a non-GET request without reaching barkloader", async () => {
    const fetchFn = upstream(new Response("unreachable"));
    const url = new URL("http://scene.test/assets/user/res-1/photo.png");

    const resp = await handleStorageAssetRoute(
      new Request(url, { method: "POST" }),
      url,
      BARKLOADER_URL,
      logger,
      fetchFn as never
    );

    expect(resp.status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
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

describe("isUploadPath", () => {
  it("claims exactly one token segment under /assets/upload/", () => {
    expect(isUploadPath(UPLOAD_PATH)).toBe(true);
    expect(isUploadPath("/assets/upload/")).toBe(false);
    expect(isUploadPath("/assets/upload/a/b")).toBe(false);
    expect(isUploadPath("/assets/user/res-1/photo.png")).toBe(false);
    expect(isStorageAssetPath(UPLOAD_PATH)).toBe(false);
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

  it("answers 405 for any method but PUT without reaching barkloader", async () => {
    const fetchFn = upstream(new Response("unreachable"));
    const url = new URL(`http://scene.test${UPLOAD_PATH}`);

    for (const method of ["GET", "POST", "DELETE", "PATCH"]) {
      const resp = await handleUploadRoute(new Request(url, { method }), url, BARKLOADER_URL, logger, fetchFn as never);
      expect(resp.status).toBe(405);
      expect(resp.headers.get("Allow")).toBe("PUT, OPTIONS");
    }
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
