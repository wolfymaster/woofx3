import { describe, expect, it } from "bun:test";
import { OBS_ENDPOINT, obsAdapterFallback } from "../adapters/obs/settings";
import { emptyEndpointStore, RecordingLogger } from "../host/testing";
import type { EndpointStore } from "./endpoint-store";
import { adapterPolicy, directRouteFrom } from "./route-policy";

const FALLBACK = obsAdapterFallback({ host: "127.0.0.1", port: "4455", token: "from-config" });

const OBS_MANIFEST = JSON.stringify({
  id: "woofx3_obs",
  local: [
    {
      id: "obs",
      name: "OBS Studio",
      protocol: "websocket",
      hostSetting: "obsHost",
      portSetting: "obsPort",
      passwordSetting: "obsPassword",
    },
  ],
});

function storeWith(overrides: Partial<EndpointStore>): EndpointStore {
  return { ...emptyEndpointStore, ...overrides };
}

const unreadable = async (): Promise<never> => {
  throw new Error("db-proxy ListModuleSettings: unavailable");
};

describe("adapterPolicy", () => {
  it("reads the settings the stored manifest's local[] entry names", async () => {
    const policy = adapterPolicy({
      store: storeWith({
        moduleManifest: async () => OBS_MANIFEST,
        moduleSettings: async () => [
          { key: "obsHost", value: "obs.lan" },
          { key: "obsPort", value: "4470" },
          { key: "host", value: "ignored" },
        ],
        moduleSecrets: async () => ({ obsPassword: "s3cret", password: "ignored" }),
      }),
      logger: new RecordingLogger(),
    });
    expect(await policy.direct(OBS_ENDPOINT, FALLBACK)).toEqual({
      ok: true,
      route: "direct",
      url: "ws://obs.lan:4470",
      password: "s3cret",
      address: "obs.lan:4470",
    });
  });

  it("reads the fallback's setting ids for a module installed before local[]", async () => {
    const policy = adapterPolicy({
      store: storeWith({
        moduleSettings: async () => [{ key: "host", value: "192.168.1.20" }],
        moduleSecrets: async () => ({ password: "hunter2" }),
      }),
      logger: new RecordingLogger(),
    });
    expect(await policy.direct(OBS_ENDPOINT, FALLBACK)).toMatchObject({
      url: "ws://192.168.1.20:4455",
      password: "hunter2",
    });
  });

  it("uses the fallback when the store is unreadable, and says why at debug", async () => {
    const logger = new RecordingLogger();
    const policy = adapterPolicy({ store: storeWith({ moduleSettings: unreadable }), logger });
    expect(await policy.direct(OBS_ENDPOINT, FALLBACK)).toEqual({
      ok: true,
      route: "direct",
      url: "ws://127.0.0.1:4455",
      password: "from-config",
      address: "127.0.0.1:4455",
    });
    expect(logger.at("debug")).toHaveLength(1);
  });

  it("answers store_unreadable when the store is unreadable and there is no fallback", async () => {
    const policy = adapterPolicy({ store: storeWith({ moduleManifest: unreadable }), logger: new RecordingLogger() });
    expect(await policy.direct(OBS_ENDPOINT, undefined)).toMatchObject({ ok: false, reason: "store_unreadable" });
  });

  it("answers not_declared with neither a local[] entry nor fallback keys", async () => {
    const policy = adapterPolicy({ store: storeWith({}), logger: new RecordingLogger() });
    expect(await policy.direct(OBS_ENDPOINT, undefined)).toMatchObject({ ok: false, reason: "not_declared" });
  });

  it("answers not_routed when nothing gives an address", async () => {
    const policy = adapterPolicy({
      store: storeWith({ moduleManifest: async () => OBS_MANIFEST }),
      logger: new RecordingLogger(),
    });
    expect(await policy.direct(OBS_ENDPOINT, undefined)).toMatchObject({ ok: false, reason: "not_routed" });
  });

  it("answers protocol_unsupported for an http endpoint", async () => {
    const http = OBS_MANIFEST.replace('"websocket"', '"http"');
    const policy = adapterPolicy({
      store: storeWith({ moduleManifest: async () => http }),
      logger: new RecordingLogger(),
    });
    expect(await policy.direct(OBS_ENDPOINT, FALLBACK)).toMatchObject({ ok: false, reason: "protocol_unsupported" });
  });
});

describe("directRouteFrom", () => {
  const keys = { hostSetting: "host", portSetting: "port", passwordSetting: "password" };
  const fallback = { keys, host: "127.0.0.1", port: "4455", password: "from-config" };

  it("falls back to the configuration for each empty setting", () => {
    expect(directRouteFrom([{ key: "host", value: "  " }], {}, keys, fallback)).toEqual({
      ok: true,
      route: "direct",
      url: "ws://127.0.0.1:4455",
      password: "from-config",
      address: "127.0.0.1:4455",
    });
  });

  for (const value of ["0", "65536", "44.55", "abc"]) {
    it(`falls back for the port "${value}", which is not a port`, () => {
      expect(directRouteFrom([{ key: "port", value }], {}, keys, fallback)).toMatchObject({
        url: "ws://127.0.0.1:4455",
      });
    });
  }

  it("leaves the password out when neither the module nor the configuration has one", () => {
    expect(directRouteFrom([], {}, keys, { keys, host: "obs.lan", port: "4455" })).toEqual({
      ok: true,
      route: "direct",
      url: "ws://obs.lan:4455",
      address: "obs.lan:4455",
    });
  });

  it("brackets an IPv6 host", () => {
    expect(directRouteFrom([{ key: "host", value: "::1" }], {}, keys, fallback)).toMatchObject({
      url: "ws://[::1]:4455",
      address: "[::1]:4455",
    });
  });
});
