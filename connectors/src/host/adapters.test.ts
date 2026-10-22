import { describe, expect, test } from "bun:test";
import { ADAPTERS, type AdapterRegistry, loadAdapters } from "./adapters";
import { FakeAdapter, servedSubject } from "./testing";

describe("loadAdapters", () => {
  test("ships with no adapter registered", async () => {
    expect((await loadAdapters(ADAPTERS)).size).toBe(0);
  });

  test("builds each registered adapter once", async () => {
    const adapter = new FakeAdapter("twitch");
    const adapters = await loadAdapters({ twitch: async () => () => adapter });
    expect(adapters.get("twitch")).toBe(adapter);
  });

  test("fails on an entry that is not an adapter id", async () => {
    const registry = { kick: async () => () => new FakeAdapter() } as AdapterRegistry;
    await expect(loadAdapters(registry)).rejects.toThrow('"kick", which is not an adapter id');
  });

  test("fails when the built adapter claims a different id", async () => {
    const impostor = new FakeAdapter("twitch");
    Object.assign(impostor.manifest, { id: "obs" });
    await expect(loadAdapters({ twitch: async () => () => impostor })).rejects.toThrow('says its id is "obs"');
  });

  const overlapping: Array<[name: string, subscribes: string[]]> = [
    ["the served subject itself", ["twitchapi"]],
    ["a wildcard covering it", [">"]],
  ];
  for (const [name, subscribes] of overlapping) {
    test(`fails when the manifest subscribes to ${name}`, async () => {
      const adapter = new FakeAdapter("twitch", [servedSubject("twitchapi", 1_000)]);
      Object.assign(adapter.manifest, { subscribes });
      await expect(loadAdapters({ twitch: async () => () => adapter })).rejects.toThrow('covers "twitchapi"');
    });
  }

  test("accepts a manifest whose subscriptions miss what it serves", async () => {
    const adapter = new FakeAdapter("twitch", [servedSubject("twitchapi", 1_000)]);
    Object.assign(adapter.manifest, { subscribes: ["twitchapi.events", "fake.*"] });
    expect((await loadAdapters({ twitch: async () => () => adapter })).size).toBe(1);
  });
});
