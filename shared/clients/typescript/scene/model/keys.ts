// Order keys: strings that sort as text, with room between any two.
//
// A widget's stacking (`PlacementDocument.z`) and a behavior's order among
// its siblings (`BehaviorDocument.order`) are keys rather than indexes, so
// moving one entry replaces one value instead of renumbering every sibling.
// Two editors moving different entries at once touch different json0 paths
// and never conflict.
//
// A key is read as the digits of a base-36 fraction after the point, written
// with `0-9a-z`, which sort as text in that order. Any two distinct keys a < b
// have a key between them, except when b is a followed only by `0`s: nothing
// sorts between "a" and "a0". Keys made here never end in `0`, so that gap is
// never created. Keys documents already hold (see `zKey` in the sync layer:
// "a" and four base-36 digits) may end in `0`, and still order correctly
// against every key made here, because none of them is a prefix of another.

import { assert } from "./composition";
import type { CompositionDocument, NodeId } from "./types";

/** The digits keys are written in, lowest first. Their character codes ascend, so text order is digit order. */
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
/** A first key, for an empty collection: the middle digit leaves equal room above and below. */
const FIRST_KEY = DIGITS[BASE / 2] as string;

/**
 * Longest key an editor lets a collection grow to before it renumbers it.
 * The sync layer refuses a `z` longer than 64; renumbering well before that
 * keeps every key valid after any number of moves.
 */
export const MAX_KEY_LENGTH = 32;

/**
 * Whether `key` is a well-formed order key: digits only. A key ending in `0`
 * is accepted, since documents hold such keys, though none is made here.
 */
export function isOrderKey(key: string): boolean {
  if (key.length === 0) {
    return false;
  }
  for (const char of key) {
    if (!DIGITS.includes(char)) {
      return false;
    }
  }
  return true;
}

function digitOf(key: string, index: number): number {
  const value = DIGITS.indexOf(key[index] as string);
  assert(value >= 0, `order key "${key}" holds a character that is not a digit`);
  return value;
}

function charOf(digit: number): string {
  assert(digit >= 0 && digit < BASE, `digit ${digit} is out of range`);
  return DIGITS[digit] as string;
}

/**
 * A key that sorts strictly between `a` and `b`; null stands for the start
 * or end of the collection. Throws when `a` does not sort before `b`, or when
 * nothing fits between them (`b` is `a` followed only by `0`s).
 *
 * Next to an open end the key moves by one digit rather than halving the
 * gap: appending to the top of a stack is the common move, and stepping by
 * one adds a digit only every 34 appends.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) {
    assert(isOrderKey(a), `"${a}" is not an order key`);
  }
  if (b !== null) {
    assert(isOrderKey(b), `"${b}" is not an order key`);
  }
  if (a !== null && b !== null) {
    assert(a < b, `order key "${a}" must sort before "${b}"`);
  }
  const lower = a ?? "";
  if (b === null) {
    return lower.length === 0 ? FIRST_KEY : keyAbove(lower);
  }
  let prefix = "";
  for (let i = 0; ; i++) {
    assert(i < b.length, `no order key fits between "${lower}" and "${b}"`);
    const upper = digitOf(b, i);
    if (i >= lower.length) {
      return prefix + keyBelowFrom(b.slice(i), upper);
    }
    const low = digitOf(lower, i);
    if (low === upper) {
      prefix += charOf(low);
      continue;
    }
    if (upper - low >= 2) {
      return prefix + charOf(Math.floor((low + upper) / 2));
    }
    // Adjacent digits: keep `lower`'s digit and go above the rest of `lower`,
    // which stays below `b` because this digit already is.
    return prefix + charOf(low) + keyAbove(lower.slice(i + 1));
  }
}

/** A key above `key` with nothing bounding it from above. */
function keyAbove(key: string): string {
  let prefix = "";
  for (let i = 0; i < key.length; i++) {
    const digit = digitOf(key, i);
    if (digit < BASE - 1) {
      return prefix + charOf(digit + 1);
    }
    prefix += charOf(digit);
  }
  // Past a run of `z`s the next digit starts low, so the following appends
  // count up through it one step at a time before another digit is needed.
  return prefix.length === 0 ? FIRST_KEY : prefix + charOf(1);
}

