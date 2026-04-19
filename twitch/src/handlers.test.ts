import type { ApiClient, HelixUser } from "@twurple/api";
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  chatMessage,
  clip,
  getChatters,
  shoutoutUser,
  timeoutUser,
  updateStream,
  userInfo,
} from "./handlers";

describe("getChatters", () => {
  const prevChannel = process.env.TWITCH_CHANNEL_NAME;

  afterEach(() => {
    if (prevChannel === undefined) {
      delete process.env.TWITCH_CHANNEL_NAME;
    } else {
      process.env.TWITCH_CHANNEL_NAME = prevChannel;
    }
  });

  test("returns chatters when the broadcaster and chatters requests succeed", async () => {
    process.env.TWITCH_CHANNEL_NAME = "chan";
    const broadcaster = { id: "b1" };
    const chatter = { userName: "viewer1" };
    const getUserByName = mock(async () => broadcaster);
    const getChattersFn = mock(async () => ({ data: [chatter] }));
    const apiClient = {
      users: { getUserByName },
      chat: { getChatters: getChattersFn },
    } as unknown as ApiClient;

    const result = await getChatters(apiClient);

    expect(result.error).toBe(false);
    expect(getUserByName).toHaveBeenCalledWith("chan");
    expect(getChattersFn).toHaveBeenCalled();
    if (!result.error) {
      expect(result.payload).toEqual([chatter]);
    }
  });

  test("returns an error when the broadcaster cannot be resolved", async () => {
    process.env.TWITCH_CHANNEL_NAME = "missing";
    const apiClient = {
      users: { getUserByName: mock(async () => null) },
      chat: { getChatters: mock(async () => ({ data: [] })) },
    } as unknown as ApiClient;

    const result = await getChatters(apiClient);

    expect(result.error).toBe(true);
    if (result.error) {
      expect(result.errorMsg).toContain("broadcaster");
    }
  });
});

describe("updateStream", () => {
  const prevChannel = process.env.TWITCH_CHANNEL_NAME;

  afterEach(() => {
    if (prevChannel === undefined) {
      delete process.env.TWITCH_CHANNEL_NAME;
    } else {
      process.env.TWITCH_CHANNEL_NAME = prevChannel;
    }
  });

  test("updates category via game id when a category is provided", async () => {
    process.env.TWITCH_CHANNEL_NAME = "chan";
    const broadcaster = { id: "b1" };
    const game = { id: "game-1", name: "Science" };
    const getUserByName = mock(async () => broadcaster);
    const getGameByName = mock(async () => game);
    const updateChannelInfo = mock(async () => {});
    const apiClient = {
      users: { getUserByName },
      games: { getGameByName },
      channels: { updateChannelInfo },
    } as unknown as ApiClient;

    const result = await updateStream(apiClient, { category: "Science" });

    expect(result.error).toBe(false);
    expect(getGameByName).toHaveBeenCalledWith("Science");
    expect(updateChannelInfo).toHaveBeenCalledWith(broadcaster, { gameId: game.id });
  });

  test("returns an error when the category does not match a Twitch game", async () => {
    process.env.TWITCH_CHANNEL_NAME = "chan";
    const apiClient = {
      users: { getUserByName: mock(async () => ({ id: "b1" })) },
      games: { getGameByName: mock(async () => null) },
      channels: { updateChannelInfo: mock(async () => {}) },
    } as unknown as ApiClient;

    const result = await updateStream(apiClient, { category: "Nope" });

    expect(result.error).toBe(true);
  });

  test("updates title when only title is provided", async () => {
    process.env.TWITCH_CHANNEL_NAME = "chan";
    const broadcaster = { id: "b1" };
    const updateChannelInfo = mock(async () => {});
    const apiClient = {
      users: { getUserByName: mock(async () => broadcaster) },
      channels: { updateChannelInfo },
    } as unknown as ApiClient;

    const result = await updateStream(apiClient, { title: "New title" });

    expect(result.error).toBe(false);
    expect(updateChannelInfo).toHaveBeenCalledWith(broadcaster, { title: "New title" });
  });
});

