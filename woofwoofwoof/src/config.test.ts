import { describe, expect, test } from "bun:test";
import { WoofEnvSchema } from "./config";

/** Minimal valid config for local or CI validation of required deployment keys. */
const baseValid = {
  woofx3MessagebusUrl: "nats://localhost:4222",
  woofx3TwitchChannelName: "channel",
  woofx3BarkloaderWsUrl: "wss://barkloader/ws",
  woofx3BarkloaderKey: "key",
  woofx3DatabaseProxyUrl: "http://db-proxy",
  woofx3ApplicationId: "app-id",
  woofx3TwitchClientId: "twitch-client-id",
  woofx3TwitchClientSecret: "twitch-secret",
};

describe("WoofEnvSchema", () => {
  test("accepts a complete configuration object", () => {
    const parsed = WoofEnvSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
  });

  test("rejects configuration when required Twitch or infrastructure fields are missing", () => {
    const parsed = WoofEnvSchema.safeParse({
      ...baseValid,
      woofx3TwitchChannelName: "",
    });
    expect(parsed.success).toBe(false);
  });

  test("applies defaults for optional fields", () => {
    const parsed = WoofEnvSchema.safeParse(baseValid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.twitchRedirectUrl).toBe("http://localhost");
    }
  });
});
