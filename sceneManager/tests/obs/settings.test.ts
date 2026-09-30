import { describe, expect, it } from "bun:test";
import { OBS_MODULE_ID, obsConnectionConfig, readObsConnectionConfig } from "../../src/obs/settings";

const fallback = { host: "127.0.0.1", port: "4455", token: "from-config" };
const quietLogger = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe("obsConnectionConfig", () => {
  it("uses the module's host, port and password", () => {
    const config = obsConnectionConfig(
      [
        { key: "host", value: "192.168.1.20" },
        { key: "port", value: "4460" },
        { key: "password", value: "" },
      ],
      { password: "hunter2" },
      fallback
    );
    expect(config).toEqual({ url: "ws://192.168.1.20:4460", token: "hunter2" });
  });

  it("falls back to the configuration for each empty setting", () => {
    expect(obsConnectionConfig([{ key: "host", value: "  " }], {}, fallback)).toEqual({
      url: "ws://127.0.0.1:4455",
      token: "from-config",
    });
  });

  it("falls back for a port that is not a port", () => {
    for (const value of ["0", "65536", "44.55", "abc"]) {
      expect(obsConnectionConfig([{ key: "port", value }], {}, fallback).url).toBe("ws://127.0.0.1:4455");
    }
  });

  it("leaves the password out when neither the module nor the configuration has one", () => {
    expect(obsConnectionConfig([], {}, { host: "obs.lan", port: "4455" })).toEqual({ url: "ws://obs.lan:4455" });
  });

  it("brackets an IPv6 host", () => {
    expect(obsConnectionConfig([{ key: "host", value: "::1" }], {}, fallback).url).toBe("ws://[::1]:4455");
  });
});

describe("readObsConnectionConfig", () => {
  it("reads the OBS module's settings and secrets", async () => {
    const asked: string[] = [];
    const config = await readObsConnectionConfig(
      {
        listModuleSettings: async (moduleId) => {
          asked.push(`settings:${moduleId}`);
          return [{ key: "host", value: "obs.lan" }];
        },
        getModuleSecretValues: async (moduleId) => {
          asked.push(`secrets:${moduleId}`);
          return { password: "hunter2" };
        },
      },
      fallback,
      quietLogger
    );
    expect(asked).toEqual([`settings:${OBS_MODULE_ID}`, `secrets:${OBS_MODULE_ID}`]);
    expect(config).toEqual({ url: "ws://obs.lan:4455", token: "hunter2" });
  });

  it("uses the configuration when db-proxy cannot be read", async () => {
    const config = await readObsConnectionConfig(
      {
        listModuleSettings: async () => {
          throw new Error("db down");
        },
        getModuleSecretValues: async () => ({}),
      },
      fallback,
      quietLogger
    );
    expect(config).toEqual({ url: "ws://127.0.0.1:4455", token: "from-config" });
  });
});
