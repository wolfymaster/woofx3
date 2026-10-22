import { describe, expect, test } from "bun:test";
import {
  collectHelixPages,
  helixAdTime,
  helixErrorMessage,
  parseHelixAdSchedule,
  parseHelixAdSnooze,
  parseHelixBlockedTermsPage,
  parseHelixCategories,
  parseHelixChannelInformation,
  parseHelixChatMessageResult,
  parseHelixChatPin,
  parseHelixChatSettings,
  parseHelixChattersPage,
  parseHelixClip,
  parseHelixStreamMarker,
  parseHelixUser,
} from "../twitch-helix-bodies";

/** Bodies no reader accepts: not an object, or no `data` list. */
const NOT_HELIX: { name: string; body: unknown }[] = [
  { name: "nothing (a 204)", body: null },
  { name: "undefined", body: undefined },
  { name: "text", body: "ok" },
  { name: "a bare list", body: [{ id: "1" }] },
  { name: "no data", body: { total: 0 } },
  { name: "data that is not a list", body: { data: { id: "1" } } },
];

describe("helixErrorMessage", () => {
  const cases: { name: string; text: string; message: string | null }[] = [
    {
      name: "Twitch's error body",
      text: '{"error":"Bad Request","status":400,"message":"The tag contains an invalid character"}',
      message: "The tag contains an invalid character",
    },
    { name: "an empty message", text: '{"error":"Bad Request","status":400,"message":""}', message: null },
    { name: "no message", text: '{"error":"Too Many Requests","status":429}', message: null },
    { name: "a message that is not text", text: '{"message":42}', message: null },
    { name: "JSON that is not an object", text: '["message"]', message: null },
    { name: "a proxy's page", text: "<html>502 Bad Gateway</html>", message: null },
    { name: "an empty body", text: "", message: null },
  ];

  for (const { name, text, message } of cases) {
    test(`${name} -> ${JSON.stringify(message)}`, () => {
      expect(helixErrorMessage(text)).toBe(message);
    });
  }
});

describe("parseHelixUser", () => {
  const cases: { name: string; body: unknown; user: ReturnType<typeof parseHelixUser> }[] = [
    {
      name: "a full user",
      body: {
        data: [
          {
            id: "141981764",
            login: "twitchdev",
            display_name: "TwitchDev",
            broadcaster_type: "partner",
            profile_image_url: "https://static-cdn.jtvnw.net/a.png",
          },
        ],
      },
      user: {
        userId: "141981764",
        login: "twitchdev",
        displayName: "TwitchDev",
        broadcasterType: "partner",
        profileImageUrl: "https://static-cdn.jtvnw.net/a.png",
      },
    },
    {
      name: "a regular broadcaster with no display name or avatar",
      body: { data: [{ id: "1", login: "pup", display_name: "", broadcaster_type: "", profile_image_url: "" }] },
      user: { userId: "1", login: "pup", displayName: "pup", broadcasterType: "" },
    },
    { name: "no such user", body: { data: [] }, user: null },
    { name: "a user without a login", body: { data: [{ id: "1" }] }, user: null },
    { name: "an id that is not text", body: { data: [{ id: 1, login: "pup" }] }, user: null },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, user: null })),
  ];

  for (const { name, body, user } of cases) {
    test(name, () => {
      expect(parseHelixUser(body)).toEqual(user);
    });
  }
});

describe("parseHelixChannelInformation", () => {
  const cases: { name: string; body: unknown; info: ReturnType<typeof parseHelixChannelInformation> }[] = [
    {
      name: "a channel with a category and tags",
      body: { data: [{ title: "Speedruns", game_id: "509658", game_name: "Just Chatting", tags: ["English", 3] }] },
      info: { title: "Speedruns", category: { id: "509658", name: "Just Chatting" }, tags: ["English"] },
    },
    {
      name: "a channel with no category",
      body: { data: [{ title: "Hi", game_id: "", game_name: "" }] },
      info: { title: "Hi", category: null, tags: [] },
    },
    {
      name: "a channel with nothing set",
      body: { data: [{}] },
      info: { title: "", category: null, tags: [] },
    },
    { name: "no channel", body: { data: [] }, info: null },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, info: null })),
  ];

  for (const { name, body, info } of cases) {
    test(name, () => {
      expect(parseHelixChannelInformation(body)).toEqual(info);
    });
  }
});

