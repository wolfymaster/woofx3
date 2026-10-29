import { afterEach, describe, expect, test } from "bun:test";
import { OPEN_REQUEST_GUARD_POLICY, type RequestGuardPolicy } from "@woofx3/common/http/request-guard";
import type { SharedLogger } from "@woofx3/common/logging";
import { RpcTarget } from "capnweb";
import type { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";

const ALLOWLIST_POLICY: RequestGuardPolicy = {
  allowedHosts: null,
  listedOrigins: null,
  allowedOrigins: [{ kind: "exact", origin: "https://app.example" }],
};

const SECRET = "s3cr3t-value";

type Captured = { level: string; message: string; fields: unknown };

class FakeGateway extends RpcTarget {
  authenticate(_clientId: string, _clientSecret: string): string {
    return "session-token-xyz";
  }
}

function capturingLogger(sink: Captured[]): SharedLogger {
  const record = (level: string) => (message: string, fields?: unknown) => {
    sink.push({ level, message, fields });
  };
  return {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  } as unknown as SharedLogger;
}

let server: ReturnType<typeof createHttpServer> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function start(sink: Captured[]): string {
  server = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({ ready: true }) as never,
    health: () => ({ status: "ok" }) as never,
    logger: capturingLogger(sink),
    gateway: new FakeGateway() as unknown as ApiGateway,
    requestGuard: OPEN_REQUEST_GUARD_POLICY,
    onProcessingCallback: async () => {},
    barkloaderWebhookSecret: null,
  });
  return `http://127.0.0.1:${server.port}`;
}

// capnweb batch: push a call to authenticate(clientId, secret), then pull its result.
const BATCH = [
  JSON.stringify(["push", ["pipeline", 0, ["authenticate"], ["client-1", SECRET]]]),
  JSON.stringify(["pull", 1]),
].join("\n");

describe("api RPC logging", () => {
  test("HTTP batch logs metadata and never the payload", async () => {
    const sink: Captured[] = [];
    const base = start(sink);
    const res = await fetch(`${base}/api`, { method: "POST", body: BATCH });
    const text = await res.text();
    expect(text).toContain("session-token-xyz");
    expect(JSON.stringify(sink)).not.toContain(SECRET);
    expect(JSON.stringify(sink)).not.toContain("session-token-xyz");

    const done = sink.find((entry) => entry.message === "HTTP batch RPC request completed");
    expect(done).toBeDefined();
    const fields = done?.fields as Record<string, unknown>;
    expect(fields.method).toBe("POST");
    expect(fields.path).toBe("/api");
    expect(fields.status).toBe(200);
    expect(typeof fields.durationMs).toBe("number");
    expect(fields.requestBytes).toBe(BATCH.length);
    expect(fields.responseBytes).toBe(new TextEncoder().encode(text).length);
  });

  test("batch responses carry CORS headers", async () => {
    const base = start([]);
    const res = await fetch(`${base}/api`, { method: "POST", body: BATCH, headers: { origin: "https://app.example" } });
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("batch responses echo an allowed origin and vary on it", async () => {
    server = createHttpServer({
      port: 0,
      hostname: "127.0.0.1",
      readiness: async () => ({ ready: true }) as never,
      health: () => ({ status: "ok" }) as never,
      logger: capturingLogger([]),
      gateway: new FakeGateway() as unknown as ApiGateway,
      requestGuard: ALLOWLIST_POLICY,
      onProcessingCallback: async () => {},
      barkloaderWebhookSecret: null,
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/api`, {
      method: "POST",
      body: BATCH,
      headers: { origin: "https://app.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  test("WebSocket frames are logged by size only", async () => {
    const sink: Captured[] = [];
    const base = start(sink);
    const ws = new WebSocket(`${base.replace("http", "ws")}/api`);
    const reply = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => resolve(String(event.data)));
    });
    await new Promise((resolve) => ws.addEventListener("open", resolve));
    ws.send(JSON.stringify(["push", ["pipeline", 0, ["authenticate"], ["client-1", SECRET]]]));
    ws.send(JSON.stringify(["pull", 1]));
    await reply;
    ws.close();
    expect(JSON.stringify(sink)).not.toContain(SECRET);
    expect(JSON.stringify(sink)).not.toContain("session-token-xyz");
    expect(sink.some((entry) => entry.message === "Received WebSocket message")).toBe(true);
  });
});
