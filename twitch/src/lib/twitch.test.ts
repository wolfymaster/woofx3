import { describe, expect, mock, test } from "bun:test";
import type { ApiClient, HelixUser } from "@twurple/api";
import TwitchApi, {
  isTwitchApiCommand,
  normalizeHelixTime,
  TWITCH_API_COMMANDS,
  TwitchApiError,
  type TwitchApiErrorCode,
  twitchApiErrorCodeOf,
  validateTags,
  validateTitle,
} from "./twitch";

const BROADCASTER = { id: "broadcaster-1" } as HelixUser;

function apiClientWith(overrides: { shoutoutUser?: ReturnType<typeof mock>; getUserByName?: ReturnType<typeof mock> }) {
  const shoutoutUser = overrides.shoutoutUser ?? mock(async (..._args: unknown[]) => {});
  const getUserByName = overrides.getUserByName ?? mock(async (..._args: unknown[]) => ({ id: "target-1" }));
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
    const { client } = apiClientWith({ getUserByName: mock(async (..._args: unknown[]) => null) });
    const api = new TwitchApi(client, BROADCASTER);

    await expect(api.shoutout({ userName: "ghost" })).rejects.toThrow('no Twitch user named "ghost"');
  });

  test("reports Twitch's rate limit with the rate_limited code", async () => {
    const limited = Object.assign(new Error("Encountered HTTP status code 429: Too Many Requests"), {
      statusCode: 429,
    });
    const { client } = apiClientWith({
      shoutoutUser: mock(async (..._args: unknown[]) => {
        throw limited;
      }),
    });
    const api = new TwitchApi(client, BROADCASTER);

    const err = await api.shoutout({ userId: "target-1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TwitchApiError);
    expect(twitchApiErrorCodeOf(err)).toBe("rate_limited");
    expect((err as Error).message).toContain("one shoutout every 2 minutes");
  });

  test("passes any other Twitch refusal through uncoded", async () => {
    const denied = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const { client } = apiClientWith({
      shoutoutUser: mock(async (..._args: unknown[]) => {
        throw denied;
      }),
    });
    const api = new TwitchApi(client, BROADCASTER);

    const err = await api.shoutout({ userId: "target-1" }).catch((e: unknown) => e);
    expect(err).toBe(denied);
    expect(twitchApiErrorCodeOf(err)).toBeUndefined();
  });

  test("refuses a shoutout that names nobody", async () => {
    const { client, shoutoutUser } = apiClientWith({});
    const api = new TwitchApi(client, BROADCASTER);

    await expect(api.shoutout({})).rejects.toThrow("userId or userName is required");
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
    expect(twitchApiErrorCodeOf(new TwitchApiError("failed", "x"))).toBeUndefined();
  });
});

type AnyMock = ReturnType<typeof mock>;

/** An ApiClient stub carrying only the Helix endpoints a test names. */
function helix(endpoints: {
  banUser?: AnyMock;
  getUserByName?: AnyMock;
  updateChannelInfo?: AnyMock;
  getChannelInfoById?: AnyMock;
  searchCategories?: AnyMock;
  createStreamMarker?: AnyMock;
}): ApiClient {
  return {
    moderation: { banUser: endpoints.banUser ?? mock(async (..._args: unknown[]) => []) },
    users: { getUserByName: endpoints.getUserByName ?? mock(async (..._args: unknown[]) => ({ id: "target-1" })) },
    channels: {
      updateChannelInfo: endpoints.updateChannelInfo ?? mock(async (..._args: unknown[]) => {}),
      getChannelInfoById: endpoints.getChannelInfoById ?? mock(async (..._args: unknown[]) => null),
    },
    search: { searchCategories: endpoints.searchCategories ?? mock(async (..._args: unknown[]) => ({ data: [] })) },
    streams: { createStreamMarker: endpoints.createStreamMarker ?? mock(async (..._args: unknown[]) => ({})) },
  } as unknown as ApiClient;
}