describe("parseHelixCategories", () => {
  const cases: { name: string; body: unknown; categories: ReturnType<typeof parseHelixCategories> }[] = [
    {
      name: "categories with and without box art",
      body: {
        data: [
          { id: "1", name: "Chess", box_art_url: "https://static-cdn.jtvnw.net/ttv-boxart/1-{width}x{height}.jpg" },
          { id: "2", name: "Art", box_art_url: "" },
        ],
      },
      categories: [
        { id: "1", name: "Chess", boxArtUrl: "https://static-cdn.jtvnw.net/ttv-boxart/1-{width}x{height}.jpg" },
        { id: "2", name: "Art" },
      ],
    },
    {
      name: "entries without an id or name are skipped",
      body: { data: [{ id: "1" }, { name: "Art" }, null, { id: "3", name: "Music" }] },
      categories: [{ id: "3", name: "Music" }],
    },
    { name: "no results", body: { data: [] }, categories: [] },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, categories: null })),
  ];

  for (const { name, body, categories } of cases) {
    test(name, () => {
      expect(parseHelixCategories(body)).toEqual(categories);
    });
  }
});

describe("parseHelixStreamMarker", () => {
  const cases: { name: string; body: unknown; marker: ReturnType<typeof parseHelixStreamMarker> }[] = [
    {
      name: "a marker",
      body: { data: [{ id: "m", position_seconds: 244, created_at: "2026-10-22T10:00:00Z" }] },
      marker: { positionSeconds: 244, createdAt: "2026-10-22T10:00:00Z" },
    },
    {
      name: "a marker with neither field readable",
      body: { data: [{ position_seconds: "244", created_at: 5 }] },
      marker: { positionSeconds: null, createdAt: null },
    },
    { name: "no marker", body: { data: [] }, marker: null },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, marker: null })),
  ];

  for (const { name, body, marker } of cases) {
    test(name, () => {
      expect(parseHelixStreamMarker(body)).toEqual(marker);
    });
  }
});

describe("parseHelixClip", () => {
  const cases: { name: string; body: unknown; clip: ReturnType<typeof parseHelixClip> }[] = [
    {
      name: "a clip",
      body: { data: [{ id: "FiveWordsForClipSlug", edit_url: "https://clips.twitch.tv/x/edit" }] },
      clip: { clipId: "FiveWordsForClipSlug", editUrl: "https://clips.twitch.tv/x/edit" },
    },
    { name: "a clip without an edit page", body: { data: [{ id: "x" }] }, clip: null },
    { name: "no clip", body: { data: [] }, clip: null },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, clip: null })),
  ];

  for (const { name, body, clip } of cases) {
    test(name, () => {
      expect(parseHelixClip(body)).toEqual(clip);
    });
  }
});

