import { describe, expect, test } from "bun:test";
import { selfSentConfig, TwitchEnvSchema } from "./config";
import { DEFAULT_SELF_SENT_CONFIG } from "./lib/selfSentChat";

describe("TwitchEnvSchema", () => {
  test("accepts a complete valid configuration", () => {
    const parsed = TwitchEnvSchema.parse({
      woofx3MessagebusUrl: "nats://localhost:4222",
      woofx3TwitchChannelName: "mychannel",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3TwitchClientId: "cid",
      woofx3TwitchClientSecret: "sec",
    });
    expect(parsed.woofx3TwitchRedirectUrl).toBe("http://localhost");
  });

  test("rejects when required infrastructure or Twitch fields are missing", () => {
    const result = TwitchEnvSchema.safeParse({
      woofx3MessagebusUrl: "",
      woofx3TwitchChannelName: "c",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3TwitchClientId: "i",
      woofx3TwitchClientSecret: "s",
    });
    expect(result.success).toBe(false);
  });

  test("accepts a message bus token, numeric or not, and no token", () => {
    const base = { woofx3MessagebusUrl: "ws://127.0.0.1:4225", woofx3DatabaseProxyUrl: "http://db" };

    expect(TwitchEnvSchema.parse({ ...base, woofx3MessagebusToken: "s3cret" }).woofx3MessagebusToken).toBe("s3cret");
    expect(TwitchEnvSchema.parse({ ...base, woofx3MessagebusToken: 12345 }).woofx3MessagebusToken).toBe(12345);
    expect(TwitchEnvSchema.parse(base).woofx3MessagebusToken).toBeUndefined();
  });

  test("accepts no channel: the channel is whoever links Twitch", () => {
    const result = TwitchEnvSchema.safeParse({
      woofx3MessagebusUrl: "nats://localhost:4222",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3TwitchClientId: "cid",
      woofx3TwitchClientSecret: "sec",
    });
    expect(result.success).toBe(true);
  });

  test("remembers sent chat lines by the named defaults unless configured", () => {
    const base = { woofx3MessagebusUrl: "ws://127.0.0.1:4225", woofx3DatabaseProxyUrl: "http://db" };
    const defaults = TwitchEnvSchema.parse(base) as Record<string, unknown>;
    expect(selfSentConfig({ getConfig: (key) => defaults[key] })).toEqual(DEFAULT_SELF_SENT_CONFIG);

    const tuned = TwitchEnvSchema.parse({
      ...base,
      woofx3TwitchSelfSentCapacity: 16,
      woofx3TwitchSelfSentTtlMs: 5_000,
    }) as Record<string, unknown>;
    expect(selfSentConfig({ getConfig: (key) => tuned[key] })).toEqual({ capacity: 16, ttlMs: 5_000 });
  });

  test("refuses a self-sent capacity or ttl that is not a positive whole number", () => {
    const base = { woofx3MessagebusUrl: "ws://127.0.0.1:4225", woofx3DatabaseProxyUrl: "http://db" };
    for (const bad of [
      { woofx3TwitchSelfSentCapacity: 0 },
      { woofx3TwitchSelfSentCapacity: 1.5 },
      { woofx3TwitchSelfSentTtlMs: -1 },
      { woofx3TwitchSelfSentTtlMs: "soon" },
    ]) {
      expect(TwitchEnvSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
  });
});