function categories(...names: string[]) {
  return mock(async (..._args: unknown[]) => ({
    data: names.map((name, i) => ({ id: `game-${i}`, name, boxArtUrl: `https://box/${i}.jpg` })),
  }));
}

describe("the twitchapi command list", () => {
  test("serves every public method and nothing else", () => {
    expect(isTwitchApiCommand("updateStream")).toBe(true);
    expect(isTwitchApiCommand("createMarker")).toBe(true);
    expect(isTwitchApiCommand("getAdSchedule")).toBe(true);
    expect(isTwitchApiCommand("snoozeNextAd")).toBe(true);
    expect(isTwitchApiCommand("resolveUserId")).toBe(false);
    expect(isTwitchApiCommand("resolveCategory")).toBe(false);
    expect(isTwitchApiCommand("constructor")).toBe(false);
  });

  test("names only methods that exist", () => {
    for (const command of TWITCH_API_COMMANDS) {
      expect(typeof (TwitchApi.prototype as unknown as Record<string, unknown>)[command]).toBe("function");
    }
  });
});

describe("timeout", () => {
  test("times a user out by name through the ban endpoint with a duration", async () => {
    const banUser = mock(async (..._args: unknown[]) => []);
    const api = new TwitchApi(helix({ banUser }), BROADCASTER);

    expect(await api.timeout({ userName: "@spammer", durationSeconds: 300, reason: " spam " })).toEqual({
      ok: true,
      userId: "target-1",
      durationSeconds: 300,
    });
    expect(banUser.mock.calls[0]).toEqual([BROADCASTER, { user: "target-1", duration: 300, reason: "spam" }]);
  });

  test("refuses a duration Twitch would reject", async () => {
    const banUser = mock(async (..._args: unknown[]) => []);
    const api = new TwitchApi(helix({ banUser }), BROADCASTER);

    for (const durationSeconds of [0, -5, 1.5, 1_209_601, Number.NaN]) {
      await expect(api.timeout({ userId: "u", durationSeconds })).rejects.toThrow(
        "durationSeconds must be a whole number"
      );
    }
    await expect(api.timeout({ userId: "u" } as never)).rejects.toThrow("durationSeconds");
    expect(banUser).not.toHaveBeenCalled();
  });

  test("refuses a reason over 500 characters", async () => {
    const banUser = mock(async (..._args: unknown[]) => []);
    const api = new TwitchApi(helix({ banUser }), BROADCASTER);

    await expect(api.timeout({ userId: "u", durationSeconds: 60, reason: "a".repeat(501) })).rejects.toThrow(
      "longer than 500"
    );
    expect(banUser).not.toHaveBeenCalled();
  });

  test("refuses to time out the broadcaster", async () => {
    const api = new TwitchApi(helix({}), BROADCASTER);
    await expect(api.timeout({ userId: BROADCASTER.id, durationSeconds: 60 })).rejects.toThrow("broadcaster cannot");
  });

  test("names the command when nobody is named", async () => {
    const api = new TwitchApi(helix({}), BROADCASTER);
    await expect(api.timeout({ durationSeconds: 60 })).rejects.toThrow("timeout: userId or userName is required");
  });
});

