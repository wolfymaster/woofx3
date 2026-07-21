// Parses "{variable}" placeholders out of a command's declared
// `argumentPattern` (e.g. "{songTitle}" or "{userA} {userB}") and extracts
// their values from the remainder of a chat message. Shared by the api
// service (validates variable names at command create/update time) and
// woofwoofwoof (extracts values at match time), so the two never drift.
//
// `command` itself never contains "{...}" - it's always the bare trigger
// word ("sr", "hug"). The pattern is a separate field precisely so the
// Casbin resource key ("command/"+command) and the in-memory chat trigger
// word are never polluted by brace syntax.

const VARIABLE_TOKEN_RE = /\{([^}]*)\}/g;

// "One word or dot-separated. No other characters are valid" - \w is
// [A-Za-z0-9_], dot-joined segments of that.
const VALID_VARIABLE_NAME_RE = /^\w+(\.\w+)*$/;

/** Ordered list of variable names declared in `pattern`, e.g.
 * "{userA} {userB}" -> ["userA", "userB"]. Empty pattern -> []. */
export function parseCommandVariables(pattern: string): string[] {
  if (!pattern) {
    return [];
  }
  const names: string[] = [];
  VARIABLE_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_TOKEN_RE.exec(pattern)) !== null) {
    names.push(match[1]);
  }
  return names;
}

export function isValidVariableName(name: string): boolean {
  return VALID_VARIABLE_NAME_RE.test(name);
}

/** Returns every variable token in `pattern` that fails the naming rule
 * (empty array = the whole pattern is valid). Use this to reject a
 * command's argumentPattern at create/update time. */
export function invalidCommandVariableNames(pattern: string): string[] {
  return parseCommandVariables(pattern).filter((name) => !isValidVariableName(name));
}

/** Assigns `value` into `target` at a possibly dotted path (e.g.
 * "user.name" -> target.user.name = value), creating intermediate objects
 * as needed. Lets a dotted variable name build a nested object that the
 * `{template}` resolver's existing dotted-path traversal can address. */
function setNestedValue(target: Record<string, unknown>, dottedKey: string, value: unknown): void {
  const segments = dottedKey.split(".");
  let cur = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const existing = cur[seg];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      cur = existing as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      cur[seg] = created;
      cur = created;
    }
  }
  cur[segments[segments.length - 1]] = value;
}

/**
 * Extracts named argument values from `remainderText` (the raw text after
 * the command word) according to `variables` (the ordered names parsed via
 * `parseCommandVariables`).
 *
 * - Zero variables: returns `{}` - commands with no `{variable}` syntax are
 *   completely unaffected.
 * - Exactly one variable: captures the entire (trimmed) remainder, NOT
 *   split on whitespace - e.g. `["songTitle"]` against
 *   "Life is a highway" yields `{ songTitle: "Life is a highway" }`.
 * - More than one: every variable but the last consumes exactly one
 *   whitespace-delimited token; the last captures whatever text remains
 *   (rejoined with single spaces). Missing trailing tokens yield `""`.
 */
export function extractCommandVariables(variables: string[], remainderText: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (variables.length === 0) {
    return result;
  }

  const trimmed = remainderText.trim();
  if (variables.length === 1) {
    setNestedValue(result, variables[0], trimmed);
    return result;
  }

  const tokens = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
  for (let i = 0; i < variables.length - 1; i++) {
    setNestedValue(result, variables[i], tokens[i] ?? "");
  }
  const lastValue = tokens.slice(variables.length - 1).join(" ");
  setNestedValue(result, variables[variables.length - 1], lastValue);
  return result;
}
