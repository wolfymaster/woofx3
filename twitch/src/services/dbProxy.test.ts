import { beforeEach, describe, expect, mock, test } from "bun:test";
import { dbProxyClientConfig } from "@woofx3/db/service-auth";

const pingMock = mock(async (_request: unknown, _config: unknown) => {});

mock.module("@woofx3/db/common.pb", () => ({
  Ping: pingMock,
}));

const { default: DbProxyService } = await import("./dbProxy");

const config = dbProxyClientConfig("http://db.example", "twitch-token");

beforeEach(() => {
  pingMock.mockClear();
});

describe("DbProxyService", () => {
  test("connect pings the database proxy with the service token and marks the service connected", async () => {
    const svc = new DbProxyService(config);

    await svc.connect();

    expect(pingMock).toHaveBeenCalledTimes(1);
    expect(pingMock.mock.calls[0]?.[1]).toEqual({
      baseURL: "http://db.example",
      headers: { Authorization: "Bearer twitch-token" },
    });
    expect(svc.connected).toBe(true);
  });

  test("connect is idempotent", async () => {
    const svc = new DbProxyService(config);

    await svc.connect();
    await svc.connect();

    expect(pingMock).toHaveBeenCalledTimes(1);
  });

  test("connect throws when base URL is missing", async () => {
    const svc = new DbProxyService({ ...config, baseURL: "" });

    await expect(svc.connect()).rejects.toThrow("db proxy client not properly initialized");
  });

  test("disconnect clears connected state", async () => {
    const svc = new DbProxyService(config);
    await svc.connect();
    await svc.disconnect();
    expect(svc.connected).toBe(false);
  });
});