describe("updateStream", () => {
  test("sends title and tags as given, leaving the category alone", async () => {
    const updateChannelInfo = mock(async (..._args: unknown[]) => {});
    const api = new TwitchApi(helix({ updateChannelInfo }), BROADCASTER);

    const result = await api.updateStream({ title: "  Building a bot  ", tags: ["English", "Programming"] });
    expect(result).toEqual({ ok: true, title: "Building a bot", tags: ["English", "Programming"] });
    expect(updateChannelInfo.mock.calls[0]).toEqual([
      BROADCASTER,
      { title: "Building a bot", gameId: undefined, tags: ["English", "Programming"] },
    ]);
  });

  test("prefers an exact category name over the first search result", async () => {
    const searchCategories = categories("IRL Games", "IRL");
    const updateChannelInfo = mock(async (..._args: unknown[]) => {});
    const api = new TwitchApi(helix({ searchCategories, updateChannelInfo }), BROADCASTER);

    const result = await api.updateStream({ category: "irl" });
    expect(result).toEqual({ ok: true, categoryId: "game-1", categoryName: "IRL" });
    expect(updateChannelInfo.mock.calls[0]).toEqual([
      BROADCASTER,
      { title: undefined, gameId: "game-1", tags: undefined },
    ]);
  });

  test("falls back to the most relevant result when no name matches exactly", async () => {
    const api = new TwitchApi(
      helix({ searchCategories: categories("Software and Game Development", "Software") }),
      BROADCASTER
    );

    const result = await api.updateStream({ category: "software and game" });
    expect(result.categoryName).toBe("Software and Game Development");
  });

  test("says which category it could not find, and changes nothing", async () => {
    const updateChannelInfo = mock(async (..._args: unknown[]) => {});
    const api = new TwitchApi(helix({ searchCategories: categories(), updateChannelInfo }), BROADCASTER);

    await expect(api.updateStream({ category: "zzzz" })).rejects.toThrow('no Twitch category matches "zzzz"');
    expect(updateChannelInfo).not.toHaveBeenCalled();
  });

  test("uses a category id as given without searching", async () => {
    const searchCategories = categories("x");
    const api = new TwitchApi(helix({ searchCategories }), BROADCASTER);

    expect(await api.updateStream({ categoryId: "509658" })).toEqual({ ok: true, categoryId: "509658" });
    expect(searchCategories).not.toHaveBeenCalled();
  });

  test("refuses category and categoryId together", async () => {
    const api = new TwitchApi(helix({}), BROADCASTER);
    await expect(api.updateStream({ category: "IRL", categoryId: "1" })).rejects.toThrow("not both");
  });

  test("refuses an update with nothing in it", async () => {
    const api = new TwitchApi(helix({}), BROADCASTER);
    await expect(api.updateStream({})).rejects.toThrow("nothing to update");
  });

  // A bad tag must not let the valid title through on its own.
  test("validates everything before calling Twitch", async () => {
    const updateChannelInfo = mock(async (..._args: unknown[]) => {});
    const api = new TwitchApi(helix({ updateChannelInfo }), BROADCASTER);

    await expect(api.updateStream({ title: "fine", tags: ["has space"] })).rejects.toThrow("letters and numbers");
    expect(updateChannelInfo).not.toHaveBeenCalled();
  });
});

describe("validateTitle", () => {
  test("accepts 140 characters and refuses 141", () => {
    expect(validateTitle("a".repeat(140))).toHaveLength(140);
    expect(() => validateTitle("a".repeat(141))).toThrow("at most 140");
  });

  test("counts characters, not UTF-16 units", () => {
    expect(validateTitle(`${"a".repeat(139)}🐺`)).toHaveLength(141);
  });

  test("refuses a title that is not text", () => {
    expect(() => validateTitle(42)).toThrow("title must be a string");
  });

  test("refuses a blank title", () => {
    expect(() => validateTitle("   ")).toThrow("cannot be empty");
  });
});

describe("validateTags", () => {
  test("accepts letters and numbers in any script", () => {
    expect(validateTags(["English", "日本語", "Web3", "हिन्दी"])).toEqual(["English", "日本語", "Web3", "हिन्दी"]);
  });

  test("refuses more than ten tags", () => {
    expect(() => validateTags(Array.from({ length: 11 }, (_, i) => `tag${i}`))).toThrow("at most 10");
  });

  test("refuses a tag over 25 characters", () => {
    expect(() => validateTags(["a".repeat(26)])).toThrow("longer than 25");
  });

  test("refuses spaces, punctuation and empty tags", () => {
    expect(() => validateTags(["two words"])).toThrow("letters and numbers");
    expect(() => validateTags(["c++"])).toThrow("letters and numbers");
    expect(() => validateTags([""])).toThrow("cannot be empty");
  });

  test("refuses the same tag twice in any case", () => {
    expect(() => validateTags(["Chill", "chill"])).toThrow("listed twice");
  });

  test("refuses something that is not a list of strings", () => {
    expect(() => validateTags("English")).toThrow("array of strings");
    expect(() => validateTags([1])).toThrow("array of strings");
  });
});