/**
 * A non-empty key below `upper`, whose first digit is `first`, and above
 * the empty key. Never ends in `0`: a key ending in `0` would leave no room
 * below it for the next insert at the front.
 */
function keyBelowFrom(upper: string, first: number): string {
  assert(first >= 0, "no order key fits below a key made only of 0s");
  if (first >= 2) {
    return charOf(first - 1);
  }
  if (first === 1) {
    // The mirror of `keyAbove`: start high, so the next inserts at the front count down through it.
    return charOf(0) + charOf(BASE - 1);
  }
  return charOf(0) + keyBelowFrom(upper.slice(1), upper.length > 1 ? digitOf(upper, 1) : -1);
}

/**
 * `n` keys in ascending order, all strictly between `a` and `b` (null for
 * an open end). Between two bounds the keys split the gap evenly, so each
 * stays short; above an open end they count up one step at a time.
 */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  assert(Number.isSafeInteger(n) && n >= 0, "a key count is a whole number");
  if (n === 0) {
    return [];
  }
  if (b === null) {
    const keys: string[] = [];
    let previous = a;
    for (let i = 0; i < n; i++) {
      previous = keyBetween(previous, null);
      keys.push(previous);
    }
    return keys;
  }
  if (a === null) {
    const keys: string[] = [];
    let next: string = b;
    for (let i = 0; i < n; i++) {
      next = keyBetween(null, next);
      keys.push(next);
    }
    return keys.reverse();
  }
  const middleIndex = Math.floor(n / 2);
  const middle = keyBetween(a, b);
  return [...keysBetween(a, middle, middleIndex), middle, ...keysBetween(middle, b, n - middleIndex - 1)];
}

/**
 * Evenly spaced keys for `n` entries, in the form `zKey` writes: "a" and four
 * base-36 digits. Used to renumber a collection whose keys grew long or
 * collided; the form matches what documents already hold.
 */
export function evenKeys(n: number): string[] {
  assert(Number.isSafeInteger(n) && n >= 0 && n <= BASE ** 4, "too many entries to number");
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    // Keys count from one: "a0000" ends in `0`, and nothing could be put below it.
    keys.push(`a${(i + 1).toString(BASE).padStart(4, "0")}`);
  }
  return keys;
}

/** Compares two keyed entries as stacks and lists order them: by key, then by id so ties are stable everywhere. */
export function compareKeyed(a: { id: string; key: string }, b: { id: string; key: string }): number {
  if (a.key !== b.key) {
    return a.key < b.key ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
}

/** The ids of `entries` in key order, lowest first. `keyOf` reads an entry's key. */
export function orderByKey<T>(entries: Readonly<Record<string, T>>, keyOf: (entry: T) => string): string[] {
  return Object.entries(entries)
    .map(([id, entry]) => ({ id, key: keyOf(entry) }))
    .sort(compareKeyed)
    .map(({ id }) => id);
}

/** A composition's placement ids, bottom of the stack first. */
export function stackOrder(doc: Pick<CompositionDocument, "widgets">): NodeId[] {
  return orderByKey(doc.widgets, (placement) => placement.z);
}

/**
 * The key that puts an entry at `index` among `ordered`, the keys of the
 * other entries in order (the moved entry left out). Null when the
 * neighbours at that index leave no room (equal keys, or keys that are not
 * order keys): the caller renumbers instead.
 */
export function keyAt(ordered: readonly string[], index: number): string | null {
  assert(Number.isSafeInteger(index) && index >= 0 && index <= ordered.length, "an insert index is within the list");
  const below = index > 0 ? (ordered[index - 1] as string) : null;
  const above = index < ordered.length ? (ordered[index] as string) : null;
  if ((below !== null && !isOrderKey(below)) || (above !== null && !isOrderKey(above))) {
    return null;
  }
  if (below !== null && above !== null && below >= above) {
    return null;
  }
  try {
    const key = keyBetween(below, above);
    return key.length <= MAX_KEY_LENGTH ? key : null;
  } catch {
    return null;
  }
}
