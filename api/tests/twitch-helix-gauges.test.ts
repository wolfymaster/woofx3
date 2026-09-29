import { describe, expect, mock, test } from "bun:test";
import { TwitchHelixGauges } from "../src/twitch-helix-gauges";

const TOKEN = JSON.stringify({ accessToken: "tok", userId: "4242" });

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function gauges(
  respond: (url: string) => Response,
  token: string | null = TOKEN,
  clientId: () => string | undefined = () => "cid"
) {
  const db = { getSetting: mock(async () => token) } as any;
  const fetchFn = mock(async (url: string, _init: RequestInit) => respond(url));
  return { helix: new TwitchHelixGauges(db, fetchFn, clientId), fetchFn };
}

describe("TwitchHelixGauges", () => {
  test("reads the viewer count from /streams with the broadcaster's token", async () => {
    const { helix, fetchFn } = gauges(() => json({ data: [{ viewer_count: 17 }] }));

    expect(await helix.viewerCount()).toEqual({ kind: "value", value: 17 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.twitch.tv/helix/streams?user_id=4242");
    expect(init.headers).toEqual({ Authorization: "Bearer tok", "Client-Id": "cid" });
  });

  test("reports an empty /streams answer as offline, not zero", async () => {
    const { helix } = gauges(() => json({ data: [] }));
    expect(await helix.viewerCount()).toEqual({ kind: "offline" });
  });

  test("reads the follower total", async () => {
    const { helix, fetchFn } = gauges(() => json({ total: 3400, data: [] }));

    expect(await helix.followerTotal()).toEqual({ kind: "value", value: 3400 });
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.twitch.tv/helix/channels/followers?broadcaster_id=4242&first=1");
  });

  test("reads the subscriber total and points", async () => {
    const { helix, fetchFn } = gauges(() => json({ total: 40, points: 52, data: [] }));

    expect(await helix.subscriptions()).toEqual({ kind: "value", value: { total: 40, points: 52 } });
    expect(fetchFn.mock.calls[0][0]).toBe("https://api.twitch.tv/helix/subscriptions?broadcaster_id=4242&first=1");
  });

  test("carries the Ratelimit-Reset time on a 429", async () => {
    const { helix } = gauges(() => json({ message: "Too Many Requests" }, 429, { "Ratelimit-Reset": "1790000000" }));
    expect(await helix.followerTotal()).toEqual({ kind: "rate_limited", retryAtMs: 1_790_000_000_000 });
  });

  test("reports a 429 without a reset time", async () => {
    const { helix } = gauges(() => json({}, 429));
    expect(await helix.followerTotal()).toEqual({ kind: "rate_limited", retryAtMs: null });
  });

  test("fails a non-2xx, a missing field and missing credentials without throwing", async () => {
    expect((await gauges(() => json({ message: "Unauthorized" }, 401)).helix.subscriptions()).kind).toBe("failed");
    expect((await gauges(() => json({ total: 40 })).helix.subscriptions()).kind).toBe("failed");
    expect((await gauges(() => json({ total: 1 }), null).helix.followerTotal()).kind).toBe("failed");
    expect(
      (
        await gauges(
          () => json({ total: 1 }),
          TOKEN,
          () => undefined
        ).helix.followerTotal()
      ).kind
    ).toBe("failed");
  });

  test("fails when fetch itself throws", async () => {
    const { helix } = gauges(() => {
      throw new Error("ECONNRESET");
    });
    expect(await helix.viewerCount()).toEqual({ kind: "failed", reason: "helix fetch failed: ECONNRESET" });
  });
});
