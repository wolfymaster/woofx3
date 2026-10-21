import { describe, expect, mock, test } from "bun:test";
import type { TwitchHelixResult } from "@woofx3/api";
import { readHelixUser, TwitchProfiles } from "../src/twitch-profiles";

const LOGGER = { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never;

const USER = { id: "42", login: "streamer", display_name: "Streamer", profile_image_url: "https://cdn.example/a.png" };

describe("readHelixUser", () => {
  const cases: [string, unknown, ReturnType<typeof readHelixUser>][] = [
    [
      "the user asked for",
      { data: [USER] },
      { userId: "42", login: "streamer", displayName: "Streamer", profileImageUrl: "https://cdn.example/a.png" },
    ],
    [
      "a user with no display name or avatar",
      { data: [{ id: "42", login: "streamer", display_name: "", profile_image_url: "" }] },
      { userId: "42", login: "streamer", displayName: "streamer", profileImageUrl: null },
    ],
    ["another user", { data: [{ ...USER, id: "7" }] }, null],
    ["a user with no login", { data: [{ ...USER, login: "" }] }, null],
    ["no users", { data: [] }, null],
    ["a body with no data list", { data: "nope" }, null],
    ["no body", null, null],
  ];

  for (const [name, body, expected] of cases) {
    test(name, () => {
      expect(readHelixUser(body, "42")).toEqual(expected);
    });
  }
});

describe("TwitchProfiles", () => {
  const ok = (body: unknown): TwitchHelixResult => ({ ok: true, body });

  test("keeps a profile until its time is up, then asks again", async () => {
    let now = 0;
    const profiles = new TwitchProfiles({ logger: LOGGER, ttlMs: 1_000, now: () => now });
    const getUsers = mock(async () => ok({ data: [USER] }));

    await profiles.lookup("42", getUsers);
    now = 999;
    await profiles.lookup("42", getUsers);
    expect(getUsers).toHaveBeenCalledTimes(1);

    now = 1_000;
    await profiles.lookup("42", getUsers);
    expect(getUsers).toHaveBeenCalledTimes(2);
  });

  test("asks again for another user", async () => {
    const profiles = new TwitchProfiles({ logger: LOGGER, now: () => 0 });
    await profiles.lookup("42", async () => ok({ data: [USER] }));

    const other = await profiles.lookup("7", async () => ok({ data: [{ ...USER, id: "7", login: "other" }] }));

    expect(other?.login).toBe("other");
  });

  test("does not keep a failed lookup", async () => {
    const profiles = new TwitchProfiles({ logger: LOGGER, now: () => 0 });
    const refused: TwitchHelixResult = { ok: false, code: "unavailable", error: "The twitch service is not running" };

    expect(await profiles.lookup("42", async () => refused)).toBeNull();
    expect(await profiles.lookup("42", async () => ok({ data: [] }))).toBeNull();
    expect(await profiles.lookup("42", async () => ok({ data: [USER] }))).toMatchObject({ login: "streamer" });
  });

  test("refuses a time to keep that is not positive", () => {
    expect(() => new TwitchProfiles({ logger: LOGGER, ttlMs: 0 })).toThrow("ttlMs must be positive");
  });
});
