import {
  type BannedPhrasesParams,
  compilePhrases,
  parseBannedPhrasesParams,
  parseRepetitionParams,
  parseShareParams,
  type RepetitionParams,
  type ShareParams,
} from "@woofx3/api/moderation-config";
import { matches, normaliseForMatching, type Pattern } from "@woofx3/api/moderation-pattern";
import type { FilterVerdict, ModerationFilter, ModerationLine } from "../types";

const MISS: FilterVerdict = { hit: false };
const MENTION = /^@\S+$/u;
const CASED_LETTER = /[\p{Lu}\p{Ll}\p{Lt}]/u;
const UPPER = /[\p{Lu}\p{Lt}]/u;
const SYMBOL = /[\p{P}\p{S}]/u;
/** Emoji are how chat talks, not symbol spam. */
const EMOJI = /\p{Extended_Pictographic}/u;
const WHITESPACE = /\s/u;

/** The line's words other than @mentions, which are names and not shouting. */
function wordsWithoutMentions(text: string): string[] {
  return text.split(/\s+/u).filter((word) => word !== "" && !MENTION.test(word));
}

/** The percentage of `counted` characters that `selected`, or null below `minLength` counted characters. */
function share(chars: readonly string[], counted: RegExp, selected: RegExp, minLength: number): number | null {
  const pool = chars.filter((char) => counted.test(char));
  if (pool.length < minLength) {
    return null;
  }
  return (pool.filter((char) => selected.test(char)).length * 100) / pool.length;
}

export const capsFilter: ModerationFilter<ShareParams> = {
  id: "caps",
  parseParams: parseShareParams,
  evaluate(line: ModerationLine, params: ShareParams): FilterVerdict {
    if (line.paid) {
      return MISS;
    }
    const chars = [...wordsWithoutMentions(line.text).join("")];
    const percent = share(chars, CASED_LETTER, UPPER, params.minLength);
    return percent !== null && percent > params.maxPercent ? { hit: true, reason: "too many capital letters" } : MISS;
  },
};

export const symbolsFilter: ModerationFilter<ShareParams> = {
  id: "symbols",
  parseParams: parseShareParams,
  evaluate(line: ModerationLine, params: ShareParams): FilterVerdict {
    if (line.paid) {
      return MISS;
    }
    const chars = [...wordsWithoutMentions(line.text).join("")].filter(
      (char) => !WHITESPACE.test(char) && !EMOJI.test(char)
    );
    const percent = share(chars, /./su, SYMBOL, params.minLength);
    return percent !== null && percent > params.maxPercent ? { hit: true, reason: "too many symbols" } : MISS;
  },
};

export const repetitionFilter: ModerationFilter<RepetitionParams> = {
  id: "repetition",
  parseParams: parseRepetitionParams,
  evaluate(line: ModerationLine, params: RepetitionParams, env): FilterVerdict {
    const text = normaliseForMatching(line.text).replace(/\s+/gu, " ").trim();
    if ([...text].length < params.minLength) {
      return MISS;
    }
    const repeats = env.history.repeats(line.viewer, text, params.windowSeconds * 1_000);
    return repeats > params.maxRepeats ? { hit: true, reason: "repeated the same message" } : MISS;
  },
};

/** Compiled once per params object: a config's params never change after parsing. */
const compiledPhrases = new WeakMap<BannedPhrasesParams, Pattern[]>();

export const bannedPhrasesFilter: ModerationFilter<BannedPhrasesParams> = {
  id: "banned_phrases",
  parseParams: parseBannedPhrasesParams,
  evaluate(line: ModerationLine, params: BannedPhrasesParams): FilterVerdict {
    let patterns = compiledPhrases.get(params);
    if (patterns === undefined) {
      patterns = compilePhrases(params);
      compiledPhrases.set(params, patterns);
    }
    // The reason never names the phrase: the list is the streamer's, and the action event is visible.
    return patterns.some((pattern) => matches(pattern, line.text))
      ? { hit: true, reason: "used a banned phrase" }
      : MISS;
  },
};
