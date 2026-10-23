import { describe, expect, test } from "bun:test";
import { FakeTime, flush } from "../host/testing";
import { canonicalJson, fingerprint, IdempotencyCache } from "./idempotency";

function setup(capacity = 3, ttlMs = 1_000) {
  const time = new FakeTime();
  const cache = new IdempotencyCache<string>({ capacity, ttlMs }, time);
  let calls = 0;
  const work = (value: string) => async () => {
    calls++;
    return value;
  };
  return { time, cache, work, calls: () => calls };
}

describe("IdempotencyCache", () => {
  test("runs fresh work, then replays it for the same key and fingerprint", async () => {
    const { cache, work, calls } = setup();
    expect(await cache.run("k", "f", work("first"))).toEqual({ kind: "fresh", value: "first" });
    expect(await cache.run("k", "f", work("second"))).toEqual({ kind: "replayed", value: "first" });
    expect(calls()).toBe(1);
  });

  test("refuses the key for a different fingerprint, completed or in flight", async () => {
    const { cache, work } = setup();
    await cache.run("done", "f", work("v"));
    expect(await cache.run("done", "other", work("v"))).toEqual({ kind: "mismatch" });

    let release: (value: string) => void = () => {};
    void cache.run("busy", "f", () => new Promise<string>((resolve) => (release = resolve)));
    expect(await cache.run("busy", "other", work("v"))).toEqual({ kind: "mismatch" });
    release("done");
  });

  test("coalesces a repeat while the first is in flight", async () => {
    const { cache } = setup();
    let release: (value: string) => void = () => {};
    let calls = 0;
    const slow = () => {
      calls++;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    const first = cache.run("k", "f", slow);
    const second = cache.run("k", "f", slow);
    await flush();
    release("v");
    expect(await first).toEqual({ kind: "fresh", value: "v" });
    expect(await second).toEqual({ kind: "coalesced", value: "v" });
    expect(calls).toBe(1);
  });

  test("does not store work that throws, so the next call runs it again", async () => {
    const { cache, work } = setup();
    await expect(
      cache.run("k", "f", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await cache.run("k", "f", work("v"))).toEqual({ kind: "fresh", value: "v" });
  });

  test("forgets a key once its TTL has passed since it completed", async () => {
    const { cache, work, time } = setup(3, 1_000);
    await cache.run("k", "f", work("first"));
    await time.advance(999);
    expect((await cache.run("k", "f", work("second"))).kind).toBe("replayed");
    await time.advance(1);
    expect(await cache.run("k", "other", work("second"))).toEqual({ kind: "fresh", value: "second" });
  });

  test("evicts the least recently used key beyond its capacity", async () => {
    const { cache, work } = setup(2);
    await cache.run("a", "f", work("a"));
    await cache.run("b", "f", work("b"));
    await cache.run("a", "f", work("a"));
    await cache.run("c", "f", work("c"));
    expect(cache.size).toBe(2);
    expect((await cache.run("a", "f", work("a2"))).kind).toBe("replayed");
    expect((await cache.run("b", "f", work("b2"))).kind).toBe("fresh");
  });

  const badConfigs: Array<[name: string, capacity: number, ttlMs: number, message: string]> = [
    ["zero capacity", 0, 1_000, "capacity"],
    ["fractional capacity", 1.5, 1_000, "capacity"],
    ["zero TTL", 1, 0, "ttlMs"],
  ];
  for (const [name, capacity, ttlMs, message] of badConfigs) {
    test(`refuses ${name}`, () => {
      expect(() => new IdempotencyCache({ capacity, ttlMs }, new FakeTime())).toThrow(message);
    });
  }
});

describe("fingerprint", () => {
  test("does not depend on key order at any level", () => {
    expect(fingerprint({ a: 1, b: { c: [1, { d: 2, e: 3 }] } })).toBe(
      fingerprint({ b: { c: [1, { e: 3, d: 2 }] }, a: 1 })
    );
  });

  const rows: Array<[name: string, value: unknown, json: string]> = [
    ["sorted keys", { b: 1, a: "x" }, '{"a":"x","b":1}'],
    ["undefined members left out", { a: undefined, b: null }, '{"b":null}'],
    ["array order kept, undefined as null", [2, undefined, 1], "[2,null,1]"],
    ["a string", "hi", '"hi"'],
  ];
  for (const [name, value, json] of rows) {
    test(`canonical JSON: ${name}`, () => {
      expect(canonicalJson(value)).toBe(json);
    });
  }

  test("differs when a value differs", () => {
    expect(fingerprint({ message: "a" })).not.toBe(fingerprint({ message: "b" }));
  });
});
