import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { StreamSessionResponse } from "@woofx3/db/stream_session.pb";
import { DbClient, DbError } from "../src/db-client";

function twirpError(status: number, code: string): Response {
  return new Response(JSON.stringify({ code, msg: code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DbClient.findStreamSession", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function respondWith(response: () => Response) {
    globalThis.fetch = (async () => response()) as unknown as typeof globalThis.fetch;
  }

  test("returns the session with its segments", async () => {
    const encoded = StreamSessionResponse.encode({
      status: { code: "OK", message: "" },
      session: {
        id: "s-1",
        status: "closed",
        startedAt: { seconds: 100n, nanos: 0 },
        endedAt: { seconds: 200n, nanos: 0 },
        createdAt: { seconds: 100n, nanos: 0 },
        updatedAt: { seconds: 200n, nanos: 0 },
      },
      segments: [
        {
          id: "g-1",
          streamSessionId: "s-1",
          startedAt: { seconds: 110n, nanos: 0 },
          endedAt: { seconds: 150n, nanos: 0 },
          createdAt: { seconds: 110n, nanos: 0 },
          updatedAt: { seconds: 150n, nanos: 0 },
        },
      ],
    });
    respondWith(
      () =>
        new Response(new Uint8Array(encoded), {
          status: 200,
          headers: { "content-type": "application/protobuf" },
        })
    );

    const found = await new DbClient("http://db.test").findStreamSession({ id: "s-1" });

    expect(found?.session.id).toBe("s-1");
    expect(found?.segments.map((s) => s.id)).toEqual(["g-1"]);
  });

  test("returns null when db-proxy has no such session", async () => {
    respondWith(() => twirpError(404, "not_found"));

    expect(
      await new DbClient("http://db.test").findStreamSession({ id: "7f0c5a1e-0000-4000-8000-000000000001" })
    ).toBeNull();
  });

  test("returns null for an id db-proxy cannot parse, since ids are opaque to callers", async () => {
    respondWith(() => twirpError(400, "invalid_argument"));

    expect(await new DbClient("http://db.test").findStreamSession({ id: "not-a-uuid" })).toBeNull();
  });

  test("still fails on any other error", async () => {
    respondWith(() => twirpError(500, "internal"));

    await expect(new DbClient("http://db.test").findStreamSession({ id: "s-1" })).rejects.toBeInstanceOf(DbError);
  });
});