describe("parseHelixChatMessageResult", () => {
  const cases: { name: string; body: unknown; result: ReturnType<typeof parseHelixChatMessageResult> }[] = [
    {
      name: "a sent message",
      body: { data: [{ message_id: "abc", is_sent: true }] },
      result: { sent: true, messageId: "abc" },
    },
    {
      name: "a message AutoMod held",
      body: {
        data: [
          { message_id: "", is_sent: false, drop_reason: { code: "msg_rejected", message: "Your message was held" } },
        ],
      },
      result: { sent: false, dropReason: "Your message was held" },
    },
    {
      name: "a drop with no reason",
      body: { data: [{ message_id: "", is_sent: false, drop_reason: null }] },
      result: { sent: false, dropReason: null },
    },
    {
      name: "sent without a message id is still sent, so nobody resends it",
      body: { data: [{ is_sent: true }] },
      result: { sent: true, messageId: null },
    },
    {
      name: "sent with an empty message id",
      body: { data: [{ message_id: "", is_sent: true }] },
      result: { sent: true, messageId: null },
    },
    {
      name: "is_sent as text is not sent",
      body: { data: [{ message_id: "abc", is_sent: "true" }] },
      result: { sent: false, dropReason: null },
    },
    { name: "no result", body: { data: [] }, result: { sent: false, dropReason: null } },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, result: { sent: false as const, dropReason: null } })),
  ];

  for (const { name, body, result } of cases) {
    test(name, () => {
      expect(parseHelixChatMessageResult(body)).toEqual(result);
    });
  }
});

describe("parseHelixChattersPage", () => {
  const cases: { name: string; body: unknown; page: ReturnType<typeof parseHelixChattersPage> }[] = [
    {
      name: "a page with a next cursor",
      body: {
        data: [
          { user_id: "1", user_login: "pup", user_name: "Pup" },
          { user_id: "2", user_login: "wolf", user_name: "" },
        ],
        pagination: { cursor: "eyJiIjpudWxs" },
        total: 8,
      },
      page: {
        items: [
          { userId: "1", login: "pup", displayName: "Pup" },
          { userId: "2", login: "wolf", displayName: "wolf" },
        ],
        cursor: "eyJiIjpudWxs",
      },
    },
    {
      name: "the last page, with an empty pagination",
      body: { data: [{ user_id: "1", user_login: "pup", user_name: "Pup" }], pagination: {} },
      page: { items: [{ userId: "1", login: "pup", displayName: "Pup" }], cursor: null },
    },
    {
      name: "chatters without an id or login are skipped",
      body: { data: [{ user_login: "pup" }, { user_id: "2" }, "wolf"] },
      page: { items: [], cursor: null },
    },
    { name: "an empty chat", body: { data: [], pagination: { cursor: "" } }, page: { items: [], cursor: null } },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, page: null })),
  ];

  for (const { name, body, page } of cases) {
    test(name, () => {
      expect(parseHelixChattersPage(body)).toEqual(page);
    });
  }
});

describe("parseHelixBlockedTermsPage", () => {
  const cases: { name: string; body: unknown; page: ReturnType<typeof parseHelixBlockedTermsPage> }[] = [
    {
      name: "terms with and without an expiry",
      body: {
        data: [
          { id: "t1", text: "badword", created_at: "2026-10-01T00:00:00Z", expires_at: null },
          { id: "t2", text: "spoiler", created_at: "2026-10-02T00:00:00Z", expires_at: "2026-10-03T00:00:00Z" },
        ],
        pagination: { cursor: "next" },
      },
      page: {
        items: [
          { id: "t1", text: "badword", createdAt: "2026-10-01T00:00:00Z", expiresAt: null },
          { id: "t2", text: "spoiler", createdAt: "2026-10-02T00:00:00Z", expiresAt: "2026-10-03T00:00:00Z" },
        ],
        cursor: "next",
      },
    },
    {
      name: "the term an add returns, with no pagination",
      body: { data: [{ id: "t3", text: "new" }] },
      page: { items: [{ id: "t3", text: "new", createdAt: null, expiresAt: null }], cursor: null },
    },
    {
      name: "terms without an id or text are skipped",
      body: { data: [{ id: "t1" }, { text: "x" }, { id: "t2", text: "" }] },
      page: { items: [], cursor: null },
    },
    {
      name: "a cursor that is not text ends the list",
      body: { data: [], pagination: { cursor: 7 } },
      page: { items: [], cursor: null },
    },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, page: null })),
  ];

  for (const { name, body, page } of cases) {
    test(name, () => {
      expect(parseHelixBlockedTermsPage(body)).toEqual(page);
    });
  }
});

