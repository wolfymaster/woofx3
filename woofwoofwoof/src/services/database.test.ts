import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { PingResponse } from "@woofx3/db/common.pb";
import { dbProxyClientConfig } from "@woofx3/db/service-auth";
import DatabaseService, { DatabaseClient } from "./database";

const config = dbProxyClientConfig("http://db-proxy.example:8080", "woof-token");

describe("DatabaseService", () => {
  test("starts disconnected and wires a client to the configured proxy base URL", () => {
    const svc = new DatabaseService(config);

    expect(svc.name).toBe("db");
    expect(svc.type).toBe("database");
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
    expect(svc.client).toBeInstanceOf(DatabaseClient);
  });

  test("connect succeeds after ping and marks the service as connected for health checks", async () => {
    const svc = new DatabaseService(config);
    const ping = mock(async () => undefined);
    svc.client = { ping } as unknown as DatabaseClient;

    await svc.connect();

    expect(ping).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(true);
    expect(svc.healthcheck).toBe(true);
  });

  test("connect is idempotent: does not ping again if already connected", async () => {
    const svc = new DatabaseService(config);
    const ping = mock(async () => undefined);
    svc.client = { ping } as unknown as DatabaseClient;

    await svc.connect();
    await svc.connect();

    expect(ping).toHaveBeenCalledTimes(1);
  });

  test("disconnect clears local connection state without a remote call", async () => {
    const svc = new DatabaseService(config);
    svc.client = { ping: mock(async () => undefined) } as unknown as DatabaseClient;
    await svc.connect();

    await svc.disconnect();

    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });
});

describe("DatabaseClient service token", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends the service token to db-proxy", async () => {
    const seen: Array<string | null> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return new Response(new Uint8Array(PingResponse.encode({})), {
        status: 200,
        headers: { "content-type": "application/protobuf" },
      });
    }) as unknown as typeof globalThis.fetch;

    await new DatabaseClient(config).ping();

    expect(seen).toEqual(["Bearer woof-token"]);
  });
});
