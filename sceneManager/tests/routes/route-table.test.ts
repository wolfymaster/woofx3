import { describe, expect, it, mock } from "bun:test";
import {
  ALLOWED_ORIGINS_SETTING,
  OPEN_REQUEST_GUARD_POLICY,
  parseRequestGuardPolicy,
  RequestGuard,
} from "@woofx3/common/http/request-guard";
import { dispatchRoute, matchRoute, type Route, routeTable } from "../../src/routes/route-table";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: mock(() => {}) };

function table(routes: Route<null>[]) {
  return routeTable<null>(routes);
}

const ok = (body: string) => () => new Response(body);

async function call(t: ReturnType<typeof table>, method: string, path: string) {
  const url = new URL(`http://scene.test${path}`);
  return dispatchRoute(t, new Request(url, { method }), url, null, logger as never);
}

describe("matchRoute", () => {
  it("picks the most specific route whatever the order", () => {
    const t = table([
      { path: "/assets/*", methods: ["GET"], cors: "open", opaqueOrigin: "refuse", handle: ok("static") },
      { path: "/assets/read/*", methods: ["GET"], cors: "none", opaqueOrigin: "refuse", handle: ok("read") },
      { path: "/assets/media/:token", methods: ["GET"], cors: "none", opaqueOrigin: "refuse", handle: ok("media") },
    ]);
    const routeOf = (path: string) => {
      const m = matchRoute(t, path);
      return m.route === null ? null : m.route.path;
    };
    expect(routeOf("/assets/read/user/a/b.json")).toBe("/assets/read/*");
    expect(routeOf("/assets/media/tok")).toBe("/assets/media/:token");
    expect(routeOf("/assets/media/a/b")).toBe("/assets/*");
    expect(routeOf("/assets/x.js")).toBe("/assets/*");
    expect(routeOf("/assets")).toBeNull();
  });

  it("decodes params once, and refuses a path that does not decode", () => {
    const t = table([
      { path: "/scene/:sceneId", methods: ["GET"], cors: "open", opaqueOrigin: "refuse", handle: ok("") },
    ]);
    expect(matchRoute(t, "/scene/a%20b")).toMatchObject({ params: { sceneId: "a b" } });
    expect(matchRoute(t, "/scene/%E0%A4%A")).toEqual({ route: null, reason: "bad_path" });
  });
});

describe("dispatchRoute", () => {
  const t = table([
    { path: "/open", methods: ["GET"], cors: "open", opaqueOrigin: "refuse", handle: ok("open") },
    { path: "/private", methods: ["GET"], cors: "none", opaqueOrigin: "refuse", handle: ok("private") },
    { path: "/upload/:grant", methods: ["PUT"], cors: "upload", opaqueOrigin: "refuse", handle: ok("up") },
    {
      path: "/broken",
      methods: ["GET"],
      cors: "open",
      opaqueOrigin: "refuse",
      handle: () => {
        throw new Error("boom");
      },
    },
  ]);

  it("answers with the route and adds its CORS", async () => {
    const open = await call(t, "GET", "/open");
    expect(await open.text()).toBe("open");
    expect(open.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const priv = await call(t, "GET", "/private");
    expect(priv.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers a preflight from the route's policy", async () => {
    const pre = await call(t, "OPTIONS", "/upload/g1");
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Methods")).toBe("PUT, OPTIONS");
  });

  it("refuses another method with 405 and Allow", async () => {
    const resp = await call(t, "POST", "/open");
    expect(resp.status).toBe(405);
    expect(resp.headers.get("Allow")).toBe("GET");
    expect(await resp.json()).toEqual({ error: "method_not_allowed" });
  });

  it("answers an unknown path 404 and a bad one 400, as JSON", async () => {
    expect((await call(t, "GET", "/nope")).status).toBe(404);
    expect(await (await call(t, "GET", "/upload/%E0%A4%A")).json()).toEqual({ error: "bad_path" });
  });

  it("turns a handler that throws into a logged 500", async () => {
    const resp = await call(t, "GET", "/broken");
    expect(resp.status).toBe(500);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchRoute opaque origin", () => {
  const t = table([
    { path: "/frame-asset", methods: ["GET"], cors: "open", opaqueOrigin: "allow", handle: ok("asset") },
    { path: "/scene", methods: ["GET", "POST"], cors: "open", opaqueOrigin: "refuse", handle: ok("scene") },
  ]);
  const listingNull = new RequestGuard(
    parseRequestGuardPolicy({
      allowedOrigins: "https://app.example,null",
      allowedOriginsSetting: ALLOWED_ORIGINS_SETTING,
      opaqueOrigin: "allow",
      exposure: "network",
      ownUrls: [],
      extraDefaultOrigins: [],
    })
  );

  async function from(guard: RequestGuard, method: string, path: string, origin: string) {
    const url = new URL(`http://scene.test${path}`);
    return dispatchRoute(t, new Request(url, { method, headers: { origin } }), url, null, logger as never, guard);
  }

  it("admits null on a route that allows it, echoing it", async () => {
    const res = await from(listingNull, "GET", "/frame-asset", "null");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });

  it("refuses null on every other route, preflights included, without CORS", async () => {
    for (const method of ["GET", "POST", "OPTIONS"]) {
      const res = await from(listingNull, method, "/scene", "null");
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("still admits a listed origin there", async () => {
    expect((await from(listingNull, "GET", "/scene", "https://app.example")).status).toBe(200);
  });

  it("admits null everywhere when origins are not checked", async () => {
    expect((await from(new RequestGuard(OPEN_REQUEST_GUARD_POLICY), "GET", "/scene", "null")).status).toBe(200);
  });
});
