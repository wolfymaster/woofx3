import type { ApiClient, HelixUser } from "@twurple/api";
import { describe, expect, mock, test } from "bun:test";
import TwitchApi from "./twitch";

const BROADCASTER = { id: "broadcaster-1" } as HelixUser;

function apiClientWith(overrides: {
  shoutoutUser?: ReturnType<typeof mock>;
  getUserByName?: ReturnType<typeof mock>;
}) {
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
