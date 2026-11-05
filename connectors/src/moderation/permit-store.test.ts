import { expect, test } from "bun:test";
import { MemoryPermitStore } from "./permit-store";
import { PLATFORM } from "./testing";

test("a permit lasts its seconds, by login on one platform, ignoring case", () => {
  let now = 0;
  const permits = new MemoryPermitStore(10, { now: () => now });
  permits.grant(PLATFORM, "Someone", 30);
  expect(permits.isPermitted(PLATFORM, "someone")).toBe(true);
  expect(permits.isPermitted(PLATFORM, "someone_else")).toBe(false);
  now = 29_999;
  expect(permits.isPermitted(PLATFORM, "someone")).toBe(true);
  now = 30_000;
  expect(permits.isPermitted(PLATFORM, "someone")).toBe(false);
});

test("holds at most its capacity, dropping the least recently used", () => {
  const permits = new MemoryPermitStore(2, { now: () => 0 });
  permits.grant(PLATFORM, "a", 60);
  permits.grant(PLATFORM, "b", 60);
  permits.grant(PLATFORM, "c", 60);
  expect(permits.isPermitted(PLATFORM, "a")).toBe(false);
  expect(permits.isPermitted(PLATFORM, "c")).toBe(true);
});
