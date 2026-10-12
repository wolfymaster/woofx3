import { describe, expect, test } from "bun:test";
import { evenKeys, isOrderKey, keyAt, keyBetween, keysBetween, MAX_KEY_LENGTH, orderByKey } from "../model";

/** The sync layer's stacking keys, as documents already hold them. Must match `zKey` in api/scene-editor/document.ts. */
function zKey(index: number): string {
  return `a${index.toString(36).padStart(4, "0")}`;
}

/** A small seeded generator, so a failing run can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function expectAscending(keys: readonly string[]): void {
  for (let i = 1; i < keys.length; i++) {
    expect(keys[i - 1]! < keys[i]!).toBe(true);
  }
}

describe("keyBetween", () => {
  test("sorts strictly between its bounds", () => {
    const cases: Array<[string | null, string | null]> = [
      [null, null],
      ["a", null],
      [null, "a"],
      ["a", "b"],
      ["a", "c"],
      ["a", "a1"],
      ["az", "b"],
      ["zz", null],
      [null, "01"],
      [null, "001"],
      ["a0000", "a0001"],
      ["a000z", "a0010"],
    ];
    for (const [a, b] of cases) {
      const key = keyBetween(a, b);
      expect(isOrderKey(key)).toBe(true);
      expect(key.endsWith("0")).toBe(false);
      if (a !== null) {
        expect(a < key).toBe(true);
      }
      if (b !== null) {
        expect(key < b).toBe(true);
      }
    }
  });

  test("refuses bounds out of order or with no room between", () => {
    expect(() => keyBetween("b", "a")).toThrow();
    expect(() => keyBetween("a", "a")).toThrow();
    expect(() => keyBetween("a", "a0")).toThrow();
    expect(() => keyBetween(null, "0")).toThrow();
    expect(() => keyBetween("A", null)).toThrow();
  });

  test("keys from zKey interoperate: inserts land between and around them", () => {
    const existing = [0, 1, 2, 35, 36, 37].map(zKey);
    expectAscending(existing);
    for (let i = 0; i <= existing.length; i++) {
      const below = i > 0 ? existing[i - 1]! : null;
      const above = i < existing.length ? existing[i]! : null;
      const key = keyBetween(below, above);
      const merged = [...existing.slice(0, i), key, ...existing.slice(i)];
      expectAscending(merged);
    }
  });

  test("appending to the top stays short", () => {
    let key: string | null = zKey(4);
    for (let i = 0; i < 300; i++) {
      key = keyBetween(key, null);
    }
    expect(key!.length).toBeLessThanOrEqual(12);
  });

  test("many random inserts keep order and never collide", () => {
    const next = random(7);
    for (let round = 0; round < 20; round++) {
      const keys = [0, 1, 2, 3].map(zKey);
      for (let i = 0; i < 400; i++) {
        const index = Math.floor(next() * (keys.length + 1));
        const key = keyBetween(index > 0 ? keys[index - 1]! : null, index < keys.length ? keys[index]! : null);
        keys.splice(index, 0, key);
      }
      expectAscending(keys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("repeated inserts at one spot stay ordered", () => {
    const keys = [zKey(0), zKey(1)];
    for (let i = 0; i < 200; i++) {
      keys.splice(1, 0, keyBetween(keys[0]!, keys[1]!));
    }
    expectAscending(keys);
    for (let i = 0; i < 200; i++) {
      keys.splice(0, 0, keyBetween(null, keys[0]!));
    }
    expectAscending(keys);
  });
});

describe("keysBetween", () => {
  test("makes n ascending keys inside the bounds", () => {
    for (const [a, b] of [
      [null, null],
      ["a0001", null],
      [null, "a0001"],
      ["a0001", "a0002"],
    ] as Array<[string | null, string | null]>) {
      const keys = keysBetween(a, b, 25);
      expect(keys).toHaveLength(25);
      expectAscending([...(a === null ? [] : [a]), ...keys, ...(b === null ? [] : [b])]);
    }
    expect(keysBetween("a", "b", 0)).toEqual([]);
  });
});

describe("stack helpers", () => {
  test("orderByKey sorts by key, then id", () => {
    const order = orderByKey({ c: { z: "b" }, a: { z: "b" }, b: { z: "a" } }, (entry) => entry.z);
    expect(order).toEqual(["b", "a", "c"]);
  });

  test("keyAt places one entry between its neighbours, or says there is no room", () => {
    const keys = [zKey(0), zKey(1), zKey(2)];
    expect(keyAt(keys, 0)! < keys[0]!).toBe(true);
    expect(keyAt(keys, 3)! > keys[2]!).toBe(true);
    const middle = keyAt(keys, 2)!;
    expect(keys[1]! < middle && middle < keys[2]!).toBe(true);
    expect(keyAt(["a", "a"], 1)).toBeNull();
    expect(keyAt(["a", "a0"], 1)).toBeNull();
  });

  test("keyAt refuses a key longer than the limit", () => {
    let lower = "a";
    const upper = "a1";
    while (lower.length <= MAX_KEY_LENGTH) {
      lower = keyBetween(lower, upper);
    }
    expect(keyAt([lower, upper], 1)).toBeNull();
  });

  test("evenKeys match zKey's form and ascend", () => {
    const keys = evenKeys(40);
    expectAscending(keys);
    expect(keys[0]).toBe(zKey(1));
    expect(keys.every((key) => /^a[0-9a-z]{4}$/.test(key))).toBe(true);
  });
});
