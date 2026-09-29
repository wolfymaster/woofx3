import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GetStreamSessionEventTotalsResponse, ListViewerLeaderboardResponse } from "@woofx3/db/user_event.pb";
import { DbClient, DbError } from "../src/db-client";

function twirpError(status: number, code: string): Response {
  return new Response(JSON.stringify({ code, msg: code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function protobuf(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "application/protobuf" },
  });
}

describe("DbClient analytics reads", () => {
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

  const db = () => new DbClient("http://db.test");

  test("returns a session's totals", async () => {
    respondWith(() =>
      protobuf(
        GetStreamSessionEventTotalsResponse.encode({
          status: { code: "OK", message: "" },
          totals: {
            bits: 500n,
            cheers: 2n,
            subs: 3n,
            giftedSubs: 5n,
            follows: 7n,
            raids: 1n,
            raiders: 40n,
          },
        })
      )
    );

    const totals = await db().findStreamSessionEventTotals("s-1");

    expect(totals?.bits).toBe(500n);
    expect(totals?.giftedSubs).toBe(5n);
  });

  test("returns the leaderboard entries", async () => {
    respondWith(() =>
      protobuf(
        ListViewerLeaderboardResponse.encode({
          status: { code: "OK", message: "" },
          entries: [{ platform: "twitch", platformUserId: "1001", userName: "Alice", total: 900n, events: 3n }],
        })
      )
    );

    const entries = await db().findViewerLeaderboard({ metric: "LEADERBOARD_METRIC_BITS" });

    expect(entries?.map((e) => e.platformUserId)).toEqual(["1001"]);
  });

  test("every session-keyed read is null for a session db-proxy does not have", async () => {
    for (const [status, code] of [
      [404, "not_found"],
      [400, "invalid_argument"],
    ] as const) {
      respondWith(() => twirpError(status, code));
      expect(await db().findStreamSessionEventTotals("s-1")).toBeNull();
      expect(await db().findStreamGaugeSamples("s-1")).toBeNull();
      expect(
        await db().findViewerEventTotals({ platform: "twitch", platformUserId: "1", streamSessionId: "s-1" })
      ).toBeNull();
      expect(
        await db().findViewerLeaderboard({ metric: "LEADERBOARD_METRIC_BITS", streamSessionId: "s-1" })
      ).toBeNull();
    }
  });

  test("still fails on any other error", async () => {
    respondWith(() => twirpError(500, "internal"));

    await expect(db().findStreamSessionEventTotals("s-1")).rejects.toBeInstanceOf(DbError);
    await expect(db().findStreamGaugeSamples("s-1")).rejects.toBeInstanceOf(DbError);
  });
});
