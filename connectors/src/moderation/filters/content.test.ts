import { describe, expect, test } from "bun:test";
import {
  type BannedPhrasesParams,
  DEFAULT_CAPS_PARAMS,
  DEFAULT_REPETITION_PARAMS,
  DEFAULT_SYMBOLS_PARAMS,
} from "@woofx3/api/moderation-config";
import { MemoryChatterHistory } from "../history";
import { filterEnv, moderationLine, PLATFORM } from "../testing";
import type { FilterEnv, ModerationFilter, ModerationLine } from "../types";
import { bannedPhrasesFilter, capsFilter, repetitionFilter, symbolsFilter } from "./content";

async function hits<P>(
  filter: ModerationFilter<P>,
  params: P,
  line: Partial<ModerationLine>,
  env: FilterEnv = filterEnv()
): Promise<boolean> {
  return (await filter.evaluate(moderationLine(line), params, env)).hit;
}

describe("capsFilter", () => {
  const params = { minLength: 10, maxPercent: 70 };
  const rows: Array<[name: string, text: string, hit: boolean]> = [
    ["shouting", "WHY IS NOBODY LISTENING", true],
    ["a short shout under minLength", "LOL", false],
    ["at exactly maxPercent", "AAAAAAAbbb", false],
    ["just above maxPercent", "AAAAAAAAbb", true],
    ["ordinary chat", "hello there everyone, how is it going", false],
    ["digits and punctuation do not count as letters", "OK!!! 1234567890 ?????", false],
    ["an @mention in caps is a name", "@SOMEBODY_IN_CAPS hello there friend", false],
    ["unicode capitals", "ÄÖÜ ÉÈÊ ÇÑ ПРИВЕТ МИР", true],
    ["unicode lower case", "äöü éèê çñ привет мир", false],
    ["emoji only", "😀😀😀😀😀😀😀😀😀😀😀😀", false],
  ];
  for (const [name, text, hit] of rows) {
    test(name, async () => {
      expect(await hits(capsFilter, params, { text })).toBe(hit);
    });
  }

  test("a paid line is exempt", async () => {
    expect(await hits(capsFilter, params, { text: "CHEER100 WHY IS NOBODY LISTENING", paid: true })).toBe(false);
  });

  test("the default params leave a short shout alone", async () => {
    expect(await hits(capsFilter, DEFAULT_CAPS_PARAMS, { text: "GG WP" })).toBe(false);
  });
});

describe("symbolsFilter", () => {
  const params = { minLength: 10, maxPercent: 50 };
  const rows: Array<[name: string, text: string, hit: boolean]> = [
    ["symbol spam", "$$$$ %%%% #### !!!!", true],
    ["a short burst under minLength", "!!!", false],
    ["ordinary punctuation", "hello, how are you doing today?", false],
    ["at exactly maxPercent", "abcde!!!!!", false],
    ["just above maxPercent", "abcd!!!!!!", true],
    ["emoji are not symbols", "😀😀😀😀😀😀😀😀😀😀😀😀 hi", false],
    ["box drawing", "╔══════════╗ ║ ╚══════════╝", true],
  ];
  for (const [name, text, hit] of rows) {
    test(name, async () => {
      expect(await hits(symbolsFilter, params, { text })).toBe(hit);
    });
  }

  test("a paid line is exempt", async () => {
    expect(await hits(symbolsFilter, DEFAULT_SYMBOLS_PARAMS, { text: "$$$$ %%%% #### !!!! ^^^^", paid: true })).toBe(
      false
    );
  });
});

describe("repetitionFilter", () => {
  function setup() {
    let now = 0;
    const clock = { now: () => now };
    const history = new MemoryChatterHistory({ chatters: 10, linesPerChatter: 20, retainMs: 600_000 }, clock);
    return { env: filterEnv({ clock, history }), advance: (ms: number) => (now += ms) };
  }
  const params = { windowSeconds: 30, maxRepeats: 2, minLength: 5 };

  test("trips on the line after maxRepeats, ignoring case and spacing", async () => {
    const { env } = setup();
    expect(await hits(repetitionFilter, params, { text: "buy followers" }, env)).toBe(false);
    expect(await hits(repetitionFilter, params, { text: "BUY  followers " }, env)).toBe(false);
    expect(await hits(repetitionFilter, params, { text: "buy followers" }, env)).toBe(true);
  });

  test("forgets lines older than the window", async () => {
    const { env, advance } = setup();
    await hits(repetitionFilter, params, { text: "buy followers" }, env);
    await hits(repetitionFilter, params, { text: "buy followers" }, env);
    advance(30_000);
    expect(await hits(repetitionFilter, params, { text: "buy followers" }, env)).toBe(false);
  });

  test("counts per chatter", async () => {
    const { env } = setup();
    for (const id of ["a", "b", "c"]) {
      const viewer = { platform: PLATFORM, platformUserId: id };
      expect(await hits(repetitionFilter, params, { text: "buy followers", viewer }, env)).toBe(false);
    }
  });

  test("never counts a line shorter than minLength", async () => {
    const { env } = setup();
    for (let i = 0; i < 5; i++) {
      expect(await hits(repetitionFilter, params, { text: "gg" }, env)).toBe(false);
    }
  });

  test("the defaults allow three of the same line", async () => {
    const { env } = setup();
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(await hits(repetitionFilter, DEFAULT_REPETITION_PARAMS, { text: "hype hype" }, env));
    }
    expect(results).toEqual([false, false, false, true]);
  });
});

describe("MemoryChatterHistory", () => {
  test("keeps at most linesPerChatter lines, and at most its chatters", () => {
    const clock = { now: () => 0 };
    const history = new MemoryChatterHistory({ chatters: 1, linesPerChatter: 2, retainMs: 60_000 }, clock);
    const a = { platform: PLATFORM, platformUserId: "a" };
    history.repeats(a, "x", 60_000);
    history.repeats(a, "x", 60_000);
    expect(history.repeats(a, "x", 60_000)).toBe(3);
    expect(history.repeats(a, "x", 60_000)).toBe(3);
    history.repeats({ platform: PLATFORM, platformUserId: "b" }, "x", 60_000);
    expect(history.repeats(a, "x", 60_000)).toBe(1);
  });
});

describe("bannedPhrasesFilter", () => {
  const params: BannedPhrasesParams = {
    phrases: [
      { pattern: "f*k", wholeWord: true },
      { pattern: "spam", wholeWord: false },
    ],
  };
  const rows: Array<[name: string, text: string, hit: boolean]> = [
    ["a whole-word pattern", "what the fork", true],
    ["a whole-word pattern inside a longer word", "forklift", false],
    ["a substring pattern inside a word", "nospamplease", true],
    ["case and fullwidth folded", "ＳＰＡＭ", true],
    ["a zero-width character inside a word", "sp​am", true],
    ["clean chat", "hello friends", false],
  ];
  for (const [name, text, hit] of rows) {
    test(name, async () => {
      expect(await hits(bannedPhrasesFilter, params, { text })).toBe(hit);
    });
  }

  test("its reason never names the phrase", async () => {
    const verdict = await bannedPhrasesFilter.evaluate(moderationLine({ text: "spam" }), params, filterEnv());
    expect(verdict).toEqual({ hit: true, reason: "used a banned phrase" });
  });

  test("no phrases never hits", async () => {
    expect(await hits(bannedPhrasesFilter, { phrases: [] }, { text: "anything" })).toBe(false);
  });
});
