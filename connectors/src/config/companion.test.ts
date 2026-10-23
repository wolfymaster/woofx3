import { describe, expect, test } from "bun:test";
import { connectorsConfig } from "../config";
import {
  COMPANION_DEFAULTS,
  type CompanionConfig,
  CompanionEnvSchema,
  companionConfig,
  companionConfigProblems,
  RELAY_MAX_TICKETS,
} from "./companion";

const required = {
  woofx3MessagebusUrl: "ws://127.0.0.1:4225",
  woofx3DatabaseProxyUrl: "http://127.0.0.1:5555",
  woofx3DbProxyToken: "connectors-db-proxy-token-0123456789abcdef",
};

const SHIPPED: CompanionConfig = {
  hosting: null,
  maxBridgeOpens: 8,
  ticketTimeoutMs: 5_000,
  dashboardRequestTimeoutMs: 6_000,
};

describe("companionConfig", () => {
  const cases: Array<[name: string, env: Record<string, unknown>, expected: CompanionConfig]> = [
    ["nothing set: the shipped tunables, hosting unknown", {}, SHIPPED],
    ["a blank hosting is unset", { woofx3Hosting: "  " }, SHIPPED],
    ["local", { woofx3Hosting: "local" }, { ...SHIPPED, hosting: "local" }],
    ["self, padded", { woofx3Hosting: " self " }, { ...SHIPPED, hosting: "self" }],
    ["managed", { woofx3Hosting: "managed" }, { ...SHIPPED, hosting: "managed" }],
    [
      "tunables overridden",
      { woofx3CompanionMaxBridgeOpens: 16, woofx3CompanionTicketTimeoutMs: 4_000 },
      { ...SHIPPED, maxBridgeOpens: 16, ticketTimeoutMs: 4_000 },
    ],
  ];
  for (const [name, env, expected] of cases) {
    test(name, () => {
      expect(companionConfig(CompanionEnvSchema.parse(env))).toEqual(expected);
      expect(connectorsConfig({ ...required, ...env }).companion).toEqual(expected);
    });
  }

  const refused: Array<[name: string, env: Record<string, unknown>, message: string]> = [
    ["an unknown hosting", { woofx3Hosting: "cloud" }, "woofx3Hosting must be one of managed, self, local, got cloud"],
    ["no bridge opens", { woofx3CompanionMaxBridgeOpens: 0 }, "woofx3CompanionMaxBridgeOpens"],
    [
      "more bridge opens than the relay has tickets",
      { woofx3CompanionMaxBridgeOpens: RELAY_MAX_TICKETS + 1 },
      "woofx3CompanionMaxBridgeOpens",
    ],
    [
      "an OBS open deadline the bridge setup does not fit in",
      { woofx3CompanionTicketTimeoutMs: 10_000, woofx3ObsOpenTimeoutMs: 15_000 },
      "woofx3ObsOpenTimeoutMs (15000) must exceed the bridge credential request (6000) plus woofx3CompanionTicketTimeoutMs (10000)",
    ],
  ];
  for (const [name, env, message] of refused) {
    test(`stops startup on ${name}`, () => {
      expect(() => connectorsConfig({ ...required, ...env })).toThrow(message);
    });
  }

  test("the shipped companion settings keep every rule", () => {
    expect(companionConfigProblems(CompanionEnvSchema.parse({}))).toEqual([]);
    expect(COMPANION_DEFAULTS.maxBridgeOpens).toBeLessThanOrEqual(RELAY_MAX_TICKETS);
  });
});
