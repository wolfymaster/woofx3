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

    expect(createClip).toHaveBeenCalledWith({ channel: broadcaster });
    expect(result.id).toBe("abcClipId");
    expect(result.url).toBe("https://clips.twitch.tv/abcClipId");
  });
});
