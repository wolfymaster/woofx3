import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PingResponse } from "@woofx3/db/common.pb";
import { dbProxyClientConfig } from "@woofx3/db/service-auth";
import { DbClient } from "../src/db";

describe("DbClient service token", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends the service token to db-proxy", async () => {
    const seen: Array<string | null> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return new Response(new Uint8Array(PingResponse.encode({})), {
        status: 200,
        headers: { "content-type": "application/protobuf" },
      });
    }) as unknown as typeof globalThis.fetch;

    await new DbClient(dbProxyClientConfig("http://db.test", "scene-token")).ping();

    expect(seen).toEqual(["Bearer scene-token"]);
  });
});
