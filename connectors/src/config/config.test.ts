import { describe, expect, test } from "bun:test";
import { CALLER_TIMEOUT_MS } from "@woofx3/api/platform-gateway";
import { HEALTH_CHECK_INTERVAL_MS } from "@woofx3/common/runtime";
import { connectorsConfig } from "../config";
import { CHAT_DEFAULTS } from "./chat";
import { GATEWAY_DEFAULTS } from "./gateway";
import { HOST_DEFAULTS, shutdownDeadlineProblem } from "./host";

const required = {
  woofx3MessagebusUrl: "ws://127.0.0.1:4225",
  woofx3DatabaseProxyUrl: "http://127.0.0.1:5555",
  woofx3DbProxyToken: "connectors-db-proxy-token-0123456789abcdef",
};

describe("connectorsConfig", () => {
  test("fills every host tunable from its named default", () => {
    const config = connectorsConfig(required);
    expect(config.host).toEqual({
      port: HOST_DEFAULTS.port,
      reconcileIntervalMs: HOST_DEFAULTS.reconcileIntervalMs,
      backoff: { baseMs: HOST_DEFAULTS.backoffBaseMs, maxMs: HOST_DEFAULTS.backoffMaxMs },
      park: { afterFailures: HOST_DEFAULTS.parkAfterFailures, windowMs: HOST_DEFAULTS.parkWindowMs },
      stopDeadlineMs: HOST_DEFAULTS.stopDeadlineMs,
      dbProxyTimeoutMs: HOST_DEFAULTS.dbProxyTimeoutMs,
      dbProxyHealthFailures: HOST_DEFAULTS.dbProxyHealthFailures,
      subscriptionLimits: { concurrency: HOST_DEFAULTS.adapterConcurrency, queueCap: HOST_DEFAULTS.adapterQueueCap },
      shutdownDeadlineMs: HOST_DEFAULTS.shutdownDeadlineMs,
    });
    expect(config.host.port).toBe(9102);
    expect(config.dbProxyUrl).toBe(required.woofx3DatabaseProxyUrl);
    expect(config.dbProxyToken).toBe(required.woofx3DbProxyToken);
  });

  test("shapes the bus config, dropping blank credentials and stringifying a numeric token", () => {
    const config = connectorsConfig({
      ...required,
      woofx3MessagebusJwt: " ",
      woofx3MessagebusNKey: "",
      woofx3MessagebusToken: 12345,
    });
    expect(config.bus).toEqual({
      url: required.woofx3MessagebusUrl,
      jwt: undefined,
      nkeySeed: undefined,
      token: "12345",
    });
  });

  test("leaves the bus token unset when it is blank", () => {
    const config = connectorsConfig({ ...required, woofx3MessagebusToken: "  " });
    expect(config.bus.token).toBeUndefined();
  });

  test("reads the Twitch adapter's settings under their existing names", () => {
    const config = connectorsConfig({ ...required, woofx3TwitchChannelName: "mychannel" });
    expect(config.twitch.channel).toBe("mychannel");
    expect(config.twitch.app).toBeUndefined();
  });

  test("fills the gateway tunables from their named defaults", () => {
    expect(connectorsConfig(required).gateway).toEqual({
      adapterDeadlineMs: 9_000,
      discoveryBudgetMs: GATEWAY_DEFAULTS.discoveryBudgetMs,
      idempotency: { capacity: GATEWAY_DEFAULTS.idempotencyCapacity, ttlMs: GATEWAY_DEFAULTS.idempotencyTtlMs },
    });
  });

  test("fills the chat dispatcher tunables from their named defaults", () => {
    expect(connectorsConfig(required).chat).toEqual({
      authCache: { capacity: 2_048, ttlMs: 5_000 },
      groups: { lastSeenCapacity: CHAT_DEFAULTS.groupLastSeenCapacity, catalogTtlMs: 300_000 },
      store: { reloadDebounceMs: 250, reloadBackstopMs: 300_000 },
      twitchApi: { timeoutMs: 10_000 },
      drainMs: CHAT_DEFAULTS.drainMs,
      replyTimeoutMs: CALLER_TIMEOUT_MS,
    });
  });

  test("takes overrides for the chat dispatcher tunables", () => {
    const config = connectorsConfig({ ...required, woofx3ConnectorsDispatcherAuthCacheTtlMs: 1_000 });
    expect(config.chat.authCache.ttlMs).toBe(1_000);
  });

  test("takes overrides for the host tunables", () => {
    const config = connectorsConfig({ ...required, woofx3ConnectorsPort: 20106, woofx3ConnectorsAdapterQueueCap: 0 });
    expect(config.host.port).toBe(20106);
    expect(config.host.subscriptionLimits.queueCap).toBe(0);
  });

  const invalid: Array<[name: string, env: Record<string, unknown>, problem: string]> = [
    ["no bus url", { ...required, woofx3MessagebusUrl: undefined }, "woofx3MessagebusUrl"],
    ["no db-proxy token", { ...required, woofx3DbProxyToken: undefined }, "dbProxyToken (WOOFX3_DB_PROXY_TOKEN)"],
    ["a placeholder db-proxy token", { ...required, woofx3DbProxyToken: "CHANGE_ME" }, "dbProxyToken"],
    ["a short db-proxy token", { ...required, woofx3DbProxyToken: "short-token" }, "dbProxyToken"],
    ["db-proxy url that is not a URL", { ...required, woofx3DatabaseProxyUrl: "db-proxy" }, "woofx3DatabaseProxyUrl"],
    [
      "a twitchapi timeout at the adapter's served budget",
      { ...required, woofx3ConnectorsDispatcherTwitchApiTimeoutMs: 9_000 },
      "woofx3ConnectorsDispatcherTwitchApiTimeoutMs",
    ],
    ["port out of range", { ...required, woofx3ConnectorsPort: 70_000 }, "woofx3ConnectorsPort"],
    [
      "non-numeric interval",
      { ...required, woofx3ConnectorsReconcileIntervalMs: "soon" },
      "woofx3ConnectorsReconcileIntervalMs",
    ],
    ["zero concurrency", { ...required, woofx3ConnectorsAdapterConcurrency: 0 }, "woofx3ConnectorsAdapterConcurrency"],
    [
      "backoff base above its max",
      { ...required, woofx3ConnectorsBackoffBaseMs: 10_000, woofx3ConnectorsBackoffMaxMs: 5_000 },
      "must not exceed woofx3ConnectorsBackoffMaxMs",
    ],
    [
      "shutdown deadline no longer than an adapter stop",
      { ...required, woofx3ConnectorsShutdownDeadlineMs: 10_000 },
      "the shutdown deadline (10000ms) must exceed the db-proxy timeout plus the chat drain",
    ],
    [
      "shutdown deadline that leaves no room for a link read in flight",
      { ...required, woofx3ConnectorsStopDeadlineMs: 10_000, woofx3ConnectorsShutdownDeadlineMs: 11_000 },
      "the shutdown deadline (11000ms) must exceed the db-proxy timeout plus the chat drain plus the longest of the stop deadline and the served budgets (14000ms)",
    ],
    [
      "a chat drain that leaves the shutdown deadline no room",
      { ...required, woofx3ConnectorsDispatcherDrainMs: 3_001 },
      "the shutdown deadline (15000ms) must exceed the db-proxy timeout plus the chat drain",
    ],
    ["zero db-proxy timeout", { ...required, woofx3ConnectorsDbProxyTimeoutMs: 0 }, "woofx3ConnectorsDbProxyTimeoutMs"],
    [
      "a gateway deadline the callers would not wait for",
      { ...required, woofx3ConnectorsGatewayAdapterDeadlineMs: 12_000 },
      "woofx3ConnectorsGatewayAdapterDeadlineMs",
    ],
    [
      "zero idempotency capacity",
      { ...required, woofx3ConnectorsGatewayIdempotencyCapacity: 0 },
      "woofx3ConnectorsGatewayIdempotencyCapacity",
    ],
    [
      "zero idempotency TTL",
      { ...required, woofx3ConnectorsGatewayIdempotencyTtlMs: 0 },
      "woofx3ConnectorsGatewayIdempotencyTtlMs",
    ],
    [
      "zero dispatcher auth cache capacity",
      { ...required, woofx3ConnectorsDispatcherAuthCacheCapacity: 0 },
      "woofx3ConnectorsDispatcherAuthCacheCapacity",
    ],
    [
      "a fractional dispatcher reload debounce",
      { ...required, woofx3ConnectorsDispatcherReloadDebounceMs: 2.5 },
      "woofx3ConnectorsDispatcherReloadDebounceMs",
    ],
    [
      "a db-proxy timeout at the runtime health check interval",
      { ...required, woofx3ConnectorsDbProxyTimeoutMs: HEALTH_CHECK_INTERVAL_MS },
      `woofx3ConnectorsDbProxyTimeoutMs (${HEALTH_CHECK_INTERVAL_MS}) must be below the runtime health check interval`,
    ],
    [
      "a zero db-proxy health failure count",
      { ...required, woofx3ConnectorsDbProxyHealthFailures: 0 },
      "woofx3ConnectorsDbProxyHealthFailures",
    ],
    [
      "an OBS command timeout past its reply budget",
      { ...required, woofx3ObsCommandTimeoutMs: 5_000 },
      "woofx3ObsCommandTimeoutMs (5000) must be below the OBS command reply budget",
    ],
  ];
  for (const [name, env, problem] of invalid) {
    test(`refuses ${name}`, () => {
      expect(() => connectorsConfig(env)).toThrow(problem);
    });
  }
});

describe("shutdownDeadlineProblem", () => {
  const host = { shutdownDeadlineMs: 15_000, dbProxyTimeoutMs: 2_000, stopDeadlineMs: 10_000 };

  test("accepts a deadline above the whole shutdown sequence", () => {
    expect(shutdownDeadlineProblem(host, 2_000, [5_000])).toBeUndefined();
  });

  test("counts a served budget longer than the stop deadline", () => {
    expect(shutdownDeadlineProblem(host, 2_000, [12_000])).toContain("(16000ms)");
  });

  test("refuses a deadline equal to the sequence", () => {
    expect(shutdownDeadlineProblem(host, 3_000, [])).toContain("(15000ms)");
  });
});