describe("chatMessage", () => {
  test("appends a chat line onto the queue", async () => {
    const queue: { user: string; message: string }[] = [];
    const result = await chatMessage(queue, { user: "u1", message: "hi" });
    expect(result.error).toBe(false);
    expect(queue).toEqual([{ user: "u1", message: "hi" }]);
  });
});

describe("timeoutUser", () => {
  test("no-ops when the target user does not exist", async () => {
    const apiClient = {
      users: { getUserByName: mock(async () => null) },
      moderation: { banUser: mock(async () => {}) },
    } as unknown as ApiClient;
    const broadcaster = { id: "b1" } as HelixUser;

    await timeoutUser(apiClient, { user: "ghost", duration: 60 }, broadcaster);

    expect(apiClient.moderation.banUser).not.toHaveBeenCalled();
  });

  test("applies a timed ban for the resolved user", async () => {
    const target = { id: "t1", name: "bad" };
    const banUser = mock(async () => {});
    const apiClient = {
      users: { getUserByName: mock(async () => target) },
      moderation: { banUser },
    } as unknown as ApiClient;
    const broadcaster = { id: "b1" } as HelixUser;

    await timeoutUser(apiClient, { user: "bad", duration: 120 }, broadcaster);

    expect(banUser).toHaveBeenCalledWith(broadcaster, {
      reason: "",
      user: target,
      duration: 120,
    });
  });
});

describe("shoutoutUser", () => {
  test("no-ops when the user cannot be resolved", async () => {
    const shoutoutUserFn = mock(async () => {});
    const apiClient = {
      users: { getUserByName: mock(async () => null) },
      chat: { shoutoutUser: shoutoutUserFn },
    } as unknown as ApiClient;

    await shoutoutUser(apiClient, { user: "nope" }, { id: "b1" } as HelixUser);

    expect(shoutoutUserFn).not.toHaveBeenCalled();
  });

  test("asks Helix chat to shout out the resolved user", async () => {
    const target = { id: "t1" };
    const shoutoutUserFn = mock(async () => {});
    const apiClient = {
      users: { getUserByName: mock(async () => target) },
      chat: { shoutoutUser: shoutoutUserFn },
    } as unknown as ApiClient;
    const broadcaster = { id: "b1" } as HelixUser;

    await shoutoutUser(apiClient, { user: "peer" }, broadcaster);

    expect(shoutoutUserFn).toHaveBeenCalledWith(broadcaster, target);
  });
});

describe("userInfo", () => {
  test("returns false when the username does not resolve", async () => {
    const apiClient = {
      users: { getUserByName: mock(async () => null) },
      channels: { getChannelFollowers: mock(async () => ({ data: [] })) },
    } as unknown as ApiClient;

    const result = await userInfo(apiClient, { username: "x" }, { id: "b1" } as HelixUser);
    expect(result).toBe(false);
  });

  test("returns false when the user is not following the channel", async () => {
    const apiClient = {
      users: { getUserByName: mock(async () => ({ id: "u1" })) },
      channels: { getChannelFollowers: mock(async () => ({ data: [] })) },
    } as unknown as ApiClient;

    const result = await userInfo(apiClient, { username: "u" }, { id: "b1" } as HelixUser);
    expect(result).toBe(false);
  });

  test("returns true when at least one follow relationship exists", async () => {
    const apiClient = {
      users: { getUserByName: mock(async () => ({ id: "u1" })) },
      channels: { getChannelFollowers: mock(async () => ({ data: [{}] })) },
    } as unknown as ApiClient;

    const result = await userInfo(apiClient, { username: "u" }, { id: "b1" } as HelixUser);
    expect(result).toBe(true);
  });
});

describe("clip (handlers)", () => {
  test("returns a woofwoofwoof command payload with the clip URL", async () => {
    const createClip = mock(async () => "clipId99");
    const apiClient = {
      clips: { createClip },
    } as unknown as ApiClient;
    const broadcaster = { id: "b1" } as HelixUser;

    const result = await clip(apiClient, {}, broadcaster);

    expect(createClip).toHaveBeenCalledWith({ channel: broadcaster });
    expect(result).toEqual({
      command: "woofwoofwoof",
      message: "https://clips.twitch.tv/clipId99",
    });
  });
});
