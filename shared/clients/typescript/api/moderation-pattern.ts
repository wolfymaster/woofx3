import { MODERATION_LIMITS, type ModerationParseResult } from "./moderation-limits";

/**
 * Banned-phrase patterns: a small grammar compiled here, never a regular
 * expression, so no pattern can make matching slow.
 *
 *   pattern = item+
 *   item    = literal | "?" | "*" | class | "\b"
 *   literal = any character but  ? * [ ] \ ( ) | + { } ^ $,  or "\" before any
 *             character that is not a letter or digit
 *   "?"     = exactly one character that is not whitespace
 *   "*"     = zero or more characters that are not whitespace
 *   class   = "[" "^"? (char | char "-" char)+ "]"
 *   "\b"    = a word boundary: between a letter, digit or underscore and anything else, or the text's edge
 *
 * There are no groups, alternation, other quantifiers, backreferences,
 * lookaround or anchors. `( ) | + { } ^ $` are refused rather than read as
 * literals: whoever types them means a regular expression. A pattern
 * compiles to a flat list of items and matches by advancing a set of
 * positions once per character of text (a Thompson-style NFA), so the cost is
 * at most text length times pattern length, whatever the input.
 *
 * Pattern and text are both normalised first: Unicode NFKC, lower case, and
 * format characters such as zero-width spaces removed.
 */
export type PatternItem =
  | { kind: "literal"; char: string }
  | { kind: "one" }
  | { kind: "many" }
  | { kind: "class"; negated: boolean; ranges: Array<[from: string, to: string]> }
  | { kind: "boundary" };

export interface Pattern {
  items: PatternItem[];
}

/** Characters with a meaning in the grammar; a class takes them literally after `\`. */
const SPECIAL = new Set(["?", "*", "[", "]", "\\", "(", ")", "|", "+", "{", "}", "^", "$"]);
/** Regular-expression syntax the grammar does not have. */
const REGEX_ONLY = new Set(["(", ")", "|", "+", "{", "}", "^", "$"]);
const CONTROL = /\p{Cc}/u;
const FORMAT = /\p{Cf}/gu;
const WHITESPACE = /\s/u;
const WORD = /[\p{L}\p{N}_]/u;
/** An escape is \b, or a symbol taken literally; any other letter or digit is a mistake. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** How both a pattern and the text it is matched against are compared. */
export function normaliseForMatching(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(FORMAT, "");
}

function failed(error: string): ModerationParseResult<Pattern> {
  return { ok: false, error };
}

export function parsePattern(raw: string): ModerationParseResult<Pattern> {
  if (CONTROL.test(raw)) {
    return failed("must not contain control characters");
  }
  if ([...raw].length > MODERATION_LIMITS.maxPatternChars) {
    return failed(`must be at most ${MODERATION_LIMITS.maxPatternChars} characters`);
  }
  const chars = [...normaliseForMatching(raw)];
  if (chars.length === 0) {
    return failed("must not be empty");
  }
  const items: PatternItem[] = [];
  let index = 0;
  while (index < chars.length) {
    const char = chars[index] as string;
    index++;
    if (char === "\\") {
      const escaped = chars[index];
      index++;
      if (escaped === "b") {
        items.push({ kind: "boundary" });
      } else if (escaped !== undefined && !LETTER_OR_DIGIT.test(escaped)) {
        items.push({ kind: "literal", char: escaped });
      } else {
        return failed(
          escaped === undefined
            ? "ends with a lone \\"
            : `\\${escaped} is not an escape; only \\b, or \\ before a symbol, means something`
        );
      }
    } else if (char === "?") {
      items.push({ kind: "one" });
    } else if (char === "*") {
      items.push({ kind: "many" });
    } else if (char === "[") {
      const parsedClass = readClass(chars, index);
      if (!parsedClass.ok) {
        return parsedClass;
      }
      items.push(parsedClass.value.item);
      index = parsedClass.value.next;
    } else if (REGEX_ONLY.has(char) || char === "]") {
      return failed(`"${char}" has no meaning here; escape it with \\ to match it literally`);
    } else {
      items.push({ kind: "literal", char });
    }
  }
  const literals = items.filter((item) => item.kind === "literal" || item.kind === "class").length;
  if (literals < MODERATION_LIMITS.minPatternLiterals) {
    return failed(
      `needs at least ${MODERATION_LIMITS.minPatternLiterals} letters or [classes], so it never matches nearly everything`
    );
  }
  return { ok: true, value: { items } };
}

