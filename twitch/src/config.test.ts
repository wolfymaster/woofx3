import { describe, expect, test } from "bun:test";
import { TwitchEnvSchema } from "./config";

describe("TwitchEnvSchema", () => {
  test("accepts a complete valid configuration", () => {
    const parsed = TwitchEnvSchema.parse({
      woofx3MessagebusUrl: "nats://localhost:4222",
      woofx3TwitchChannelName: "mychannel",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3ApplicationId: "app",
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
      woofx3ApplicationId: "a",
      woofx3TwitchClientId: "i",
      woofx3TwitchClientSecret: "s",
    });
    expect(result.success).toBe(false);
  });
});
