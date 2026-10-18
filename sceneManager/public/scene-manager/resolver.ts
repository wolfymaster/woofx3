// Safe expression evaluator: a small tokenizer and recursive-descent parser
// for ternaries, comparisons, arithmetic and dotted paths. `event-queue.ts`
// evaluates a widget's `priorityExpr` against each arriving `WidgetEvent`
// with it rather than running widget-supplied code in the page's
// unsandboxed realm: no `eval`, no `new Function()`, no access to globals
// or the DOM.

export type ResolverContext = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Safe expression evaluator
//
// Grammar (low → high precedence):
//   ternary   := logicalOr ("?" expr ":" expr)?
//   logicalOr := logicalAnd ("||" logicalAnd)*
//   logicalAnd:= equality ("&&" equality)*
//   equality  := comparison (("=="|"!="|"==="|"!==") comparison)*
//   comparison:= additive ((">"|"<"|">="|"<=") additive)*
//   additive  := multiplicative (("+"|"-") multiplicative)*
//   multiplicative := unary (("*"|"/"|"%") unary)*
//   unary     := ("-"|"!")? primary
//   primary   := number | string | "true" | "false" | "null" | path | "(" ternary ")"
//   path      := identifier ("." identifier | "[" expr "]")*
// ---------------------------------------------------------------------------

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "punct"; value: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1]! >= "0" && src[i + 1]! <= "9")) {
      let j = i + 1;
      while (j < src.length && ((src[j]! >= "0" && src[j]! <= "9") || src[j] === ".")) {
        j += 1;
      }
      out.push({ kind: "num", value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const next = src[j + 1];
          s += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
          j += 2;
          continue;
        }
        s += src[j];
        j += 1;
      }
      if (j >= src.length) {
        throw new Error("unterminated string");
      }
      out.push({ kind: "str", value: s });
      i = j + 1;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$") {
      let j = i + 1;
      while (
        j < src.length &&
        ((src[j]! >= "a" && src[j]! <= "z") ||
          (src[j]! >= "A" && src[j]! <= "Z") ||
          (src[j]! >= "0" && src[j]! <= "9") ||
          src[j] === "_" ||
          src[j] === "$")
      ) {
        j += 1;
      }
      out.push({ kind: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      out.push({ kind: "punct", value: three });
      i += 3;
      continue;
    }
    if (two === "==" || two === "!=" || two === ">=" || two === "<=" || two === "&&" || two === "||") {
      out.push({ kind: "punct", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%(),.[]?:!<>".includes(c)) {
      out.push({ kind: "punct", value: c });
      i += 1;
      continue;
    }
    throw new Error(`unexpected character: ${c}`);
  }
  return out;
}

export function evaluateExpression(src: string, ctx: ResolverContext): unknown {
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch {
    return undefined;
  }
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const eat = (kind: Token["kind"], value?: string): Token | null => {
    const t = tokens[pos];
    if (!t) {
      return null;
    }
    if (t.kind !== kind) {
      return null;
    }
    if (value !== undefined && t.value !== value) {
      return null;
    }
    pos += 1;
    return t;
  };

  const parseTernary = (): unknown => {
    const cond = parseOr();
    if (eat("punct", "?")) {
      const a = parseTernary();
      if (!eat("punct", ":")) {
        throw new Error("expected ':' in ternary");
      }
      const b = parseTernary();
      return cond ? a : b;
    }
    return cond;
  };

  const parseOr = (): unknown => {
    let left = parseAnd();
    while (eat("punct", "||")) {
      const right = parseAnd();
      left = left || right;
    }
    return left;
  };

  const parseAnd = (): unknown => {
    let left = parseEquality();
    while (eat("punct", "&&")) {
      const right = parseEquality();
      left = left && right;
    }
    return left;
  };

  const parseEquality = (): unknown => {
    let left = parseComparison();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "==") {
        pos += 1;
        // biome-ignore lint/suspicious/noDoubleEquals: explicit loose equality semantics
        left = left == parseComparison();
      } else if (op.value === "!=") {
        pos += 1;
        // biome-ignore lint/suspicious/noDoubleEquals: explicit loose equality semantics
        left = left != parseComparison();
      } else if (op.value === "===") {
        pos += 1;
        left = left === parseComparison();
      } else if (op.value === "!==") {
        pos += 1;
        left = left !== parseComparison();
      } else {
        break;
      }
    }
    return left;
  };

  const parseComparison = (): unknown => {
    let left = parseAdditive();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === ">") {
        pos += 1;
        left = (left as number) > (parseAdditive() as number);
      } else if (op.value === "<") {
        pos += 1;
        left = (left as number) < (parseAdditive() as number);
      } else if (op.value === ">=") {
        pos += 1;
        left = (left as number) >= (parseAdditive() as number);
      } else if (op.value === "<=") {
        pos += 1;
        left = (left as number) <= (parseAdditive() as number);
      } else {
        break;
      }
    }
    return left;
  };

  const parseAdditive = (): unknown => {
    let left = parseMultiplicative();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "+") {
        pos += 1;
        const right = parseMultiplicative();
        left =
          typeof left === "string" || typeof right === "string"
            ? `${left ?? ""}${right ?? ""}`
            : (left as number) + (right as number);
      } else if (op.value === "-") {
        pos += 1;
        left = (left as number) - (parseMultiplicative() as number);
      } else {
        break;
      }
    }
    return left;
  };

  const parseMultiplicative = (): unknown => {
    let left = parseUnary();
    while (true) {
      const op = peek();
      if (!op || op.kind !== "punct") {
        break;
      }
      if (op.value === "*") {
        pos += 1;
        left = (left as number) * (parseUnary() as number);
      } else if (op.value === "/") {
        pos += 1;
        left = (left as number) / (parseUnary() as number);
      } else if (op.value === "%") {
        pos += 1;
        left = (left as number) % (parseUnary() as number);
      } else {
        break;
      }
    }
    return left;
  };

  const parseUnary = (): unknown => {
    if (eat("punct", "-")) {
      return -(parseUnary() as number);
    }
    if (eat("punct", "!")) {
      return !parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): unknown => {
    const t = peek();
    if (!t) {
      throw new Error("unexpected end of expression");
    }
    if (t.kind === "num") {
      pos += 1;
      return t.value;
    }
    if (t.kind === "str") {
      pos += 1;
      return t.value;
    }
    if (t.kind === "punct" && t.value === "(") {
      pos += 1;
      const v = parseTernary();
      if (!eat("punct", ")")) {
        throw new Error("expected ')'");
      }
      return v;
    }
    if (t.kind === "ident") {
      pos += 1;
      if (t.value === "true") {
        return true;
      }
      if (t.value === "false") {
        return false;
      }
      if (t.value === "null") {
        return null;
      }
      if (t.value === "undefined") {
        return undefined;
      }
      let cur: unknown = (ctx as Record<string, unknown>)[t.value];
      while (true) {
        if (eat("punct", ".")) {
          const name = eat("ident");
          if (!name) {
            throw new Error("expected identifier after '.'");
          }
          cur = cur == null ? undefined : (cur as Record<string, unknown>)[name.value];
          continue;
        }
        if (eat("punct", "[")) {
          const idx = parseTernary();
          if (!eat("punct", "]")) {
            throw new Error("expected ']'");
          }
          cur = cur == null ? undefined : (cur as Record<string | number, unknown>)[idx as string | number];
          continue;
        }
        break;
      }
      return cur;
    }
    throw new Error(`unexpected token: ${JSON.stringify(t)}`);
  };

  try {
    const result = parseTernary();
    if (pos !== tokens.length) {
      throw new Error("trailing tokens");
    }
    return result;
  } catch {
    return undefined;
  }
}
