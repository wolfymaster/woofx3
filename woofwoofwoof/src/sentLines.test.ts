import { describe, expect, test } from "bun:test";
import { guardOutgoingLine, normalizeChatLine, SentLineRegistry } from "./sentLines";

function fakeClock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("guardOutgoingLine", () => {
  const cases: [name: string, input: string, expected: string][] = [
    ["a line that would run a command gets a zero-width space first", "!title pwned", "​!title pwned"],
    ["a plain line is said as is", "hello chat", "hello chat"],
    ["a prefix later in the line is left alone", "type !hug to hug", "type !hug to hug"],
    ["an action line is said as is", "/me waves", "/me waves"],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(guardOutgoingLine(input)).toBe(expected);
    });
  }
});

describe("normalizeChatLine", () => {
  const cases: [name: string, input: string, expected: string][] = [
    ["trims", "  hi  ", "hi"],
    ["collapses inner whitespace", "a \t  b\n c", "a b c"],
    ["drops zero-width spaces", "​!title x", "!title x"],
    ["drops the action command", "/me *poof* @x is gone", "*poof* @x is gone"],
    ["keeps a slash that is not the action command", "/meow", "/meow"],
    ["empty stays empty", "   ", ""],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(normalizeChatLine(input)).toBe(expected);
    });
  }
});

describe("SentLineRegistry", () => {
  test("claims a recorded line once", () => {
    const clock = fakeClock();
    const lines = new SentLineRegistry({ capacity: 4, ttlMs: 1_000 }, clock.now);
    lines.record("​!title  pwned");

    expect(lines.consume("!title pwned")).toBe(true);
    expect(lines.consume("!title pwned")).toBe(false);
  });

  test("answers once per time the line was said", () => {
    const lines = new SentLineRegistry({ capacity: 4, ttlMs: 1_000 }, fakeClock().now);
    lines.record("gg");
    lines.record("gg");

    expect(lines.consume("gg")).toBe(true);
    expect(lines.consume("gg")).toBe(true);
    expect(lines.consume("gg")).toBe(false);
  });

  test("does not claim a line it never recorded", () => {
    const lines = new SentLineRegistry({ capacity: 4, ttlMs: 1_000 }, fakeClock().now);
    lines.record("hello");

    expect(lines.consume("!title mine")).toBe(false);
    expect(lines.consume("hello")).toBe(true);
  });

  test("forgets a line once its ttl has passed", () => {
    const clock = fakeClock();
    const lines = new SentLineRegistry({ capacity: 4, ttlMs: 1_000 }, clock.now);
    lines.record("first");
    clock.advance(999);
    lines.record("second");
    clock.advance(1);

    expect(lines.consume("first")).toBe(false);
    expect(lines.consume("second")).toBe(true);
  });

  test("holds at most capacity lines, forgetting the oldest", () => {
    const lines = new SentLineRegistry({ capacity: 2, ttlMs: 1_000 }, fakeClock().now);
    lines.record("one");
    lines.record("two");
    lines.record("three");

    expect(lines.consume("one")).toBe(false);
    expect(lines.consume("two")).toBe(true);
    expect(lines.consume("three")).toBe(true);
  });

  test("records nothing for a blank line", () => {
    const lines = new SentLineRegistry({ capacity: 1, ttlMs: 1_000 }, fakeClock().now);
    lines.record("kept");
    lines.record("   ");

    expect(lines.consume("kept")).toBe(true);
  });

  test("refuses a capacity or ttl that cannot work", () => {
    const now = fakeClock().now;
    expect(() => new SentLineRegistry({ capacity: 0, ttlMs: 1_000 }, now)).toThrow(/capacity/);
    expect(() => new SentLineRegistry({ capacity: 1.5, ttlMs: 1_000 }, now)).toThrow(/capacity/);
    expect(() => new SentLineRegistry({ capacity: 1, ttlMs: 0 }, now)).toThrow(/ttlMs/);
  });
});
