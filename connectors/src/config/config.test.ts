import { describe, expect, test } from "bun:test";
import { connectorsConfig } from "../config";
import { GATEWAY_DEFAULTS } from "./gateway";
import { HOST_DEFAULTS } from "./host";

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

  test("fills the gateway tunables from their named defaults", () => {
    expect(connectorsConfig(required).gateway).toEqual({
      adapterDeadlineMs: 9_000,
      idempotency: { capacity: GATEWAY_DEFAULTS.idempotencyCapacity, ttlMs: GATEWAY_DEFAULTS.idempotencyTtlMs },
    });
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
      "must exceed woofx3ConnectorsDbProxyTimeoutMs plus woofx3ConnectorsStopDeadlineMs",
    ],
    [
      "shutdown deadline that leaves no room for a link read in flight",
      { ...required, woofx3ConnectorsStopDeadlineMs: 10_000, woofx3ConnectorsShutdownDeadlineMs: 11_000 },
      "must exceed woofx3ConnectorsDbProxyTimeoutMs plus woofx3ConnectorsStopDeadlineMs (12000)",
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
  ];
  for (const [name, env, problem] of invalid) {
    test(`refuses ${name}`, () => {
      expect(() => connectorsConfig(env)).toThrow(problem);
    });
  }
});
