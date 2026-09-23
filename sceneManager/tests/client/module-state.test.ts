import { describe, expect, it } from "bun:test";
import { ModuleStateCache, type ModuleStateTarget } from "../../public/scene-manager/module-state";

const KEY = "state:woofx3:counter:deaths";

function target(instanceId = "w1") {
  const received: unknown[] = [];
  const t: ModuleStateTarget & { received: unknown[] } = {
    instanceId,
    received,
    sendStorageValue: (_key, value) => {
      received.push(value);
    },
  };
  return t;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ModuleStateCache", () => {
  it("fetches a key on first watch and sends it to the watcher", async () => {
    const cache = new ModuleStateCache(async () => 4);
    const t = target();
    cache.watch("woofx3", KEY, t);
    await flush();
    expect(t.received).toEqual([4]);
    expect(cache.peek("woofx3", KEY)).toBe(4);
  });

  it("answers a later watcher from what it already has, without fetching again", async () => {
    let fetches = 0;
    const cache = new ModuleStateCache(async () => {
      fetches += 1;
      return 4;
    });
    cache.watch("woofx3", KEY, target());
    await flush();
    const second = target();
    cache.watch("woofx3", KEY, second);
    expect(second.received).toEqual([4]);
    expect(fetches).toBe(1);
  });

  it("fetches through the placement that subscribed", async () => {
    const asked: string[] = [];
    const cache = new ModuleStateCache(async (instanceId, key) => {
      asked.push(`${instanceId} ${key}`);
      return 4;
    });
    cache.watch("woofx3", KEY, target("w7"));
    await flush();
    expect(asked).toEqual([`w7 ${KEY}`]);
  });

  it("peeks null for a key that has not loaded", () => {
    const cache = new ModuleStateCache(() => new Promise(() => {}));
    expect(cache.peek("woofx3", KEY)).toBeNull();
  });

  it("sends a pushed change to every watcher", async () => {
    const cache = new ModuleStateCache(async () => 4);
    const a = target();
    const b = target();
    cache.watch("woofx3", KEY, a);
    cache.watch("woofx3", KEY, b);
    await flush();
    cache.apply("woofx3", KEY, 5);
    expect(a.received).toEqual([4, 5]);
    expect(b.received).toEqual([4, 5]);
  });

  it("keeps a pushed change over a fetch that was already in flight", async () => {
    const fetched = deferred<unknown>();
    const cache = new ModuleStateCache(() => fetched.promise);
    const t = target();
    cache.watch("woofx3", KEY, t);
    cache.apply("woofx3", KEY, 6);
    fetched.resolve(5);
    await flush();
    expect(t.received).toEqual([6]);
    expect(cache.peek("woofx3", KEY)).toBe(6);
  });

  it("ignores a change to a key nobody watches", () => {
    const cache = new ModuleStateCache(async () => 4);
    cache.apply("woofx3", KEY, 5);
    expect(cache.peek("woofx3", KEY)).toBeNull();
  });

  it("stops sending once every subscription of a watcher is gone", async () => {
    const cache = new ModuleStateCache(async () => 4);
    const t = target();
    cache.watch("woofx3", KEY, t);
    cache.watch("woofx3", KEY, t);
    await flush();
    cache.unwatch("woofx3", KEY, t);
    cache.apply("woofx3", KEY, 5);
    cache.unwatch("woofx3", KEY, t);
    cache.apply("woofx3", KEY, 6);
    expect(t.received).toEqual([4, 5]);
  });

  it("fetches watched keys again on refresh, and retries one that failed", async () => {
    let answer: () => Promise<unknown> = async () => {
      throw new Error("unavailable");
    };
    const cache = new ModuleStateCache(() => answer());
    const t = target();
    cache.watch("woofx3", KEY, t);
    await flush();
    expect(t.received).toEqual([]);

    answer = async () => 8;
    cache.refresh();
    await flush();
    expect(t.received).toEqual([8]);
  });
});
