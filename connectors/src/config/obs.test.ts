import { describe, expect, test } from "bun:test";
import { OBS_DEFAULTS, OBS_SERVED_BUDGETS_MS, type ObsConfig, ObsEnvSchema, obsConfig, obsConfigProblems } from "./obs";

function shaped(env: Record<string, unknown>): ObsConfig {
  return obsConfig(ObsEnvSchema.parse(env));
}

describe("obsConfig", () => {
  const cases: Array<[name: string, env: Record<string, unknown>, expected: Partial<ObsConfig>]> = [
    [
      "nothing set: obs-websocket on this machine, run only for an OBS module",
      {},
      { fallback: { host: "127.0.0.1", port: "4455", token: undefined }, hostExplicit: false },
    ],
    [
      "every connection value set",
      { woofx3ObsHost: "obs.lan", woofx3ObsPort: 4460, woofx3ObsRpcToken: "hunter2" },
      { fallback: { host: "obs.lan", port: "4460", token: "hunter2" }, hostExplicit: true },
    ],
    [
      "the default host set explicitly still counts as set",
      { woofx3ObsHost: "127.0.0.1" },
      { fallback: defaultFallback(), hostExplicit: true },
    ],
    [
      "a numeric password, as loadRuntimeEnv coerces it",
      { woofx3ObsRpcToken: 1234 },
      { fallback: { ...defaultFallback(), token: "1234" }, hostExplicit: false },
    ],
    ["a blank password", { woofx3ObsRpcToken: "  " }, { fallback: defaultFallback(), hostExplicit: false }],
    ["a blank host is unset", { woofx3ObsHost: " " }, { fallback: defaultFallback(), hostExplicit: false }],
    ["a blank port", { woofx3ObsPort: "" }, { fallback: defaultFallback(), hostExplicit: false }],
    [
      "the shipped tunables",
      {},
      {
        connection: {
          backoff: { baseMs: 1_000, maxMs: 30_000 },
          connectTimeoutMs: 3_000,
          openTimeoutMs: 15_000,
        },
        commandTimeoutMs: 3_500,
      },
    ],
    [
      "every tunable set",
      {
        woofx3ObsBackoffInitialMs: 500,
        woofx3ObsBackoffMaxMs: 10_000,
        woofx3ObsConnectTimeoutMs: 2_000,
        woofx3ObsOpenTimeoutMs: 20_000,
        woofx3ObsCommandTimeoutMs: 4_000,
      },
      {
        connection: { backoff: { baseMs: 500, maxMs: 10_000 }, connectTimeoutMs: 2_000, openTimeoutMs: 20_000 },
        commandTimeoutMs: 4_000,
      },
    ],
  ];
  for (const [name, env, expected] of cases) {
    test(name, () => {
      expect(shaped(env)).toMatchObject(expected);
    });
  }

  const refused: Array<[name: string, env: Record<string, unknown>]> = [
    ["port 0", { woofx3ObsPort: 0 }],
    ["a port above 65535", { woofx3ObsPort: 70_000 }],
    ["a port that is not a number", { woofx3ObsPort: "obs" }],
    ["a zero backoff", { woofx3ObsBackoffInitialMs: 0 }],
    ["a fractional open timeout", { woofx3ObsOpenTimeoutMs: 1.5 }],
    ["a negative command timeout", { woofx3ObsCommandTimeoutMs: -1 }],
  ];
  for (const [name, env] of refused) {
    test(`refuses ${name}`, () => {
      expect(() => shaped(env)).toThrow();
    });
  }
});

describe("obsConfigProblems", () => {
  const problems = (env: Record<string, unknown>) => obsConfigProblems(ObsEnvSchema.parse(env));

  test("the shipped defaults keep every rule", () => {
    expect(problems({})).toEqual([]);
  });

  const broken: Array<[name: string, env: Record<string, unknown>, mentions: string]> = [
    ["a first delay above the cap", { woofx3ObsBackoffInitialMs: 40_000 }, "woofx3ObsBackoffInitialMs"],
    [
      "a connect timeout as long as the open timeout",
      { woofx3ObsConnectTimeoutMs: 15_000 },
      "woofx3ObsConnectTimeoutMs",
    ],
    [
      "a command timeout that reaches the reply budget",
      { woofx3ObsCommandTimeoutMs: OBS_SERVED_BUDGETS_MS.command },
      "woofx3ObsCommandTimeoutMs",
    ],
  ];
  for (const [name, env, mentions] of broken) {
    test(`names ${name}`, () => {
      const found = problems(env);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain(mentions);
    });
  }

  test("the open timeout covers the bridge's credential request and ticket exchange", () => {
    // requestRelayCredentialOverNats waits up to 6_000 once the companion
    // gateway owns credentials; the dialer's ticket exchange up to 5_000.
    expect(OBS_DEFAULTS.openTimeoutMs).toBeGreaterThan(6_000 + 5_000);
  });
});

function defaultFallback(): ObsConfig["fallback"] {
  return { host: OBS_DEFAULTS.host, port: String(OBS_DEFAULTS.port), token: undefined };
}
