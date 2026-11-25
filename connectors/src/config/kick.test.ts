import { describe, expect, test } from "bun:test";
import { KICK_DEFAULTS, KickEnvSchema, kickConfig } from "./kick";

describe("kickConfig", () => {
  test("remembers a delivery longer than a retry of it is accepted, so a replay inside the window is a duplicate", () => {
    expect(KICK_DEFAULTS.dedupeTtlMs).toBeGreaterThan(KICK_DEFAULTS.webhookMaxSkewMs);
  });

  const cases: [
    name: string,
    env: Record<string, unknown>,
    sendQueueCap: number,
    selfSent: { capacity: number; ttlMs: number },
  ][] = [
    ["defaults", {}, 100, { capacity: 256, ttlMs: 30_000 }],
    [
      "env overrides",
      { woofx3KickSendQueueCap: 5, woofx3KickSelfSentCapacity: 8, woofx3KickSelfSentTtlMs: 1000 },
      5,
      { capacity: 8, ttlMs: 1000 },
    ],
  ];
  for (const [name, env, sendQueueCap, selfSent] of cases) {
    test(name, () => {
      const config = kickConfig(KickEnvSchema.parse(env));
      expect(config.sendQueueCap).toBe(sendQueueCap);
      expect(config.selfSent).toEqual(selfSent);
    });
  }

  test("refuses a self-sent capacity of zero", () => {
    expect(() => KickEnvSchema.parse({ woofx3KickSelfSentCapacity: 0 })).toThrow();
  });
});
