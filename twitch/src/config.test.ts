import { describe, expect, test } from "bun:test";
import { TwitchEnvSchema } from "./config";

const TOKEN = "twitch-db-proxy-token-0123456789abcdef";

describe("TwitchEnvSchema", () => {
  test("accepts a complete valid configuration", () => {
    const parsed = TwitchEnvSchema.parse({
      woofx3MessagebusUrl: "nats://localhost:4222",
      woofx3TwitchChannelName: "mychannel",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3DbProxyToken: TOKEN,
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
      woofx3DbProxyToken: TOKEN,
      woofx3TwitchClientId: "i",
      woofx3TwitchClientSecret: "s",
    });
    expect(result.success).toBe(false);
  });

  test("accepts a message bus token, numeric or not, and no token", () => {
    const base = {
      woofx3MessagebusUrl: "ws://127.0.0.1:4225",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3DbProxyToken: TOKEN,
    };

    expect(TwitchEnvSchema.parse({ ...base, woofx3MessagebusToken: "s3cret" }).woofx3MessagebusToken).toBe("s3cret");
    expect(TwitchEnvSchema.parse({ ...base, woofx3MessagebusToken: 12345 }).woofx3MessagebusToken).toBe(12345);
    expect(TwitchEnvSchema.parse(base).woofx3MessagebusToken).toBeUndefined();
  });

  test("accepts no channel: the channel is whoever links Twitch", () => {
    const result = TwitchEnvSchema.safeParse({
      woofx3MessagebusUrl: "nats://localhost:4222",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3DbProxyToken: TOKEN,
      woofx3TwitchClientId: "cid",
      woofx3TwitchClientSecret: "sec",
    });
    expect(result.success).toBe(true);
  });

  for (const value of [undefined, "", "CHANGE_ME", "short-token"]) {
    test(`refuses the db proxy token ${JSON.stringify(value)}`, () => {
      const result = TwitchEnvSchema.safeParse({
        woofx3MessagebusUrl: "nats://localhost:4222",
        woofx3DatabaseProxyUrl: "http://db",
        woofx3DbProxyToken: value,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("dbProxyToken (WOOFX3_DB_PROXY_TOKEN)");
    });
  }
});
