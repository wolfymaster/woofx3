import { afterEach, describe, expect, test } from "bun:test";
import {
  OPEN_REQUEST_GUARD_POLICY,
  parseRequestGuardPolicy,
  type RequestGuardPolicy,
} from "@woofx3/common/http/request-guard";
import { createHttpServer, type HttpDeps } from "../src/http";

const logger = { debug() {}, info() {}, warn() {}, error() {} };

let server: ReturnType<typeof createHttpServer> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

/** Only `/health`, preflights and refusals are exercised, so no route's own
 *  dependencies are needed. */
function start(requestGuard: RequestGuardPolicy): string {
  const deps = {
    ctx: {
      logger,
      runtimeConfig: { port: 0, bindHost: "127.0.0.1", barkloaderUrl: "http://127.0.0.1:1", requestGuard },
    },
  } as unknown as HttpDeps;
  server = createHttpServer(deps);
  return `http://127.0.0.1:${server.port}`;
}

describe("sceneManager request guard unset", () => {
  test("still answers CORS with * for any origin", async () => {
    const base = start(OPEN_REQUEST_GUARD_POLICY);
    const preflight = await fetch(`${base}/scene/s1/events/e1/delivered`, {
      method: "OPTIONS",
      headers: { origin: "https://app.example" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(preflight.headers.get("vary")).toBeNull();

    const health = await fetch(`${base}/health`, { headers: { origin: "null", host: "rebound.example" } });
    expect(health.status).toBe(200);
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
    expect(health.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  test("routes that grant no CORS still grant none", async () => {
    const base = start(OPEN_REQUEST_GUARD_POLICY);
    const res = await fetch(`${base}/assets/read/user/res-1/anim.json`, { method: "OPTIONS" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("sceneManager request guard set", () => {
  const policy = parseRequestGuardPolicy({
    allowedHosts: "127.0.0.1",
    allowedOrigins: "http://127.0.0.1:*,null",
    exposure: "loopback",
    ownUrls: [],
    extraDefaultOrigins: [],
  });

  test("an unknown Host is 421", async () => {
    const base = start(policy);
    expect((await fetch(`${base}/health`, { headers: { host: "rebound.example" } })).status).toBe(421);
  });

  test("an OBS browser source's request, with no Origin, is allowed", async () => {
    const base = start(policy);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  test("the page's own origin and a sandboxed frame's null origin are echoed", async () => {
    const base = start(policy);
    const own = await fetch(`${base}/health`, { headers: { origin: base } });
    expect(own.headers.get("access-control-allow-origin")).toBe(base);
    const frame = await fetch(`${base}/health`, { headers: { origin: "null" } });
    expect(frame.headers.get("access-control-allow-origin")).toBe("null");
  });

  test("an unknown Origin is 403 on the SSE stream and the editor upgrade", async () => {
    const base = start(policy);
    const origin = "https://evil.example";
    expect((await fetch(`${base}/scene/s1/events`, { headers: { origin } })).status).toBe(403);
    const upgrade = await fetch(`${base}/scene/s1/edit?token=t&protocol=2`, {
      headers: {
        origin,
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    });
    expect(upgrade.status).toBe(403);
  });

  test("a preflight from an unknown Origin is 403", async () => {
    const base = start(policy);
    const res = await fetch(`${base}/scene/s1/events/e1/delivered`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });
});
