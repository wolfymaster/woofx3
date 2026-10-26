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
      membership: {
        ttlMs: TWITCH_DEFAULTS.membershipTtlMs,
        deadlineMs: TWITCH_DEFAULTS.membershipDeadlineMs,
        loadTimeoutMs: TWITCH_DEFAULTS.membershipLoadTimeoutMs,
        failureTtlMs: TWITCH_DEFAULTS.membershipFailureTtlMs,
        maxEntries: TWITCH_DEFAULTS.membershipMaxEntries,
      },
      sendQueueCap: TWITCH_DEFAULTS.sendQueueCap,
      selfSent: { capacity: TWITCH_DEFAULTS.selfSentCapacity, ttlMs: TWITCH_DEFAULTS.selfSentTtlMs },
    });
  });

  test("takes a send queue cap, zero included", () => {
    expect(shaped({ woofx3TwitchSendQueueCap: 5 }).sendQueueCap).toBe(5);
    expect(shaped({ woofx3TwitchSendQueueCap: 0 }).sendQueueCap).toBe(0);
  });

  test("takes the own-line echo bounds", () => {
    expect(shaped({ woofx3TwitchSelfSentCapacity: 8, woofx3TwitchSelfSentTtlMs: 5_000 }).selfSent).toEqual({
      capacity: 8,
      ttlMs: 5_000,
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
    [
      "a blank redirect url",
      { woofx3TwitchClientId: "cid", woofx3TwitchClientSecret: "sec", woofx3TwitchRedirectUrl: "  " },
      { clientId: "cid", clientSecret: "sec", redirectUri: TWITCH_DEFAULTS.redirectUrl },
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
    ["a negative send queue cap", { woofx3TwitchSendQueueCap: -1 }],
    ["a fractional send queue cap", { woofx3TwitchSendQueueCap: 1.5 }],
    ["a zero own-line capacity", { woofx3TwitchSelfSentCapacity: 0 }],
    ["a redirect url that is not a URL", { woofx3TwitchRedirectUrl: "not a url" }],
    ["a zero own-line TTL", { woofx3TwitchSelfSentTtlMs: 0 }],
  ];
  for (const [name, env] of invalid) {
    test(`refuses ${name}`, () => {
      expect(TwitchEnvSchema.safeParse(env).success).toBe(false);
    });
  }
});
