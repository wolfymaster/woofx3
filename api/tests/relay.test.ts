import { describe, expect, mock, test } from "bun:test";
import type { RelayConfig, Woofx3EngineApi } from "@woofx3/api";
import { Api, type ApiOptions } from "../src/api";
import { ApiSession } from "../src/api-session";

function session(options: { writeFails?: boolean } = {}) {
  const settings = new Map<string, string>();
  const published: string[] = [];
  const db = {
    trySetSetting: mock(async (key: string, value: string) => {
      if (options.writeFails) {
        return false;
      }
      settings.set(key, value);
      return true;
    }),
    deleteSetting: mock(async (key: string) => {
      settings.delete(key);
    }),
    getSetting: mock(async (key: string) => settings.get(key) ?? null),
  };
  const api = new Api({
    db: db as unknown as ApiOptions["db"],
    nats: {
      publish: mock(async (subject: string) => {
        published.push(subject);
      }),
    } as unknown as ApiOptions["nats"],
    functions: null,
    barkloaderUrl: "http://barkloader.local",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger: { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never,
  });
  return { api, settings, published, rpc: new ApiSession(api, "dash-client") as unknown as Woofx3EngineApi };
}

const CONFIG: RelayConfig = {
  bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv",
  endpoints: [{ moduleId: "woofx3_obs", endpointId: "obs" }],
};

describe("setRelayConfig", () => {
  test("stores the configuration with the session's client id and announces it", async () => {
    const { settings, published, rpc } = session();
    expect(await rpc.setRelayConfig(CONFIG)).toEqual({ ok: true });
    expect(JSON.parse(settings.get("relay.config") ?? "")).toEqual({ ...CONFIG, clientId: "dash-client" });
    expect(published).toEqual(["engine.relay.config.updated"]);
  });

  test("null deletes the configuration and announces it", async () => {
    const { settings, published, rpc } = session();
    await rpc.setRelayConfig(CONFIG);
    expect(await rpc.setRelayConfig(null)).toEqual({ ok: true });
    expect(settings.has("relay.config")).toBe(false);
    expect(published).toEqual(["engine.relay.config.updated", "engine.relay.config.updated"]);
  });

  test("throws when the setting cannot be written, and announces nothing", async () => {
    const { published, rpc } = session({ writeFails: true });
    await expect(rpc.setRelayConfig(CONFIG)).rejects.toThrow("could not store relay.config");
    expect(published).toEqual([]);
  });

  test("refuses a configuration the dialer could not use safely", async () => {
    const bad: [unknown, string][] = [
      [{ ...CONFIG, bridgeOrigin: "http://c-abcdefghijkl.woofx3.tv" }, "must be https"],
      [{ ...CONFIG, bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv/bridge" }, "must be an origin"],
      [{ ...CONFIG, bridgeOrigin: "https://c-abcdefghijkl.woofx3.tv?x=1" }, "must be an origin"],
      [{ ...CONFIG, bridgeOrigin: "https://user:pw@c-abcdefghijkl.woofx3.tv" }, "must be an origin"],
      [{ ...CONFIG, bridgeOrigin: "not a url" }, "not a URL"],
      [
        {
          ...CONFIG,
          endpoints: Array.from({ length: 51 }, (_, i) => ({ moduleId: `m${i}`, endpointId: "obs" })),
        },
        "at most 50",
      ],
      [{ ...CONFIG, endpoints: [{ moduleId: "woofx3_obs/..", endpointId: "obs" }] }, "invalid moduleId"],
      [{ ...CONFIG, endpoints: [{ moduleId: ".", endpointId: "obs" }] }, "invalid moduleId"],
      [{ ...CONFIG, endpoints: [{ moduleId: "..", endpointId: "obs" }] }, "invalid moduleId"],
      [{ ...CONFIG, endpoints: [{ moduleId: "woofx3_obs", endpointId: "OBS" }] }, "invalid endpointId"],
      [{ ...CONFIG, endpoints: "woofx3_obs/obs" }, "must be an array"],
    ];
    for (const [config, message] of bad) {
      const { settings, rpc } = session();
      await expect(rpc.setRelayConfig(config as RelayConfig)).rejects.toThrow(message);
      expect(settings.has("relay.config")).toBe(false);
    }
  });

  test("drops the cached bridge credential, which may be for another bridge", async () => {
    const { api, rpc } = session();
    const setConfig = mock(async () => {});
    (api.relayCredential as unknown as { setConfig: typeof setConfig }).setConfig = setConfig;
    await rpc.setRelayConfig(CONFIG);
    await rpc.setRelayConfig(null);
    expect(setConfig.mock.calls as unknown[]).toEqual([[{ ...CONFIG, clientId: "dash-client" }], [null]]);
  });
});
