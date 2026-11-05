import { describe, expect, test } from "bun:test";
import { DEFAULT_MODERATION_CONFIG, type ModerationConfig } from "@woofx3/api/moderation-config";
import { linkPermits, MemoryPermitStore } from "./permit-store";
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

describe("linkPermits", () => {
  const links = (enabled: boolean, permitSeconds: number): ModerationConfig => ({
    ...DEFAULT_MODERATION_CONFIG,
    enabled: true,
    rules: { links: { enabled, actions: [{ kind: "delete" }], params: { allowDomains: [], permitSeconds } } },
  });
  const rows: Array<[name: string, config: ModerationConfig, seconds: number | null]> = [
    ["the links rule's permit time", links(true, 90), 90],
    ["nothing while the links rule is off", links(false, 90), null],
    ["nothing when permits last no time", links(true, 0), null],
    ["nothing while moderation is off", { ...links(true, 90), enabled: false }, null],
    ["nothing without a links rule", { ...DEFAULT_MODERATION_CONFIG, enabled: true }, null],
  ];
  for (const [name, config, seconds] of rows) {
    test(`grants ${name}`, () => {
      const store = new MemoryPermitStore(10, { now: () => 0 });
      expect(linkPermits({ current: () => config }, store).permit(PLATFORM, "someone")).toBe(seconds);
      expect(store.isPermitted(PLATFORM, "someone")).toBe(seconds !== null);
    });
  }
});
