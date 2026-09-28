import { describe, expect, mock, test } from "bun:test";
import type { ApiClient, HelixUser } from "@twurple/api";
import TwitchApi, { normalizeHelixTime, TwitchApiError, type TwitchApiErrorCode } from "./twitch";

const BROADCASTER = { id: "broadcaster-1" } as HelixUser;

function apiClientWith(overrides: { shoutoutUser?: ReturnType<typeof mock>; getUserByName?: ReturnType<typeof mock> }) {
  const shoutoutUser = overrides.shoutoutUser ?? mock(async () => {});
  const getUserByName = overrides.getUserByName ?? mock(async () => ({ id: "target-1" }));
  return {
    client: { chat: { shoutoutUser }, users: { getUserByName } } as unknown as ApiClient,
    shoutoutUser,
    getUserByName,
  };
}

describe("shoutout", () => {
  test("shouts out a user id without looking anything up", async () => {
    const { client, shoutoutUser, getUserByName } = apiClientWith({});
    const api = new TwitchApi(client, BROADCASTER);

    expect(await api.shoutout({ userId: "target-1" })).toEqual({ ok: true, userId: "target-1" });
    expect(getUserByName).not.toHaveBeenCalled();
    expect(shoutoutUser.mock.calls[0]).toEqual([BROADCASTER, "target-1"]);
  });

  // A chat command carries what someone typed, which is a name and often an @.
  test("resolves a login name, with or without the @", async () => {
    for (const typed of ["wolfymaster", "@wolfymaster"]) {
      const { client, shoutoutUser, getUserByName } = apiClientWith({});
      const api = new TwitchApi(client, BROADCASTER);

      await api.shoutout({ userName: typed });
      expect(getUserByName.mock.calls[0]).toEqual(["wolfymaster"]);
      expect(shoutoutUser.mock.calls[0]).toEqual([BROADCASTER, "target-1"]);
    }
  });

  test("says which name it could not find", async () => {
    const { client } = apiClientWith({ getUserByName: mock(async () => null) });
    const api = new TwitchApi(client, BROADCASTER);

    expect(api.shoutout({ userName: "ghost" })).rejects.toThrow('no Twitch user named "ghost"');
  });

  test("refuses a shoutout that names nobody", async () => {
    const { client, shoutoutUser } = apiClientWith({});
    const api = new TwitchApi(client, BROADCASTER);

    expect(api.shoutout({})).rejects.toThrow("userId or userName is required");
    expect(shoutoutUser).not.toHaveBeenCalled();
  });
});

type CallApiOptions = { url: string; method: string; userId: string; scopes: string[]; query: Record<string, string> };

function helixClient(respond: (options: CallApiOptions) => unknown) {
  const callApi = mock(async (options: CallApiOptions) => respond(options));
  return { client: { callApi } as unknown as ApiClient, callApi };
}

async function rejectionOf(promise: Promise<unknown>): Promise<TwitchApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof TwitchApiError) {
      return err;
    }
    throw err;
  }
  throw new Error("expected a rejection");
}

describe("normalizeHelixTime", () => {
  // Helix has sent each of these forms for the ad-schedule times.
  const cases: [Parameters<typeof normalizeHelixTime>[0], string | null][] = [
    ["2026-09-28T18:10:00Z", "2026-09-28T18:10:00.000Z"],
    ["2026-09-28T13:10:00-05:00", "2026-09-28T18:10:00.000Z"],
    [1790619000, "2026-09-28T18:10:00.000Z"],
    ["1790619000", "2026-09-28T18:10:00.000Z"],
    ["", null],
    ["  ", null],
    [0, null],
    ["0", null],
    [null, null],
    [undefined, null],
    ["not a time", null],
  ];
  for (const [raw, expected] of cases) {
    test(`${JSON.stringify(raw)} -> ${expected}`, () => {
      expect(normalizeHelixTime(raw)).toBe(expected);
    });
  }
});

