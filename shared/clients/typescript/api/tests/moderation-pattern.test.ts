import { describe, expect, test } from "bun:test";
import { MODERATION_LIMITS } from "../moderation-limits";
import { asWholeWord, matches, matchWithSteps, type Pattern, parsePattern } from "../moderation-pattern";

function compiled(raw: string): Pattern {
  const parsed = parsePattern(raw);
  if (!parsed.ok) {
    throw new Error(`${raw}: ${parsed.error}`);
  }
  return parsed.value;
}

describe("parsePattern", () => {
  const rows: Array<{ name: string; input: string; ok: boolean; error?: string }> = [
    { name: "a word", input: "badword", ok: true },
    { name: "a many wildcard", input: "bad*word", ok: true },
    { name: "a one wildcard", input: "b?d", ok: true },
    { name: "a class", input: "[ab]ad", ok: true },
    { name: "a negated range", input: "[^a-c]x", ok: true },
    { name: "word boundaries", input: "\\bfoo\\b", ok: true },
    { name: "an escaped star", input: "a\\*b", ok: true },
    { name: "a dot, which is literal", input: "a.b", ok: true },
    { name: "an escaped dot", input: "a\\.b", ok: true },
    { name: "an escaped digit", input: "ab\\1", ok: false, error: "\\1 is not an escape" },
    { name: "unicode", input: "café", ok: true },
    { name: "upper case, folded", input: "BADWORD", ok: true },
    { name: "an escaped regex character", input: "a\\(b", ok: true },
    { name: "empty", input: "", ok: false, error: "must not be empty" },
    { name: "a many wildcard alone", input: "*", ok: false, error: "needs at least 2" },
    { name: "wildcards only", input: "?*", ok: false, error: "needs at least 2" },
    { name: "one letter", input: "a", ok: false, error: "needs at least 2" },
    { name: "an unterminated class", input: "ab[", ok: false, error: "without its ]" },
    { name: "an empty class", input: "[]", ok: false, error: "empty []" },
    { name: "a reversed range", input: "[z-a]x", ok: false, error: "reversed range z-a" },
    { name: "an unknown escape", input: "foo\\q", ok: false, error: "\\q is not an escape" },
    {
      name: "a non-boundary escape, which lower case would turn into \\b",
      input: "\\Bfoo",
      ok: false,
      error: "\\B is not an escape",
    },
    { name: "an escaped backslash before a capital B", input: "a\\\\Bc", ok: true },
    { name: "a lone backslash at the end", input: "foo\\", ok: false, error: "lone \\" },
    { name: "a group with alternation", input: "(a|b)", ok: false, error: "escape it with \\" },
    { name: "a plus", input: "a+", ok: false, error: '"+" has no meaning here' },
    { name: "a counted repeat", input: "a{2}", ok: false, error: '"{" has no meaning here' },
    { name: "a start anchor", input: "^abc", ok: false, error: '"^" has no meaning here' },
    { name: "an end anchor", input: "abc$", ok: false, error: '"$" has no meaning here' },
    { name: "a stray ]", input: "ab]", ok: false, error: '"]" has no meaning here' },
    {
      name: "a pattern over the length limit",
      input: "a".repeat(MODERATION_LIMITS.maxPatternChars + 1),
      ok: false,
      error: "at most 100 characters",
    },
    { name: "a pattern at the length limit", input: "a".repeat(MODERATION_LIMITS.maxPatternChars), ok: true },
    {
      name: "a class of 21 items",
      input: `[${"abcdefghijklmnopqrstu"}]x`,
      ok: false,
      error: "more than 20 items",
    },
    { name: "a class of 20 items", input: `[${"abcdefghijklmnopqrst"}]x`, ok: true },
    { name: "a control character", input: "bad\u0007word", ok: false, error: "control characters" },
  ];
  for (const row of rows) {
    test(row.name, () => {
      const parsed = parsePattern(row.input);
      expect(parsed.ok).toBe(row.ok);
      if (!parsed.ok && row.error !== undefined) {
        expect(parsed.error).toContain(row.error);
      }
    });
  }

  test("folds case and NFKC before compiling", () => {
    expect(compiled("ＢＡＤ")).toEqual(compiled("bad"));
  });
});

describe("matches", () => {
  const rows: Array<[name: string, pattern: string, text: string, expected: boolean]> = [
    ["a literal inside a line", "badword", "you badword you", true],
    ["a literal inside a longer word", "bad", "badminton", true],
    ["a literal absent", "badword", "good words", false],
    ["many wildcard within a word", "f*k", "fork", true],
    ["many wildcard of zero characters", "f*k", "fk", true],
    ["many wildcard never crosses whitespace", "f*k", "f k", false],
    ["one wildcard is exactly one character", "b?d", "bad", true],
    ["one wildcard needs a character", "b?d", "bd", false],
    ["one wildcard is not whitespace", "b?d", "b d", false],
    ["a class", "[ab]ad", "bad", true],
    ["a class miss", "[ab]ad", "dad", false],
    ["a negated class", "[^a-c]x", "dx", true],
    ["a negated class miss", "[^a-c]x", "bx", false],
    ["a boundary hit", "\\bbad\\b", "so bad word", true],
    ["a boundary miss inside a word", "\\bbad\\b", "badword", false],
    ["a boundary at the text's edges", "\\bbad\\b", "bad", true],
    ["case folding", "badword", "BadWord", true],
    ["a zero-width joiner removed", "bad", "b‍ad", true],
    ["a zero-width space removed", "bad", "b​ad", true],
    ["fullwidth folded by NFKC", "bad", "ｂａｄ", true],
    ["an escaped star is literal", "a\\*b", "a*b", true],
    ["an escaped star is not a wildcard", "a\\*b", "axb", false],
    ["a dot is literal", "a.b", "axb", false],
    ["an escaped dot is a dot", "a\\.b", "a.b", true],
    ["unicode", "café", "CAFÉ au lait", true],
  ];
  for (const [name, pattern, text, expected] of rows) {
    test(name, () => {
      expect(matches(compiled(pattern), text)).toBe(expected);
    });
  }

  test("a whole-word pattern needs boundaries on both sides", () => {
    const pattern = asWholeWord(compiled("bad"));
    expect(matches(pattern, "that is bad.")).toBe(true);
    expect(matches(pattern, "badminton")).toBe(false);
  });

  test("scans only the first maxScanChars characters", () => {
    const pattern = compiled("needle");
    expect(matches(pattern, `${"x".repeat(MODERATION_LIMITS.maxScanChars - 6)}needle`)).toBe(true);
    expect(matches(pattern, `${"x".repeat(MODERATION_LIMITS.maxScanChars)}needle`)).toBe(false);
  });

  // A backtracking matcher takes exponential time here; the NFA does at most
  // two steps per pattern position per character.
  test("an adversarial pattern stays within its step bound", () => {
    const pattern = compiled("a*a*a*a*a*b");
    const text = "a".repeat(1_000);
    const run = matchWithSteps(pattern, text);
    expect(run.matched).toBe(false);
    const bound = 2 * pattern.items.length * (text.length + 1);
    expect(run.steps).toBeLessThanOrEqual(bound);
    expect(run.steps).toBe(matchWithSteps(pattern, text).steps);
  });

  test("the largest pattern against the longest line stays within its step bound", () => {
    const pattern = compiled(`${"a*".repeat(49)}ab`);
    const run = matchWithSteps(pattern, "a".repeat(MODERATION_LIMITS.maxScanChars * 2));
    expect(run.steps).toBeLessThanOrEqual(2 * pattern.items.length * (MODERATION_LIMITS.maxScanChars + 1));
  });
});
