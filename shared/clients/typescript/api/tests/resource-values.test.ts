import { describe, expect, test } from "bun:test";
import { canonicalIdForStorageKey, resourceValueStorageKey } from "../resource-values";

describe("canonicalIdForStorageKey", () => {
  const cases: { key: string; canonicalId: string | null }[] = [
    { key: "state:woofx3:counter:deaths", canonicalId: "woofx3:counter:deaths" },
    { key: "state:my_module:timer:a:b", canonicalId: "my_module:timer:a:b" },
    { key: "state:", canonicalId: null },
    { key: "state", canonicalId: null },
    { key: "resource:woofx3:counter:deaths", canonicalId: null },
    { key: "setting:volume", canonicalId: null },
    { key: "State:woofx3:counter:deaths", canonicalId: null },
    { key: " state:woofx3:counter:deaths", canonicalId: null },
    { key: "", canonicalId: null },
  ];

  for (const { key, canonicalId } of cases) {
    test(`${JSON.stringify(key)} -> ${JSON.stringify(canonicalId)}`, () => {
      expect(canonicalIdForStorageKey(key)).toBe(canonicalId);
    });
  }
});

describe("resourceValueStorageKey", () => {
  const cases: { canonicalId: string; key: string }[] = [
    { canonicalId: "woofx3:counter:deaths", key: "state:woofx3:counter:deaths" },
    { canonicalId: "my_module:queue:songs", key: "state:my_module:queue:songs" },
  ];

  for (const { canonicalId, key } of cases) {
    test(`${canonicalId} -> ${key}, and back`, () => {
      expect(resourceValueStorageKey(canonicalId)).toBe(key);
      expect(canonicalIdForStorageKey(resourceValueStorageKey(canonicalId))).toBe(canonicalId);
    });
  }

  test("refuses an empty canonical id, which no key could be read back from", () => {
    expect(() => resourceValueStorageKey("")).toThrow(/must not be empty/);
  });
});