describe("ad schedule", () => {
  test("reads GET /channels/ads for the broadcaster and normalizes it", async () => {
    const { client, callApi } = helixClient(() => ({
      data: [
        {
          next_ad_at: "2026-09-28T18:10:00Z",
          last_ad_at: "",
          duration: 90,
          preroll_free_time: 1200,
          snooze_count: 3,
          snooze_refresh_at: 1790622000,
        },
      ],
    }));
    const api = new TwitchApi(client, BROADCASTER);

    const schedule = await api.getAdSchedule({});

    expect(schedule).toEqual({
      nextAdAt: "2026-09-28T18:10:00.000Z",
      lastAdAt: null,
      durationSeconds: 90,
      prerollFreeSeconds: 1200,
      snoozeCount: 3,
      snoozeRefreshAt: "2026-09-28T19:00:00.000Z",
      serverNow: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(schedule.serverNow))).toBe(false);
    const options = callApi.mock.calls[0]?.[0];
    expect(options?.url).toBe("channels/ads");
    expect(options?.method).toBe("GET");
    expect(options?.scopes).toEqual(["channel:read:ads"]);
    expect(options?.query).toEqual({ broadcaster_id: "broadcaster-1" });
  });

  test("an offline channel with nothing scheduled reads as nulls and zeroes", async () => {
    const { client } = helixClient(() => ({
      data: [
        { next_ad_at: "", last_ad_at: "", duration: 0, preroll_free_time: 0, snooze_count: 0, snooze_refresh_at: "" },
      ],
    }));
    const api = new TwitchApi(client, BROADCASTER);

    const { serverNow: _serverNow, ...schedule } = await api.getAdSchedule({});
    expect(schedule).toEqual({
      nextAdAt: null,
      lastAdAt: null,
      durationSeconds: 0,
      prerollFreeSeconds: 0,
      snoozeCount: 0,
      snoozeRefreshAt: null,
    });
  });

  test("snoozeNextAd posts the snooze and returns the new schedule", async () => {
    const { client, callApi } = helixClient(() => ({
      data: [{ snooze_count: "2", snooze_refresh_at: "1790622000", next_ad_at: "2026-09-28T18:15:00Z" }],
    }));
    const api = new TwitchApi(client, BROADCASTER);

    expect(await api.snoozeNextAd({})).toEqual({
      snoozeCount: 2,
      snoozeRefreshAt: "2026-09-28T19:00:00.000Z",
      nextAdAt: "2026-09-28T18:15:00.000Z",
      serverNow: expect.any(String),
    });
    const options = callApi.mock.calls[0]?.[0];
    expect(options?.url).toBe("channels/ads/schedule/snooze");
    expect(options?.method).toBe("POST");
    expect(options?.scopes).toEqual(["channel:manage:ads"]);
  });

  test("a token without the ads scope says to reconnect Twitch", async () => {
    const { client } = helixClient(() => {
      throw new Error(
        "This token does not have any of the requested scopes (channel:read:ads) and can not be upgraded."
      );
    });
    const api = new TwitchApi(client, BROADCASTER);

    const err = await rejectionOf(api.getAdSchedule({}));
    expect(err.code).toBe("missing_scope");
    expect(err.message).toContain("reconnect Twitch to allow ad controls");
  });

  test("a 401 naming a scope is a missing scope; a bare 401 or a 429 is not", async () => {
    const httpError = (statusCode: number, body: string) =>
      Object.assign(new Error(`Encountered HTTP status code ${statusCode}\n\nBody:\n${body}`), { statusCode });
    const cases: [Error, TwitchApiErrorCode][] = [
      [httpError(401, '{"message":"Missing scope: channel:manage:ads"}'), "missing_scope"],
      [httpError(401, '{"message":"Invalid OAuth token"}'), "unauthorized"],
      [httpError(429, "{}"), "rate_limited"],
      [httpError(400, '{"message":"no snoozes left"}'), "failed"],
    ];
    for (const [thrown, code] of cases) {
      const { client } = helixClient(() => {
        throw thrown;
      });
      const api = new TwitchApi(client, BROADCASTER);
      expect((await rejectionOf(api.snoozeNextAd({}))).code).toBe(code);
    }
  });
});
