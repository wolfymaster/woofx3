import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PingResponse } from "@woofx3/db/common.pb";
import { dbProxyClientConfig } from "@woofx3/db/service-auth";
import { DbClient } from "../src/db-client";

describe("DbClient service token", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends the service token on every call", async () => {
    const seen: Array<string | null> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return new Response(new Uint8Array(PingResponse.encode({})), {
        status: 200,
        headers: { "content-type": "application/protobuf" },
      });
    }) as unknown as typeof globalThis.fetch;

    const db = new DbClient(dbProxyClientConfig("http://db.test", " test-token "));
    await db.ping();
    await db.ping();

    expect(seen).toEqual(["Bearer test-token", "Bearer test-token"]);
  });
});

describe("dbProxyClientConfig", () => {
  test("refuses a blank token", () => {
    expect(() => dbProxyClientConfig("http://db.test", "  ")).toThrow("db proxy service token is empty");
  });

  test("refuses a blank base URL", () => {
    expect(() => dbProxyClientConfig("", "test-token")).toThrow("db proxy base URL is empty");
  });
});
