import { describe, expect, it } from "bun:test";
import type { EngineHosting, RelayConfig } from "@woofx3/api";
import type { BusMessage, ScopedHandler } from "../host/scoped-bus";
import { bytes, RecordingLogger } from "../host/testing";
import {
  type LastRoute,
  MODULE_SETTING_UPDATED_SUBJECT,
  ROUTE_WATCH_SUBJECTS,
  RouteWatch,
  relayChangeMovesEndpoint,
} from "./route-watch";
import type { LocalEndpointRef } from "./types";

const OBS: LocalEndpointRef = { moduleId: "woofx3_obs", endpointId: "obs" };
const LIGHTS: LocalEndpointRef = { moduleId: "woofx3_lights", endpointId: "bridge" };
const CONFIG: RelayConfig = { bridgeOrigin: "https://c-x.woofx3.tv", endpoints: [OBS] };
const DIRECT: LastRoute = { route: "direct", address: "127.0.0.1:4455" };
const BRIDGED: LastRoute = { route: "companion", address: "c-x.woofx3.tv" };

describe("relayChangeMovesEndpoint", () => {
  const cases: Array<[string, RelayConfig | null, LastRoute | null, boolean]> = [
    ["a direct session onto a bridge that now lists it", CONFIG, DIRECT, true],
    ["a bridged session off when nothing is routed", null, BRIDGED, true],
    ["a bridged session off when it is no longer listed", { ...CONFIG, endpoints: [] }, BRIDGED, true],
    ["a bridged session to another bridge", { ...CONFIG, bridgeOrigin: "https://c-y.woofx3.tv" }, BRIDGED, true],
    ["no attempt yet, whose read may be stale", CONFIG, null, true],
    ["a bridged session on the same bridge", CONFIG, BRIDGED, false],
    ["a direct session with nothing routed", null, DIRECT, false],
    ["a direct session when only another endpoint is listed", { ...CONFIG, endpoints: [LIGHTS] }, DIRECT, false],
  ];
  for (const [name, config, last, moves] of cases) {
    it(`${moves ? "moves" : "leaves"} ${name}`, () => {
      expect(relayChangeMovesEndpoint(config, OBS, last)).toBe(moves);
    });
  }
});

function watch(
  options: { config?: () => Promise<RelayConfig | null>; hosting?: EngineHosting | null; last?: LastRoute | null } = {}
) {
  const logger = new RecordingLogger();
  const routeWatch = new RouteWatch({
    relayConfig: options.config ?? (async () => CONFIG),
    lastRoute: () => (options.last === undefined ? DIRECT : options.last),
    hosting: options.hosting ?? null,
    logger,
  });
  const heard: string[] = [];
  return { routeWatch, logger, heard, record: (name: string) => (why: string) => heard.push(`${name}: ${why}`) };
}

const settingWritten = (moduleId: string): BusMessage => ({
  subject: `db.module.setting.updated.${moduleId}`,
  data: bytes(JSON.stringify({ type: "db.module.setting.updated", data: { moduleId, key: "host" } })),
  respond: () => false,
});

describe("RouteWatch", () => {
  it("subscribes to the relay configuration and module setting writes", async () => {
    const subscribed: string[] = [];
    const { routeWatch } = watch();
    await routeWatch.subscribe({
      subscribe: async (subject: string, _handler: ScopedHandler) => {
        subscribed.push(subject);
      },
    });
    expect(subscribed).toEqual([...ROUTE_WATCH_SUBJECTS]);
    expect(subscribed).toContain(MODULE_SETTING_UPDATED_SUBJECT);
  });

  it("tells an endpoint's listeners when a relay change moves it", async () => {
    const { routeWatch, heard, record } = watch({ last: DIRECT });
    routeWatch.listen(OBS, record("obs"));
    routeWatch.listen(LIGHTS, record("lights"));
    await routeWatch.relayConfigUpdated();
    expect(heard).toEqual(["obs: Relay configuration changed"]);
  });

  it("stays quiet when a relay change leaves the endpoint on its route", async () => {
    const { routeWatch, heard, record } = watch({ last: BRIDGED });
    routeWatch.listen(OBS, record("obs"));
    await routeWatch.relayConfigUpdated();
    expect(heard).toEqual([]);
  });

  it("reconnects every endpoint when the configuration cannot be read", async () => {
    const { routeWatch, heard, record, logger } = watch({
      last: BRIDGED,
      config: async () => {
        throw new Error("db down");
      },
    });
    routeWatch.listen(OBS, record("obs"));
    routeWatch.listen(LIGHTS, record("lights"));
    await routeWatch.relayConfigUpdated();
    expect(heard).toHaveLength(2);
    expect(logger.at("warn")).toHaveLength(1);
  });

  it("ignores relay changes on a local engine, which never takes the bridge", async () => {
    let reads = 0;
    const { routeWatch, heard, record } = watch({
      hosting: "local",
      config: async () => {
        reads++;
        return CONFIG;
      },
    });
    routeWatch.listen(OBS, record("obs"));
    await routeWatch.relayConfigUpdated();
    expect(heard).toEqual([]);
    expect(reads).toBe(0);
  });

  it("tells the endpoints of the module whose settings were written, and no others", () => {
    const { routeWatch, heard, record } = watch();
    routeWatch.listen(OBS, record("obs"));
    routeWatch.listen(LIGHTS, record("lights"));
    routeWatch.moduleSettingUpdated(settingWritten("woofx3_obs"));
    routeWatch.moduleSettingUpdated(settingWritten("someone_else"));
    expect(heard).toEqual(["obs: woofx3_obs settings changed"]);
  });

  it("drops a malformed setting event with a warning", () => {
    const { routeWatch, heard, record, logger } = watch();
    routeWatch.listen(OBS, record("obs"));
    routeWatch.moduleSettingUpdated({
      subject: "db.module.setting.updated.x",
      data: bytes("not json"),
      respond: () => false,
    });
    routeWatch.moduleSettingUpdated({
      subject: "db.module.setting.updated.x",
      data: bytes("{}"),
      respond: () => false,
    });
    expect(heard).toEqual([]);
    expect(logger.at("warn")).toHaveLength(1);
  });

  it("keeps calling the other listeners when one throws", () => {
    const { routeWatch, heard, record, logger } = watch();
    routeWatch.listen(OBS, () => {
      throw new Error("listener bug");
    });
    routeWatch.listen(OBS, record("second"));
    routeWatch.moduleSettingUpdated(settingWritten("woofx3_obs"));
    expect(heard).toEqual(["second: woofx3_obs settings changed"]);
    expect(logger.at("warn")[0]?.message).toContain("woofx3_obs/obs");
  });

  it("stops telling a listener once it unsubscribes", () => {
    const { routeWatch, heard, record } = watch();
    const stop = routeWatch.listen(OBS, record("obs"));
    stop();
    stop();
    routeWatch.moduleSettingUpdated(settingWritten("woofx3_obs"));
    expect(heard).toEqual([]);
  });
});
