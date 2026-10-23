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
    [
      "an avatar that is not https",
      { data: [{ ...USER, profile_image_url: "javascript:alert(1)" }] },
      { userId: "42", login: "streamer", displayName: "Streamer", profileImageUrl: null },
    ],
    [
      "an avatar that is not a URL",
      { data: [{ ...USER, profile_image_url: "not a url" }] },
      { userId: "42", login: "streamer", displayName: "Streamer", profileImageUrl: null },
    ],
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
    const refused: TwitchHelixResult = {
      ok: false,
      code: "unavailable",
      error: "Twitch is not connected in this engine",
    };

    expect(await profiles.lookup("42", async () => refused)).toBeNull();
    expect(await profiles.lookup("42", async () => ok({ data: [] }))).toBeNull();
    expect(await profiles.lookup("42", async () => ok({ data: [USER] }))).toMatchObject({ login: "streamer" });
  });

  test("concurrent lookups of one user share one Helix call", async () => {
    const profiles = new TwitchProfiles({ logger: LOGGER, now: () => 0 });
    let answer: (result: TwitchHelixResult) => void = () => {};
    const getUsers = mock(
      () =>
        new Promise<TwitchHelixResult>((resolve) => {
          answer = resolve;
        })
    );

    const lookups = Promise.all([profiles.lookup("42", getUsers), profiles.lookup("42", getUsers)]);
    answer(ok({ data: [USER] }));

    expect((await lookups).map((p) => p?.login)).toEqual(["streamer", "streamer"]);
    expect(getUsers).toHaveBeenCalledTimes(1);
  });

  test("forget drops the kept profile, and a lookup in flight when it was called is not kept", async () => {
    const profiles = new TwitchProfiles({ logger: LOGGER, now: () => 0 });
    await profiles.lookup("42", async () => ok({ data: [USER] }));

    profiles.forget();
    const getUsers = mock(async () => ok({ data: [{ ...USER, login: "renamed" }] }));
    expect((await profiles.lookup("42", getUsers))?.login).toBe("renamed");

    let answer: (result: TwitchHelixResult) => void = () => {};
    const stale = profiles.lookup(
      "7",
      () =>
        new Promise<TwitchHelixResult>((resolve) => {
          answer = resolve;
        })
    );
    profiles.forget();
    answer(ok({ data: [{ ...USER, id: "7", login: "old" }] }));
    await stale;

    const fresh = mock(async () => ok({ data: [{ ...USER, id: "7", login: "new" }] }));
    expect((await profiles.lookup("7", fresh))?.login).toBe("new");
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  test("refuses a time to keep that is not positive", () => {
    expect(() => new TwitchProfiles({ logger: LOGGER, ttlMs: 0 })).toThrow("ttlMs must be positive");
  });
});
