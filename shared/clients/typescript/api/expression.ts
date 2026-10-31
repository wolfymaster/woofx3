// The function calls `${…}` expressions may make, and a check of them for
// whoever writes definitions before the engine sees them. The engine's own
// parser is workflow/internal/expression/compound.go; both are held to
// tests/expression-conformance.json beside this file.

export interface ExpressionFunction {
  minArgs: number;
  /** `null` when it takes any number of arguments. */
  maxArgs: number | null;
}

export const EXPRESSION_FUNCTIONS: Readonly<Record<string, ExpressionFunction>> = {
  add: { minArgs: 2, maxArgs: null },
  subtract: { minArgs: 2, maxArgs: 2 },
  multiply: { minArgs: 2, maxArgs: null },
  divide: { minArgs: 2, maxArgs: 2 },
  min: { minArgs: 2, maxArgs: null },
  max: { minArgs: 2, maxArgs: null },
  round: { minArgs: 1, maxArgs: 2 },
  uppercase: { minArgs: 1, maxArgs: 1 },
  lowercase: { minArgs: 1, maxArgs: 1 },
  random: { minArgs: 2, maxArgs: 2 },
};

const EXPRESSION = /\$\{([^}]+)\}/g;
const CALL = /[A-Za-z_$][A-Za-z0-9_$.[\]-]*\s*\(/;
const UNCHECKED_PREFIXES = ["woofx3_asset_url:", "asset:"];

// Longest first, so ">=" is never read as ">" followed by "=".
const OPERATORS = ["===", "!==", "==", "!=", ">=", "<=", "&&", "||", ">", "<", "!", "?", ":", "(", ")", ","];
const KEYWORDS = new Set(["true", "false", "null"]);

type Token = { kind: "operator" | "string" | "number" | "reference"; text: string };

/** Ends a check; never leaves this module. */
class ExpressionProblem extends Error {}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i] as string;
    if (c === " " || c === "\t" || c === "\n") {
      i++;
    } else if (c === "'" || c === '"') {
      const end = expr.indexOf(c, i + 1);
      if (end < 0) {
        throw new ExpressionProblem(`unterminated string in "${expr}"`);
      }
      tokens.push({ kind: "string", text: expr.slice(i + 1, end) });
      i = end + 1;
    } else if (isDigit(c) || (c === "-" && isDigit(expr[i + 1]))) {
      let j = i + 1;
      while (isDigit(expr[j]) || expr[j] === ".") {
        j++;
      }
      const text = expr.slice(i, j);
      if (Number.isNaN(Number(text))) {
        throw new ExpressionProblem(`bad number "${text}" in "${expr}"`);
      }
      tokens.push({ kind: "number", text });
      i = j;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_$.[\]-]/.test(expr[j] as string)) {
        j++;
      }
      tokens.push({ kind: "reference", text: expr.slice(i, j) });
      i = j;
    } else {
      const op = OPERATORS.find((candidate) => expr.startsWith(candidate, i));
      if (op === undefined) {
        throw new ExpressionProblem(`unexpected "${c}" in "${expr}"`);
      }
      tokens.push({ kind: "operator", text: op });
      i += op.length;
    }
  }
  return tokens;
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

/** Walks the same grammar as the engine's parser, by the same precedence, building nothing. */
class Checker {
  private pos = 0;

  constructor(
    private readonly expr: string,
    private readonly tokens: readonly Token[]
  ) {}

  check(): void {
    this.ternary();
    const left = this.tokens[this.pos];
    if (left !== undefined) {
      throw new ExpressionProblem(`unexpected "${left.text}" in "${this.expr}"`);
    }
  }

  private accept(...ops: string[]): boolean {
    const token = this.tokens[this.pos];
    if (token?.kind === "operator" && ops.includes(token.text)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private ternary(): void {
    this.or();
    if (!this.accept("?")) {
      return;
    }
    this.ternary();
    if (!this.accept(":")) {
      throw new ExpressionProblem(`missing ':' in "${this.expr}"`);
    }
    this.ternary();
  }

  private or(): void {
    this.binary(() => this.and(), "||");
  }

  private and(): void {
    this.binary(() => this.equality(), "&&");
  }

  private equality(): void {
    this.binary(() => this.comparison(), "==", "!=", "===", "!==");
  }

  private comparison(): void {
    this.binary(() => this.unary(), ">", ">=", "<", "<=");
  }

  private binary(operand: () => void, ...ops: string[]): void {
    operand();
    while (this.accept(...ops)) {
      operand();
    }
  }

  private unary(): void {
    if (this.accept("!")) {
      this.unary();
      return;
    }
    this.primary();
  }

  private primary(): void {
    const token = this.tokens[this.pos];
    if (token === undefined) {
      throw new ExpressionProblem(`unexpected end of "${this.expr}"`);
    }
    this.pos++;
    if (token.kind === "string" || token.kind === "number") {
      return;
    }
    if (token.kind === "reference") {
      if (!KEYWORDS.has(token.text) && this.accept("(")) {
        this.call(token.text);
      }
      return;
    }
    if (token.text !== "(") {
      throw new ExpressionProblem(`unexpected "${token.text}" in "${this.expr}"`);
    }
    this.ternary();
    if (!this.accept(")")) {
      throw new ExpressionProblem(`missing ')' in "${this.expr}"`);
    }
  }

  private call(name: string): void {
    let argCount = 0;
    if (!this.accept(")")) {
      for (;;) {
        this.ternary();
        argCount++;
        if (this.accept(",")) {
          continue;
        }
        if (this.accept(")")) {
          break;
        }
        throw new ExpressionProblem(`missing ')' in call to ${name} in "${this.expr}"`);
      }
    }
    const fn = Object.hasOwn(EXPRESSION_FUNCTIONS, name) ? EXPRESSION_FUNCTIONS[name] : undefined;
    if (fn === undefined) {
      throw new ExpressionProblem(`unknown function "${name}"`);
    }
    if (argCount < fn.minArgs) {
      throw new ExpressionProblem(`${name} takes at least ${fn.minArgs} arguments, got ${argCount}`);
    }
    if (fn.maxArgs !== null && argCount > fn.maxArgs) {
      throw new ExpressionProblem(`${name} takes at most ${fn.maxArgs} arguments, got ${argCount}`);
    }
  }
}

/**
 * The first bad function call in a string's `${…}` expressions, as a message, or
 * `null` when there is none. An expression with no call is not judged: the engine
 * resolves it as it always has.
 */
export function functionCallProblem(text: string): string | null {
  for (const match of text.matchAll(EXPRESSION)) {
    const expr = match[1] as string;
    if (UNCHECKED_PREFIXES.some((prefix) => expr.startsWith(prefix)) || !CALL.test(expr)) {
      continue;
    }
    try {
      new Checker(expr, tokenize(expr)).check();
    } catch (error) {
      if (error instanceof ExpressionProblem) {
        return `\${${expr}}: ${error.message}`;
      }
      throw error;
    }
  }
  return null;
}