/** A class starting after its `[`: the item and the index after its `]`. */
function readClass(
  chars: readonly string[],
  start: number
): ModerationParseResult<{ item: PatternItem; next: number }> {
  let index = start;
  const negated = chars[index] === "^";
  if (negated) {
    index++;
  }
  const ranges: Array<[string, string]> = [];
  const readChar = (): string | undefined => {
    const char = chars[index];
    if (char === "\\" && chars[index + 1] !== undefined && SPECIAL.has(chars[index + 1] as string)) {
      index += 2;
      return chars[index - 1];
    }
    index++;
    return char;
  };
  while (chars[index] !== "]") {
    if (chars[index] === undefined) {
      return { ok: false, error: "has a [ without its ]" };
    }
    const from = readChar() as string;
    let to = from;
    if (chars[index] === "-" && chars[index + 1] !== undefined && chars[index + 1] !== "]") {
      index++;
      to = readChar() as string;
      if ((from.codePointAt(0) as number) > (to.codePointAt(0) as number)) {
        return { ok: false, error: `has a reversed range ${from}-${to}` };
      }
    }
    ranges.push([from, to]);
    if (ranges.length > MODERATION_LIMITS.maxClassItems) {
      return { ok: false, error: `has a [class] of more than ${MODERATION_LIMITS.maxClassItems} items` };
    }
  }
  if (ranges.length === 0) {
    return { ok: false, error: "has an empty []" };
  }
  return { ok: true, value: { item: { kind: "class", negated, ranges }, next: index + 1 } };
}

/** `pattern` matching only as a whole word. */
export function asWholeWord(pattern: Pattern): Pattern {
  return { items: [{ kind: "boundary" }, ...pattern.items, { kind: "boundary" }] };
}

export interface MatchResult {
  matched: boolean;
  /** NFA work done: one per pattern position looked at, per character. Deterministic, for tests. */
  steps: number;
}

/** Whether `pattern` occurs anywhere in `text`, scanning its first MODERATION_LIMITS.maxScanChars characters. */
export function matches(pattern: Pattern, text: string): boolean {
  return matchWithSteps(pattern, text).matched;
}

export function matchWithSteps(pattern: Pattern, text: string): MatchResult {
  const chars = [...normaliseForMatching(text)].slice(0, MODERATION_LIMITS.maxScanChars);
  const items = pattern.items;
  const accept = items.length;
  let steps = 0;
  let current = new Uint8Array(accept + 1);
  for (let position = 0; ; position++) {
    // A match may start at any character.
    current[0] = 1;
    // Epsilon moves only go forward, so one ascending pass closes the set.
    for (let state = 0; state < accept; state++) {
      steps++;
      if (current[state] !== 1) {
        continue;
      }
      const item = items[state] as PatternItem;
      if (item.kind === "many" || (item.kind === "boundary" && isBoundary(chars, position))) {
        current[state + 1] = 1;
      }
    }
    if (current[accept] === 1) {
      return { matched: true, steps };
    }
    const char = chars[position];
    if (char === undefined) {
      return { matched: false, steps };
    }
    const next = new Uint8Array(accept + 1);
    for (let state = 0; state < accept; state++) {
      if (current[state] !== 1) {
        continue;
      }
      steps++;
      const item = items[state] as PatternItem;
      if (item.kind === "many") {
        if (!WHITESPACE.test(char)) {
          next[state] = 1;
        }
      } else if (consumes(item, char)) {
        next[state + 1] = 1;
      }
    }
    current = next;
  }
}

function consumes(item: PatternItem, char: string): boolean {
  switch (item.kind) {
    case "literal": {
      return item.char === char;
    }
    case "one": {
      return !WHITESPACE.test(char);
    }
    case "class": {
      const point = char.codePointAt(0) as number;
      const inClass = item.ranges.some(
        ([from, to]) => point >= (from.codePointAt(0) as number) && point <= (to.codePointAt(0) as number)
      );
      return inClass !== item.negated;
    }
    case "many":
    case "boundary": {
      return false;
    }
  }
}

function isBoundary(chars: readonly string[], position: number): boolean {
  const before = chars[position - 1];
  const after = chars[position];
  const wordBefore = before !== undefined && WORD.test(before);
  const wordAfter = after !== undefined && WORD.test(after);
  return wordBefore !== wordAfter;
}
