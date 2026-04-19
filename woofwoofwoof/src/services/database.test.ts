import { describe, expect, mock, test } from "bun:test";
import DatabaseService, { DatabaseClient } from "./database";

describe("DatabaseService", () => {
  test("starts disconnected and wires a client to the configured proxy base URL", () => {
    const svc = new DatabaseService("http://db-proxy.example:8080");

    expect(svc.name).toBe("db");
    expect(svc.type).toBe("database");
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
    expect(svc.client).toBeInstanceOf(DatabaseClient);
  });

  test("connect succeeds after ping and marks the service as connected for health checks", async () => {
    const svc = new DatabaseService("http://localhost");
    const ping = mock(async () => undefined);
    svc.client = { ping } as unknown as DatabaseClient;

    await svc.connect();

    expect(ping).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(true);
    expect(svc.healthcheck).toBe(true);
  });

  test("connect is idempotent: does not ping again if already connected", async () => {
    const svc = new DatabaseService("http://localhost");
    const ping = mock(async () => undefined);
    svc.client = { ping } as unknown as DatabaseClient;

    await svc.connect();
    await svc.connect();

    expect(ping).toHaveBeenCalledTimes(1);
  });

  test("disconnect clears local connection state without a remote call", async () => {
    const svc = new DatabaseService("http://localhost");
    svc.client = { ping: mock(async () => undefined) } as unknown as DatabaseClient;
    await svc.connect();

    await svc.disconnect();

    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });
});
