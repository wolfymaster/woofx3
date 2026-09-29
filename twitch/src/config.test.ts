import { describe, expect, test } from "bun:test";
import { TwitchEnvSchema } from "./config";

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

  test("accepts no channel: the channel is whoever links Twitch", () => {
    const result = TwitchEnvSchema.safeParse({
      woofx3MessagebusUrl: "nats://localhost:4222",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3TwitchClientId: "cid",
      woofx3TwitchClientSecret: "sec",
    });
    expect(result.success).toBe(true);
  });

  test("parses ad-break lead times and rejects bad ones at startup", () => {
    const base = {
      woofx3MessagebusUrl: "nats://localhost:4222",
      woofx3DatabaseProxyUrl: "http://db",
      woofx3TwitchClientId: "cid",
      woofx3TwitchClientSecret: "sec",
    };
    expect(TwitchEnvSchema.parse(base).woofx3TwitchAdBreakLeadSeconds).toEqual([60]);
    expect(
      TwitchEnvSchema.parse({ ...base, woofx3TwitchAdBreakLeadSeconds: "120,60" }).woofx3TwitchAdBreakLeadSeconds
    ).toEqual([120, 60]);
    expect(TwitchEnvSchema.safeParse({ ...base, woofx3TwitchAdBreakLeadSeconds: "soon" }).success).toBe(false);
  });
});
