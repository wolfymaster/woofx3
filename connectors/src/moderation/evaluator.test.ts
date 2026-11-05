import { describe, expect, test } from "bun:test";
import {
  DEFAULT_EXEMPTIONS,
  FILTER_IDS,
  type FilterId,
  type ModerationConfig,
  type ModerationRule,
} from "@woofx3/api/moderation-config";
import { FakeTime, RecordingLogger } from "../host/testing";
import { type EvaluatorDeps, evaluateLine } from "./evaluator";
import { filterRegistry } from "./registry";
import { filterEnv, moderationLine, NOBODY, stubFilter } from "./testing";
import type { ModerationFilter } from "./types";

const rule: ModerationRule = { enabled: true, actions: [{ kind: "delete" }], params: {} };

function config(rules: Partial<Record<FilterId, ModerationRule>>): ModerationConfig {
  return { version: 1, enabled: true, dryRun: false, exempt: DEFAULT_EXEMPTIONS, rules };
}

function setup(overrides: Partial<Record<FilterId, ModerationFilter>> = {}) {
  const filters = Object.fromEntries(FILTER_IDS.map((id) => [id, overrides[id] ?? stubFilter(id)])) as Record<
    FilterId,
    ModerationFilter
  >;
  const time = new FakeTime();
  const logger = new RecordingLogger();
  const deps: EvaluatorDeps = {
    registry: filterRegistry(Object.values(filters)),
    env: filterEnv({ clock: time }),
    clock: time,
    logger,
    slowRuleWarnMs: 5,
  };
  return { deps, logger };
}

const hitting = (id: FilterId, reason = `${id} hit`) => stubFilter(id, () => ({ hit: true, reason }));

describe("evaluateLine", () => {
  test("first hit wins, in FILTER_IDS order, and later rules are not evaluated", async () => {
    const links = hitting("links");
    const caps = hitting("caps");
    const { deps } = setup({ links, caps });
    const hit = await evaluateLine(moderationLine(), config({ links: rule, caps: rule }), deps);
    expect(hit).toEqual({ filter: "links", rule, reason: "links hit" });
    expect(caps.calls).toBe(0);
  });

  test("evaluates banned phrases before links", async () => {
    const { deps } = setup({ links: hitting("links"), banned_phrases: hitting("banned_phrases") });
    const hit = await evaluateLine(moderationLine(), config({ links: rule, banned_phrases: rule }), deps);
    expect(hit?.filter).toBe("banned_phrases");
  });

  test("skips disabled rules and filters without a rule", async () => {
    const links = hitting("links");
    const caps = hitting("caps");
    const { deps } = setup({ links, caps });
    expect(await evaluateLine(moderationLine(), config({ links: { ...rule, enabled: false } }), deps)).toBeNull();
    expect(links.calls + caps.calls).toBe(0);
  });

  test("does not evaluate a rule the speaker is exempt from", async () => {
    const links = hitting("links");
    const { deps } = setup({ links });
    const moderator = moderationLine({ membership: { ...NOBODY, isModerator: true } });
    expect(await evaluateLine(moderator, config({ links: rule }), deps)).toBeNull();
    expect(links.calls).toBe(0);
  });

  test("a rule's own exemptions apply to that rule only", async () => {
    const { deps } = setup({ links: hitting("links"), caps: hitting("caps") });
    const subscriber = moderationLine({ membership: { ...NOBODY, isSubscriber: true } });
    const hit = await evaluateLine(
      subscriber,
      config({ links: rule, caps: { ...rule, exempt: { subscribers: false } } }),
      deps
    );
    expect(hit?.filter).toBe("caps");
  });

  // The seam for a channel-aware scorer: one more filter whose evaluate is async and grades the line.
  test("awaits an async scoring filter, placed last, and carries its score", async () => {
    const order: string[] = [];
    const scorer = stubFilter("symbols", async () => {
      await Promise.resolve();
      order.push("scorer");
      return { hit: true, reason: "looks like spam", score: 0.92 };
    });
    const caps = stubFilter("caps", () => {
      order.push("caps");
      return { hit: false };
    });
    const { deps } = setup({ symbols: scorer, caps });
    const hit = await evaluateLine(moderationLine(), config({ caps: rule, symbols: rule }), deps);
    expect(hit).toEqual({ filter: "symbols", rule, reason: "looks like spam", score: 0.92 });
    expect(order).toEqual(["caps", "scorer"]);
  });

  test("logs a filter that throws and goes on to the next rule", async () => {
    const broken = stubFilter("links", () => {
      throw new Error("boom");
    });
    const { deps, logger } = setup({ links: broken, caps: hitting("caps") });
    const hit = await evaluateLine(moderationLine(), config({ links: rule, caps: rule }), deps);
    expect(hit?.filter).toBe("caps");
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: "error", metadata: { filter: "links", error: "boom" } })
    );
  });

  test("logs a filter slower than slowRuleWarnMs, by the injected clock", async () => {
    const { deps, logger } = setup();
    let now = 0;
    deps.clock = { now: () => now };
    deps.registry = filterRegistry(
      FILTER_IDS.map((id) =>
        id === "caps"
          ? stubFilter("caps", () => {
              now += 6;
              return { hit: false };
            })
          : stubFilter(id)
      )
    );
    await evaluateLine(moderationLine(), config({ caps: rule }), deps);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: "warn", metadata: { filter: "caps", elapsedMs: 6 } })
    );
  });
});

describe("filterRegistry", () => {
  test("refuses a filter registered twice", () => {
    expect(() => filterRegistry([...FILTER_IDS.map((id) => stubFilter(id)), stubFilter("caps")])).toThrow(
      'moderation filter "caps" is registered twice'
    );
  });

  test("refuses a registry missing a filter", () => {
    expect(() => filterRegistry(FILTER_IDS.filter((id) => id !== "links").map((id) => stubFilter(id)))).toThrow(
      "moderation filters missing from the registry: links"
    );
  });
});