describe("collectHelixPages", () => {
  /** Serves `pages` in order, each pointing at the next by cursor `p<index>`, and records the cursors asked for. */
  function pager(pages: unknown[][]) {
    const asked: Array<string | undefined> = [];
    const fetchPage = async (cursor: string | undefined): Promise<unknown> => {
      asked.push(cursor);
      const index = cursor === undefined ? 0 : Number(cursor.slice(1));
      const next = index + 1 < pages.length ? `p${index + 1}` : undefined;
      return { data: pages[index], pagination: next ? { cursor: next } : {} };
    };
    return { asked, fetchPage };
  }

  const term = (id: string) => ({ id, text: id });
  const parse = parseHelixBlockedTermsPage;

  const cases: {
    name: string;
    pages: unknown[][];
    maxPages: number;
    ids: string[];
    truncated: boolean;
    asked: number;
  }[] = [
    { name: "one page", pages: [[term("a")]], maxPages: 5, ids: ["a"], truncated: false, asked: 1 },
    {
      name: "every page, following the cursor",
      pages: [[term("a")], [term("b")], [term("c")]],
      maxPages: 5,
      ids: ["a", "b", "c"],
      truncated: false,
      asked: 3,
    },
    {
      name: "stops at the page limit and says so",
      pages: [[term("a")], [term("b")], [term("c")]],
      maxPages: 2,
      ids: ["a", "b"],
      truncated: true,
      asked: 2,
    },
    {
      name: "exactly the page limit is complete",
      pages: [[term("a")], [term("b")]],
      maxPages: 2,
      ids: ["a", "b"],
      truncated: false,
      asked: 2,
    },
    { name: "an empty list", pages: [[]], maxPages: 1, ids: [], truncated: false, asked: 1 },
  ];

  for (const { name, pages, maxPages, ids, truncated, asked } of cases) {
    test(name, async () => {
      const source = pager(pages);
      const result = await collectHelixPages(source.fetchPage, parse, maxPages);
      expect(result.items.map((item) => item.id)).toEqual(ids);
      expect(result.truncated).toBe(truncated);
      expect(source.asked).toEqual([undefined, ...Array.from({ length: asked - 1 }, (_, i) => `p${i + 1}`)]);
    });
  }

  test("an unreadable page fails the whole read", async () => {
    let calls = 0;
    const fetchPage = async (): Promise<unknown> => {
      calls += 1;
      return calls === 1 ? { data: [term("a")], pagination: { cursor: "p1" } } : "<html>";
    };
    await expect(collectHelixPages(fetchPage, parse, 5)).rejects.toThrow(/page 2 of a list/);
  });

  test("a failing fetch fails the read", async () => {
    const fetchPage = async (): Promise<unknown> => {
      throw new Error("timeout");
    };
    await expect(collectHelixPages(fetchPage, parse, 5)).rejects.toThrow("timeout");
  });

  for (const maxPages of [0, -1, 1.5, Number.NaN]) {
    test(`refuses a page limit of ${maxPages}`, async () => {
      await expect(collectHelixPages(pager([[]]).fetchPage, parse, maxPages)).rejects.toThrow(/maxPages/);
    });
  }
});

