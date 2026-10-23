import { describe, expect, test } from "bun:test";
import { TWITCH_DEFAULTS, type TwitchConfig, TwitchEnvSchema, twitchConfig } from "./twitch";

function shaped(env: Record<string, unknown>): TwitchConfig {
  return twitchConfig(TwitchEnvSchema.parse(env));
}

describe("twitchConfig", () => {
  test("needs nothing: no channel, no app of its own, enrichment on with its named defaults", () => {
    expect(shaped({})).toEqual({
      channel: undefined,
      app: undefined,
      membership: { ttlMs: TWITCH_DEFAULTS.membershipTtlMs, deadlineMs: TWITCH_DEFAULTS.membershipDeadlineMs },
    });
  });

  const apps: Array<[name: string, env: Record<string, unknown>, app: TwitchConfig["app"]]> = [
    [
      "both id and secret",
      { woofx3TwitchClientId: "cid", woofx3TwitchClientSecret: "sec" },
      { clientId: "cid", clientSecret: "sec", redirectUri: TWITCH_DEFAULTS.redirectUrl },
    ],
    [
      "a redirect url override",
      { woofx3TwitchClientId: "cid", woofx3TwitchClientSecret: "sec", woofx3TwitchRedirectUrl: "http://x/cb" },
      { clientId: "cid", clientSecret: "sec", redirectUri: "http://x/cb" },
    ],
    ["an id without a secret (the api's own client id)", { woofx3TwitchClientId: "cid" }, undefined],
    ["a blank secret", { woofx3TwitchClientId: "cid", woofx3TwitchClientSecret: "  " }, undefined],
  ];
  for (const [name, env, app] of apps) {
    test(`app credentials from ${name}`, () => {
      expect(shaped(env).app).toEqual(app);
    });
  }

  test("a blank channel means whoever links Twitch", () => {
    expect(shaped({ woofx3TwitchChannelName: " " }).channel).toBeUndefined();
    expect(shaped({ woofx3TwitchChannelName: "mychannel" }).channel).toBe("mychannel");
  });

  test("enrichment switched off leaves no membership settings", () => {
    expect(shaped({ woofx3TwitchMembershipEnrichmentEnabled: false }).membership).toBeUndefined();
  });

  const invalid: Array<[name: string, env: Record<string, unknown>]> = [
    ["a zero membership TTL", { woofx3TwitchMembershipTtlMs: 0 }],
    ["a non-numeric membership deadline", { woofx3TwitchMembershipDeadlineMs: "soon" }],
    ["a non-boolean enrichment switch", { woofx3TwitchMembershipEnrichmentEnabled: "maybe" }],
  ];
  for (const [name, env] of invalid) {
    test(`refuses ${name}`, () => {
      expect(TwitchEnvSchema.safeParse(env).success).toBe(false);
    });
  }
});
