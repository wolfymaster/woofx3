import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BANNED_PHRASES_PARAMS,
  DEFAULT_CAPS_PARAMS,
  DEFAULT_REPETITION_PARAMS,
  DEFAULT_SYMBOLS_PARAMS,
  MODERATION_LIMITS,
  type ModerationParseResult,
  parseBannedPhrasesParams,
  parseRepetitionParams,
  parseShareParams,
} from "../moderation-config";

function errorOf(result: ModerationParseResult<unknown>): string {
  return result.ok ? "" : result.error;
}

describe("defaults parse as themselves", () => {
  test("caps, symbols, repetition and banned phrases", () => {
    expect(parseShareParams(DEFAULT_CAPS_PARAMS)).toEqual({ ok: true, value: DEFAULT_CAPS_PARAMS });
    expect(parseShareParams(DEFAULT_SYMBOLS_PARAMS)).toEqual({ ok: true, value: DEFAULT_SYMBOLS_PARAMS });
    expect(parseRepetitionParams(DEFAULT_REPETITION_PARAMS)).toEqual({ ok: true, value: DEFAULT_REPETITION_PARAMS });
    expect(parseBannedPhrasesParams(DEFAULT_BANNED_PHRASES_PARAMS)).toEqual({
      ok: true,
      value: DEFAULT_BANNED_PHRASES_PARAMS,
    });
  });
});

describe("parseShareParams", () => {
  const invalid: Array<[name: string, raw: unknown, error: string]> = [
    ["a missing field", { minLength: 5 }, "maxPercent is required"],
    ["an unknown field", { minLength: 5, maxPercent: 50, extra: true }, 'unknown field "extra"'],
    ["a zero minLength", { minLength: 0, maxPercent: 50 }, "minLength must be a whole number from 1"],
    ["a 100 percent threshold, which never trips", { minLength: 5, maxPercent: 100 }, "maxPercent must be"],
    ["a text threshold", { minLength: "5", maxPercent: 50 }, "minLength must be"],
  ];
  for (const [name, raw, error] of invalid) {
    test(`refuses ${name}`, () => {
      expect(errorOf(parseShareParams(raw))).toContain(error);
    });
  }
});

describe("parseRepetitionParams", () => {
  const invalid: Array<[name: string, raw: unknown, error: string]> = [
    ["a window over its limit", { ...DEFAULT_REPETITION_PARAMS, windowSeconds: 601 }, "windowSeconds must be"],
    ["no repeats allowed", { ...DEFAULT_REPETITION_PARAMS, maxRepeats: 0 }, "maxRepeats must be"],
    ["a fractional minLength", { ...DEFAULT_REPETITION_PARAMS, minLength: 2.5 }, "minLength must be"],
  ];
  for (const [name, raw, error] of invalid) {
    test(`refuses ${name}`, () => {
      expect(errorOf(parseRepetitionParams(raw))).toContain(error);
    });
  }
});

describe("parseBannedPhrasesParams", () => {
  test("keeps each phrase as written", () => {
    const raw = { phrases: [{ pattern: "Bad*Word", wholeWord: true }] };
    expect(parseBannedPhrasesParams(raw)).toEqual({ ok: true, value: raw });
  });

  const phrase = (pattern: string) => ({ pattern, wholeWord: false });
  const invalid: Array<[name: string, raw: unknown, error: string]> = [
    [
      "more phrases than maxPhrases",
      { phrases: Array.from({ length: MODERATION_LIMITS.maxPhrases + 1 }, (_, i) => phrase(`word${i}`)) },
      "at most 200",
    ],
    [
      "phrases over maxTotalPatternChars",
      { phrases: Array.from({ length: 41 }, (_, i) => phrase(`${i}`.padEnd(100, "x"))) },
      "more than 4000 characters",
    ],
    ["a bad pattern, by its position", { phrases: [phrase("fine"), phrase("(a|b)")] }, "phrases[1]"],
    ["a phrase without wholeWord", { phrases: [{ pattern: "fine" }] }, "phrases[0]: wholeWord is required"],
    ["a phrase that is not text", { phrases: [{ pattern: 3, wholeWord: false }] }, "phrases[0] must be"],
    ["phrases that are not a list", { phrases: "bad" }, "phrases must be a list"],
  ];
  for (const [name, raw, error] of invalid) {
    test(`refuses ${name}`, () => {
      expect(errorOf(parseBannedPhrasesParams(raw))).toContain(error);
    });
  }

  test("accepts exactly maxTotalPatternChars", () => {
    const raw = { phrases: Array.from({ length: 40 }, (_, i) => phrase(`${i}`.padEnd(100, "x"))) };
    expect(parseBannedPhrasesParams(raw).ok).toBe(true);
  });
});
