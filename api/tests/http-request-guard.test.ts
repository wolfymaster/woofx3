import { afterEach, describe, expect, test } from "bun:test";
import {
  ALLOWED_ORIGINS_SETTING,
  OPEN_REQUEST_GUARD_POLICY,
  parseRequestGuardPolicy,
  parseUiOrigins,
  type RequestGuardPolicy,
} from "@woofx3/common/http/request-guard";
import type { SharedLogger } from "@woofx3/common/logging";
import type { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as SharedLogger;

let server: ReturnType<typeof createHttpServer> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function start(requestGuard: RequestGuardPolicy): string {
  server = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({ ready: true }) as never,
    health: () => ({ status: "ok" }) as never,
    logger: silentLogger,
    gateway: {} as ApiGateway,
    requestGuard,
    onProcessingCallback: async () => {},
    barkloaderWebhookSecret: null,
  });
  return `http://127.0.0.1:${server.port}`;
}

function preflight(base: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${base}/api`, { method: "OPTIONS", headers });
}

/** Opens a WebSocket to /api and resolves with whether it opened. */
function openSocket(base: string, origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/api`, { headers: { origin } } as never);
    ws.addEventListener("open", () => {
      ws.close();
      resolve(true);
    });
    ws.addEventListener("error", () => resolve(false));
  });
}

describe("api request guard set to *", () => {
  test("is what * parses to", () => {
    expect(
      parseRequestGuardPolicy({
        allowedOriginsSetting: ALLOWED_ORIGINS_SETTING,
        opaqueOrigin: "refuse",
        allowedHosts: "*",
        allowedOrigins: "*",
        exposure: "loopback",
        ownUrls: [],
        extraDefaultOrigins: [],
      })
    ).toEqual(OPEN_REQUEST_GUARD_POLICY);
  });

  test("answers CORS with * for any origin", async () => {
    const base = start(OPEN_REQUEST_GUARD_POLICY);
    const res = await preflight(base, { origin: "https://app.example" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("vary")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  });

  test("accepts any Host", async () => {
    const base = start(OPEN_REQUEST_GUARD_POLICY);
    const res = await fetch(`${base}/health`, { headers: { host: "rebound.example" } });
    expect(res.status).toBe(200);
  });

  test("upgrades a WebSocket from any origin", async () => {
    const base = start(OPEN_REQUEST_GUARD_POLICY);
    expect(await openSocket(base, "https://anywhere.example")).toBe(true);
  });
});

/** An upgrade request to /api from `origin`, sent with fetch so the refusal's status is visible. */
function upgradeRequest(base: string, origin: string): Promise<Response> {
  return fetch(`${base}/api`, {
    headers: {
      origin,
      upgrade: "websocket",
      connection: "Upgrade",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
    },
  });
}

describe("api request guard unset on a loopback-only engine", () => {
  const policy = parseRequestGuardPolicy({
    allowedOriginsSetting: ALLOWED_ORIGINS_SETTING,
    opaqueOrigin: "refuse",
    exposure: "loopback",
    ownUrls: [],
    extraDefaultOrigins: [],
  });

  test("refuses a WebSocket upgrade from a hostile page", async () => {
    const base = start(policy);
    expect((await upgradeRequest(base, "https://evil.example")).status).toBe(403);
    expect(await openSocket(base, "https://evil.example")).toBe(false);
  });

  test("refuses an HTTP request from a hostile page", async () => {
    const base = start(policy);
    expect((await preflight(base, { origin: "https://evil.example" })).status).toBe(403);
    expect((await fetch(`${base}/health`, { headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  test("admits a local dev server, over HTTP and WebSocket", async () => {
    const base = start(policy);
    const res = await preflight(base, { origin: "http://localhost:5173" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(await openSocket(base, "http://localhost:5173")).toBe(true);
  });

  test("admits a request with no Origin, as Convex, OBS and the CLI send", async () => {
    const base = start(policy);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  test("refuses a rebound Host", async () => {
    const base = start(policy);
    expect((await fetch(`${base}/health`, { headers: { host: "rebound.attacker.example" } })).status).toBe(421);
  });
});

describe("api request guard set", () => {
  const policy = parseRequestGuardPolicy({
    allowedHosts: "127.0.0.1,localhost",
    allowedOrigins: "https://app.example",
    allowedOriginsSetting: ALLOWED_ORIGINS_SETTING,
    opaqueOrigin: "refuse",
    exposure: "loopback",
    ownUrls: [],
    extraDefaultOrigins: [],
  });

  test("an unknown Host is 421", async () => {
    const base = start(policy);
    const res = await fetch(`${base}/health`, { headers: { host: "rebound.example" } });
    expect(res.status).toBe(421);
  });

  test("an unknown Origin is 403", async () => {
    const base = start(policy);
    expect((await preflight(base, { origin: "https://evil.example" })).status).toBe(403);
  });

  test("an absent Origin is allowed", async () => {
    const base = start(policy);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  test("CORS echoes a listed origin with Vary", async () => {
    const base = start(policy);
    const res = await preflight(base, { origin: "https://app.example" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  test("refuses a WebSocket upgrade from an unknown origin", async () => {
    const base = start(policy);
    expect((await upgradeRequest(base, "https://evil.example")).status).toBe(403);
    expect(await openSocket(base, "https://evil.example")).toBe(false);
  });

  test("upgrades a WebSocket from a listed origin", async () => {
    const base = start(policy);
    expect(await openSocket(base, "https://app.example")).toBe(true);
  });

  test("the barkloader webhook, which sends no Origin, still reaches the api", async () => {
    const base = start(policy);
    const res = await fetch(`${base}/webhooks/barkloader/processing`, { method: "POST", body: "{}" });
    expect(res.status).toBe(204);
  });
});

describe("api request guard on a hosted engine with a dashboard origin", () => {
  const policy = parseRequestGuardPolicy({
    allowedOriginsSetting: ALLOWED_ORIGINS_SETTING,
    opaqueOrigin: "refuse",
    exposure: "network",
    ownUrls: ["http://127.0.0.1:5050", "https://streamer.woofx3.tv"],
    extraDefaultOrigins: parseUiOrigins("https://woofx3.tv"),
  });

  test("upgrades the dashboard's live WebSocket", async () => {
    const base = start(policy);
    expect(await openSocket(base, "https://woofx3.tv")).toBe(true);
  });

  test("still refuses a WebSocket upgrade from an unknown origin", async () => {
    const base = start(policy);
    expect((await upgradeRequest(base, "https://evil.example")).status).toBe(403);
  });
});