describe("createMarker", () => {
  test("returns the marker Twitch placed", async () => {
    const createStreamMarker = mock(async (..._args: unknown[]) => ({
      id: "m1",
      creationDate: new Date("2026-09-28T12:00:00Z"),
      description: "clutch",
      positionInSeconds: 3600,
    }));
    const api = new TwitchApi(helix({ createStreamMarker }), BROADCASTER);

    expect(await api.createMarker({ description: " clutch " })).toEqual({
      id: "m1",
      createdAt: "2026-09-28T12:00:00.000Z",
      description: "clutch",
      positionSeconds: 3600,
    });
    expect(createStreamMarker.mock.calls[0]).toEqual([BROADCASTER, "clutch"]);
  });

  test("sends no description when none is given", async () => {
    const createStreamMarker = mock(async (..._args: unknown[]) => ({
      id: "m2",
      creationDate: new Date(0),
      description: "",
      positionInSeconds: 1,
    }));
    const api = new TwitchApi(helix({ createStreamMarker }), BROADCASTER);

    await api.createMarker({});
    expect(createStreamMarker.mock.calls[0]).toEqual([BROADCASTER, undefined]);
  });

  test("explains a 404 as the stream being offline", async () => {
    const offline = Object.assign(new Error("Encountered HTTP status code 404: Not Found"), { statusCode: 404 });
    const api = new TwitchApi(
      helix({ createStreamMarker: mock(async (..._args: unknown[]) => Promise.reject(offline)) }),
      BROADCASTER
    );

    await expect(api.createMarker({})).rejects.toThrow("the channel is not live");
  });

  test("passes any other failure through", async () => {
    const denied = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const api = new TwitchApi(
      helix({ createStreamMarker: mock(async (..._args: unknown[]) => Promise.reject(denied)) }),
      BROADCASTER
    );

    await expect(api.createMarker({})).rejects.toThrow("Unauthorized");
  });

  test("refuses a description over 140 characters", async () => {
    const createStreamMarker = mock(async (..._args: unknown[]) => ({}));
    const api = new TwitchApi(helix({ createStreamMarker }), BROADCASTER);

    await expect(api.createMarker({ description: "a".repeat(141) })).rejects.toThrow("at most 140");
    expect(createStreamMarker).not.toHaveBeenCalled();
  });
});

describe("searchCategories", () => {
  test("returns id, name and box art, asking Twitch for ten by default", async () => {
    const searchCategories = categories("Just Chatting");
    const api = new TwitchApi(helix({ searchCategories }), BROADCASTER);

    expect(await api.searchCategories({ query: " just " })).toEqual([
      { id: "game-0", name: "Just Chatting", boxArtUrl: "https://box/0.jpg" },
    ]);
    expect(searchCategories.mock.calls[0]).toEqual(["just", { limit: 10 }]);
  });

  test("refuses an empty query or an out-of-range page size", async () => {
    const api = new TwitchApi(helix({}), BROADCASTER);

    await expect(api.searchCategories({ query: " " })).rejects.toThrow("query is required");
    await expect(api.searchCategories({ query: "x", first: 0 })).rejects.toThrow("from 1 to 100");
    await expect(api.searchCategories({ query: "x", first: 101 })).rejects.toThrow("from 1 to 100");
  });
});

describe("getStreamInfo", () => {
  test("reads title, category and tags off the channel", async () => {
    const getChannelInfoById = mock(async (..._args: unknown[]) => ({
      title: "Live coding",
      gameId: "1469308723",
      gameName: "Software and Game Development",
      tags: ["English"],
      language: "en",
    }));
    const api = new TwitchApi(helix({ getChannelInfoById }), BROADCASTER);

    expect(await api.getStreamInfo({})).toEqual({
      title: "Live coding",
      categoryId: "1469308723",
      categoryName: "Software and Game Development",
      tags: ["English"],
      language: "en",
    });
  });
});
