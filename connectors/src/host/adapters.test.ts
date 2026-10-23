import { describe, expect, test } from "bun:test";
import { connectorsConfig } from "../config";
import { adapterRegistry, type AdapterRegistry, loadAdapters } from "./adapters";
import { systemIds } from "./deps";
import { FakeAdapter, FakeTime, servedSubject } from "./testing";

describe("loadAdapters", () => {
  test("ships with the twitch adapter registered, serving twitchapi", async () => {
    const config = connectorsConfig({
      woofx3MessagebusUrl: "ws://127.0.0.1:4225",
      woofx3DatabaseProxyUrl: "http://127.0.0.1:5555",
      woofx3DbProxyToken: "connectors-db-proxy-token-0123456789abcdef",
    });
    const { adapters } = await loadAdapters(adapterRegistry({ config, clock: new FakeTime(), ids: systemIds }));
    expect([...adapters.keys()]).toEqual(["twitch"]);
    expect(adapters.get("twitch")?.manifest.serves.map((served) => served.subject)).toEqual(["twitchapi"]);
  });

  test("builds each registered adapter once", async () => {
    const adapter = new FakeAdapter("twitch");
    const { adapters } = await loadAdapters({ twitch: async () => ({ create: () => adapter }) });
    expect(adapters.get("twitch")).toBe(adapter);
  });

  test("fails on an entry that is not an adapter id", async () => {
    const registry = { kick: async () => ({ create: () => new FakeAdapter() }) } as AdapterRegistry;
    await expect(loadAdapters(registry)).rejects.toThrow('"kick", which is not an adapter id');
  });

  test("fails when the built adapter claims a different id", async () => {
    const impostor = new FakeAdapter("twitch");
    Object.assign(impostor.manifest, { id: "obs" });
    await expect(loadAdapters({ twitch: async () => ({ create: () => impostor }) })).rejects.toThrow(
      'says its id is "obs"'
    );
  });

  const overlapping: Array<[name: string, subscribes: string[]]> = [
    ["the served subject itself", ["twitchapi"]],
    ["a wildcard covering it", [">"]],
  ];
  for (const [name, subscribes] of overlapping) {
    test(`fails when the manifest subscribes to ${name}`, async () => {
      const adapter = new FakeAdapter("twitch", [servedSubject("twitchapi", 1_000)]);
      Object.assign(adapter.manifest, { subscribes });
      await expect(loadAdapters({ twitch: async () => ({ create: () => adapter }) })).rejects.toThrow(
        'covers "twitchapi"'
      );
    });
  }

  test("accepts a manifest whose subscriptions miss what it serves", async () => {
    const adapter = new FakeAdapter("twitch", [servedSubject("twitchapi", 1_000)]);
    Object.assign(adapter.manifest, { subscribes: ["twitchapi.events", "fake.*"] });
    expect((await loadAdapters({ twitch: async () => ({ create: () => adapter }) })).adapters.size).toBe(1);
  });

  test("builds the host state once and hands it to create", async () => {
    const adapter = new FakeAdapter("twitch");
    let built = 0;
    const state = { latch: false };
    const created: unknown[] = [];
    const { hostStates } = await loadAdapters({
      twitch: async () => ({
        hostState: () => {
          built++;
          return state;
        },
        create: (hostState) => {
          created.push(hostState);
          return adapter;
        },
      }),
    });
    expect(built).toBe(1);
    expect(created).toEqual([state]);
    expect(hostStates.get("twitch")).toBe(state);
  });

  test("a module without host state is created with undefined", async () => {
    const created: unknown[] = [];
    const { hostStates } = await loadAdapters({
      twitch: async () => ({
        create: (hostState) => {
          created.push(hostState);
          return new FakeAdapter("twitch");
        },
      }),
    });
    expect(created).toEqual([undefined]);
    expect(hostStates.get("twitch")).toBeUndefined();
  });
});
