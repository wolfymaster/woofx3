import { describe, expect, test } from "bun:test";
import {
  parseModuleEndpointReply,
  parseModuleEndpointRequest,
} from "@woofx3/common/cloudevents/Companion/module-request";
import { connectorsConfig } from "../config";
import {
  COMPANION_DEFAULTS,
  type CompanionConfig,
  CompanionEnvSchema,
  companionConfig,
  companionConfigProblems,
  MODULE_SESSION_DEFAULTS,
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
  relayCredentialTimeoutMs: 5_000,
  moduleLocalDirect: false,
  moduleSessions: {
    requestBudgetMs: 4_500,
    openTimeoutMs: 10_000,
    resolveTimeoutMs: 3_000,
    idleMs: 120_000,
    maxSessions: 32,
    maxPendingPerSession: 16,
    maxMessageBytes: 65_536,
  },
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
    [
      "module requests may dial direct on self",
      { woofx3ModuleLocalDirect: true },
      { ...SHIPPED, moduleLocalDirect: true },
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
    ["a module direct switch that is not a boolean", { woofx3ModuleLocalDirect: "yes" }, "woofx3ModuleLocalDirect"],
    [
      "more bridge opens than the relay has tickets",
      { woofx3CompanionMaxBridgeOpens: RELAY_MAX_TICKETS + 1 },
      "woofx3CompanionMaxBridgeOpens",
    ],
    [
      "an OBS open deadline the bridge setup does not fit in",
      { woofx3CompanionTicketTimeoutMs: 10_000, woofx3ObsOpenTimeoutMs: 15_000 },
      "woofx3ObsOpenTimeoutMs (15000) must exceed the relay credential request (5000) plus woofx3CompanionTicketTimeoutMs (10000)",
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

describe("MODULE_SESSION_DEFAULTS", () => {
  const request = (budgetMs: number) => ({
    op: "send",
    moduleId: "vts",
    endpointId: "vts",
    message: "{}",
    budgetMs,
  });
  const reply = (bytes: number) => ({ status: "ok", reply: "x".repeat(bytes), sessionEpoch: "e" });

  test("the request budget is the contract's largest budgetMs", () => {
    expect(parseModuleEndpointRequest(request(MODULE_SESSION_DEFAULTS.requestBudgetMs)).ok).toBe(true);
    expect(parseModuleEndpointRequest(request(MODULE_SESSION_DEFAULTS.requestBudgetMs + 1)).ok).toBe(false);
  });

  test("the frame limit is the contract's message and reply bound", () => {
    expect(parseModuleEndpointReply(reply(MODULE_SESSION_DEFAULTS.maxMessageBytes)).ok).toBe(true);
    expect(parseModuleEndpointReply(reply(MODULE_SESSION_DEFAULTS.maxMessageBytes + 1)).ok).toBe(false);
  });

  test("a .local lookup fits inside one session open", () => {
    expect(MODULE_SESSION_DEFAULTS.resolveTimeoutMs).toBeLessThan(MODULE_SESSION_DEFAULTS.openTimeoutMs);
  });
});
