import type { ApiClient } from "@twurple/api";
import type { HelixUser } from "@twurple/api";
import { describe, expect, mock, test } from "bun:test";
import TwitchApi from "./twitch";

describe("TwitchApi", () => {
  test("clip asks Helix to create a clip for the broadcaster and returns a chat command with the clip URL", async () => {
    const createClip = mock(async () => "abcClipId");
    const apiClient = {
      clips: { createClip },
    } as unknown as ApiClient;

    const broadcaster = { id: "b1", name: "streamer" } as HelixUser;
    const api = new TwitchApi(apiClient, broadcaster);

    const result = await api.clip({});

    expect(result.error).toBe(false);
    expect(createClip).toHaveBeenCalledWith({ channel: broadcaster });
    expect(result.command?.topic).toBe("woofwoofwoof");
    expect(result.command?.command).toBe("write_message");
    expect(result.command?.args).toEqual({
      message: "https://clips.twitch.tv/abcClipId",
    });
  });
});