describe("parseHelixChatSettings", () => {
  const cases: { name: string; body: unknown; settings: ReturnType<typeof parseHelixChatSettings> }[] = [
    {
      name: "every mode on",
      body: {
        data: [
          {
            emote_mode: true,
            follower_mode: true,
            follower_mode_duration: 10,
            slow_mode: true,
            slow_mode_wait_time: 30,
            subscriber_mode: true,
          },
        ],
      },
      settings: {
        emoteMode: true,
        followerMode: true,
        followerModeDuration: 10,
        slowMode: true,
        slowModeWaitTime: 30,
        subscriberMode: true,
      },
    },
    {
      name: "every mode off, durations null",
      body: {
        data: [
          {
            emote_mode: false,
            follower_mode: false,
            follower_mode_duration: null,
            slow_mode: false,
            slow_mode_wait_time: null,
            subscriber_mode: false,
          },
        ],
      },
      settings: {
        emoteMode: false,
        followerMode: false,
        followerModeDuration: null,
        slowMode: false,
        slowModeWaitTime: null,
        subscriberMode: false,
      },
    },
    {
      name: "modes that are not booleans read as off",
      body: { data: [{ emote_mode: "true", slow_mode_wait_time: "30" }] },
      settings: {
        emoteMode: false,
        followerMode: false,
        followerModeDuration: null,
        slowMode: false,
        slowModeWaitTime: null,
        subscriberMode: false,
      },
    },
    { name: "no settings", body: { data: [] }, settings: null },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, settings: null })),
  ];

  for (const { name, body, settings } of cases) {
    test(name, () => {
      expect(parseHelixChatSettings(body)).toEqual(settings);
    });
  }
});

describe("parseHelixChatPin", () => {
  const cases: { name: string; body: unknown; pin: ReturnType<typeof parseHelixChatPin> }[] = [
    {
      name: "a pin with an end",
      body: {
        data: [
          {
            message_id: "m1",
            message: { text: "Giveaway at 9" },
            sender_user_name: "Wolfy",
            sender_user_login: "wolfy",
            starts_at: "2026-10-22T10:00:00Z",
            ends_at: "2026-10-22T11:00:00Z",
          },
        ],
      },
      pin: {
        messageId: "m1",
        text: "Giveaway at 9",
        senderName: "Wolfy",
        pinnedAtMs: Date.parse("2026-10-22T10:00:00Z"),
        endsAt: "2026-10-22T11:00:00Z",
      },
    },
    {
      name: "a pin lasting the stream, sender known only by login",
      body: { data: [{ message_id: "m2", sender_user_login: "wolfy", starts_at: "not a date" }] },
      pin: { messageId: "m2", text: null, senderName: "wolfy", pinnedAtMs: null, endsAt: null },
    },
    {
      name: "message text that is not text",
      body: { data: [{ message_id: "m3", message: { text: 5 } }] },
      pin: { messageId: "m3", text: null, senderName: null, pinnedAtMs: null, endsAt: null },
    },
    { name: "a pin without a message id", body: { data: [{ message: { text: "x" } }] }, pin: null },
    { name: "nothing pinned", body: { data: [] }, pin: null },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, pin: null })),
  ];

  for (const { name, body, pin } of cases) {
    test(name, () => {
      expect(parseHelixChatPin(body)).toEqual(pin);
    });
  }
});

describe("helixAdTime", () => {
  // Helix has sent each of these forms for the ad-schedule times.
  const cases: { raw: unknown; time: string | null }[] = [
    { raw: "2026-09-28T18:10:00Z", time: "2026-09-28T18:10:00.000Z" },
    { raw: "2026-09-28T13:10:00-05:00", time: "2026-09-28T18:10:00.000Z" },
    { raw: 1790619000, time: "2026-09-28T18:10:00.000Z" },
    { raw: "1790619000", time: "2026-09-28T18:10:00.000Z" },
    { raw: " 1790619000 ", time: "2026-09-28T18:10:00.000Z" },
    { raw: 1790619000.5, time: "2026-09-28T18:10:00.500Z" },
    { raw: "", time: null },
    { raw: "  ", time: null },
    { raw: 0, time: null },
    { raw: "0", time: null },
    { raw: -5, time: null },
    { raw: Number.NaN, time: null },
    { raw: null, time: null },
    { raw: undefined, time: null },
    { raw: "not a time", time: null },
    { raw: true, time: null },
    { raw: { seconds: 1 }, time: null },
  ];

  for (const { raw, time } of cases) {
    test(`${JSON.stringify(raw) ?? String(raw)} -> ${time}`, () => {
      expect(helixAdTime(raw)).toBe(time);
    });
  }
});

