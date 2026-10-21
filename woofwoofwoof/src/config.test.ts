import { describe, expect, test } from "bun:test";
import { WoofEnvSchema } from "./config";

/** Minimal valid config for local or CI validation of required deployment keys. */
const baseValid = {
  woofx3MessagebusUrl: "nats://localhost:4222",
  woofx3TwitchChannelName: "channel",
  woofx3BarkloaderWsUrl: "wss://barkloader/ws",
  woofx3BarkloaderKey: "key",
  woofx3DatabaseProxyUrl: "http://db-proxy",
  woofx3DbProxyToken: "woof-db-proxy-token-0123456789abcdef",
  woofx3TwitchClientId: "twitch-client-id",
  woofx3TwitchClientSecret: "twitch-secret",
};

describe("WoofEnvSchema", () => {
  test("accepts a complete configuration object", () => {
    const parsed = WoofEnvSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
  });

  test("rejects configuration when required infrastructure fields are missing", () => {
    const parsed = WoofEnvSchema.safeParse({
      ...baseValid,
      woofx3DatabaseProxyUrl: "",
    });
    expect(parsed.success).toBe(false);
  });

  test("accepts no Twitch app: a dashboard renews the token", () => {
    const { woofx3TwitchClientId: _id, woofx3TwitchClientSecret: _secret, ...withoutApp } = baseValid;
    expect(WoofEnvSchema.safeParse(withoutApp).success).toBe(true);
  });

  test("accepts no channel: the bot joins whoever links Twitch", () => {
    const { woofx3TwitchChannelName: _channel, ...withoutChannel } = baseValid;
    expect(WoofEnvSchema.safeParse(withoutChannel).success).toBe(true);
  });

  test("accepts a message bus token, numeric or not, and no token", () => {
    expect(WoofEnvSchema.parse({ ...baseValid, woofx3MessagebusToken: "s3cret" }).woofx3MessagebusToken).toBe("s3cret");
    expect(WoofEnvSchema.parse({ ...baseValid, woofx3MessagebusToken: 12345 }).woofx3MessagebusToken).toBe(12345);
    expect(WoofEnvSchema.parse(baseValid).woofx3MessagebusToken).toBeUndefined();
  });

  test("applies defaults for optional fields", () => {
    const parsed = WoofEnvSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.twitchRedirectUrl).toBe("http://localhost");
    }
  });

  for (const value of [undefined, "", "CHANGE_ME", "short-token"]) {
    test(`refuses the db proxy token ${JSON.stringify(value)}`, () => {
      const parsed = WoofEnvSchema.safeParse({ ...baseValid, woofx3DbProxyToken: value });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toContain("dbProxyToken (WOOFX3_DB_PROXY_TOKEN)");
    });
  }
});
