import { describe, expect, test } from "bun:test";
import { OBS_DEFAULTS, type ObsConfig, ObsEnvSchema, obsConfig } from "./obs";

function shaped(env: Record<string, unknown>): ObsConfig {
  return obsConfig(ObsEnvSchema.parse(env));
}

describe("obsConfig", () => {
  const cases: Array<[name: string, env: Record<string, unknown>, expected: ObsConfig]> = [
    ["nothing set: obs-websocket on this machine", {}, { host: "127.0.0.1", port: "4455", token: undefined }],
    [
      "every value set",
      { woofx3ObsHost: "obs.lan", woofx3ObsPort: 4460, woofx3ObsRpcToken: "hunter2" },
      { host: "obs.lan", port: "4460", token: "hunter2" },
    ],
    ["a numeric password, as loadRuntimeEnv coerces it", { woofx3ObsRpcToken: 1234 }, { ...defaults(), token: "1234" }],
    ["a blank password", { woofx3ObsRpcToken: "  " }, defaults()],
    ["a blank host", { woofx3ObsHost: " " }, defaults()],
    ["a blank port", { woofx3ObsPort: "" }, defaults()],
  ];
  for (const [name, env, expected] of cases) {
    test(name, () => {
      expect(shaped(env)).toEqual(expected);
    });
  }

  const refused: Array<[name: string, env: Record<string, unknown>]> = [
    ["port 0", { woofx3ObsPort: 0 }],
    ["a port above 65535", { woofx3ObsPort: 70_000 }],
    ["a port that is not a number", { woofx3ObsPort: "obs" }],
  ];
  for (const [name, env] of refused) {
    test(`refuses ${name}`, () => {
      expect(() => shaped(env)).toThrow();
    });
  }
});

function defaults(): ObsConfig {
  return { host: OBS_DEFAULTS.host, port: String(OBS_DEFAULTS.port), token: undefined };
}
