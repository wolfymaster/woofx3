import { beforeEach, describe, expect, mock, test } from "bun:test";

const pingMock = mock(async () => {});

mock.module("@woofx3/db/common.pb", () => ({
  Ping: pingMock,
}));

const { default: DbProxyService } = await import("./dbProxy");

beforeEach(() => {
  pingMock.mockClear();
});

describe("DbProxyService", () => {
  test("connect pings the database proxy and marks the service connected", async () => {
    const svc = new DbProxyService("http://db.example");

    await svc.connect();

    expect(pingMock).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(true);
  });

  test("connect is idempotent", async () => {
    const svc = new DbProxyService("http://db.example");

    await svc.connect();
    await svc.connect();

    expect(pingMock).toHaveBeenCalledTimes(1);
  });

  test("connect throws when base URL is missing", async () => {
    const svc = new DbProxyService("");

    await expect(svc.connect()).rejects.toThrow("db proxy client not properly initialized");
  });

  test("disconnect clears connected state", async () => {
    const svc = new DbProxyService("http://db.example");
    await svc.connect();
    await svc.disconnect();
    expect(svc.connected).toBe(false);
  });
});