describe("parseHelixAdSchedule", () => {
  const NOW = "2026-09-28T18:00:00.000Z";
  const cases: { name: string; body: unknown; schedule: ReturnType<typeof parseHelixAdSchedule> }[] = [
    {
      name: "a schedule in mixed time forms",
      body: {
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
      },
      schedule: {
        nextAdAt: "2026-09-28T18:10:00.000Z",
        lastAdAt: null,
        durationSeconds: 90,
        prerollFreeSeconds: 1200,
        snoozeCount: 3,
        snoozeRefreshAt: "2026-09-28T19:00:00.000Z",
        serverNow: NOW,
      },
    },
    {
      name: "an offline channel with nothing scheduled",
      body: {
        data: [
          { next_ad_at: "", last_ad_at: "", duration: 0, preroll_free_time: 0, snooze_count: 0, snooze_refresh_at: "" },
        ],
      },
      schedule: {
        nextAdAt: null,
        lastAdAt: null,
        durationSeconds: 0,
        prerollFreeSeconds: 0,
        snoozeCount: 0,
        snoozeRefreshAt: null,
        serverNow: NOW,
      },
    },
    {
      name: "unreadable times are null and the rest still reads",
      body: {
        data: [
          {
            next_ad_at: "soon",
            last_ad_at: { at: 1 },
            duration: "90",
            preroll_free_time: 1200.7,
            snooze_count: "3",
            snooze_refresh_at: "later",
          },
        ],
      },
      schedule: {
        nextAdAt: null,
        lastAdAt: null,
        durationSeconds: 90,
        prerollFreeSeconds: 1200,
        snoozeCount: 3,
        snoozeRefreshAt: null,
        serverNow: NOW,
      },
    },
    {
      name: "unreadable counts are zero",
      body: { data: [{ duration: "long", preroll_free_time: -30, snooze_count: null }] },
      schedule: {
        nextAdAt: null,
        lastAdAt: null,
        durationSeconds: 0,
        prerollFreeSeconds: 0,
        snoozeCount: 0,
        snoozeRefreshAt: null,
        serverNow: NOW,
      },
    },
    { name: "no schedule row", body: { data: [] }, schedule: null },
    { name: "a row that is not an object", body: { data: ["schedule"] }, schedule: null },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, schedule: null })),
  ];

  for (const { name, body, schedule } of cases) {
    test(name, () => {
      expect(parseHelixAdSchedule(body, NOW)).toEqual(schedule);
    });
  }
});

describe("parseHelixAdSnooze", () => {
  const NOW = "2026-09-28T18:00:00.000Z";
  const cases: { name: string; body: unknown; snooze: ReturnType<typeof parseHelixAdSnooze> }[] = [
    {
      name: "a snooze with numeric text",
      body: { data: [{ snooze_count: "2", snooze_refresh_at: "1790622000", next_ad_at: "2026-09-28T18:15:00Z" }] },
      snooze: {
        snoozeCount: 2,
        snoozeRefreshAt: "2026-09-28T19:00:00.000Z",
        nextAdAt: "2026-09-28T18:15:00.000Z",
        serverNow: NOW,
      },
    },
    {
      name: "unreadable times are null",
      body: { data: [{ snooze_count: 0, snooze_refresh_at: "x", next_ad_at: false }] },
      snooze: { snoozeCount: 0, snoozeRefreshAt: null, nextAdAt: null, serverNow: NOW },
    },
    { name: "no result row", body: { data: [] }, snooze: null },
    ...NOT_HELIX.map(({ name, body }) => ({ name, body, snooze: null })),
  ];

  for (const { name, body, snooze } of cases) {
    test(name, () => {
      expect(parseHelixAdSnooze(body, NOW)).toEqual(snooze);
    });
  }
});
