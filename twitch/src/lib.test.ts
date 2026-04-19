import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TwitchContext } from "src/types";
import { getBroadcasterId, readTokenFromFile } from "./lib";

describe("getBroadcasterId", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns the Twitch user id from a successful Helix-style response", async () => {
    globalThis.fetch = mock(async () => ({
      json: async () => ({ data: [{ id: "u42" }] }),
    })) as unknown as typeof fetch;

    const ctx: TwitchContext = {
      apiUrl: "https://api.twitch.tv/helix/",
      clientId: "cid",
      clientSecret: "sec",
      accessToken: "token",
      logger: { info: mock(() => {}) } as TwitchContext["logger"],
    };

    const id = await getBroadcasterId(ctx, "someone");
    expect(id).toBe("u42");
  });

  test("throws when the Helix response contains an error payload", async () => {
    globalThis.fetch = mock(async () => ({
      json: async () => ({ error: "Unauthorized", message: "bad token" }),
    })) as unknown as typeof fetch;

    const ctx: TwitchContext = {
      apiUrl: "https://api.twitch.tv/helix/",
      clientId: "cid",
      clientSecret: "sec",
      accessToken: "token",
      logger: { info: mock(() => {}) } as TwitchContext["logger"],
    };

    await expect(getBroadcasterId(ctx, "x")).rejects.toThrow("Received error from twitch api: bad token");
  });
});

describe("readTokenFromFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(tmpdir(), `twitch-token-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("parses a JSON token file into an AccessTokenWithUserId-shaped object", async () => {
    const file = path.join(tmpDir, "token.json");
    const payload = {
      accessToken: "a",
      refreshToken: "r",
      expiresIn: 100,
      obtainmentTimestamp: Date.now(),
      userId: "9",
    };
    await writeFile(file, JSON.stringify(payload), "utf-8");

    const token = await readTokenFromFile(file);

    expect(token.userId).toBe("9");
    expect(token.accessToken).toBe("a");
  });
});
