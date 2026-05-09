import { describe, expect, test } from "bun:test";
import { resolve } from "./resolver";

const ctx = {
  user: "wolfy",
  amount: 150,
  message: "hi there",
  metadata: { tier: "1000", emoji: "🐺" },
};

describe("resolver", () => {
  test("plain string passes through", () => {
    expect(resolve("hello", ctx)).toBe("hello");
  });

  test("number passes through", () => {
    expect(resolve(42, ctx)).toBe(42);
  });

  test("token substitution", () => {
    expect(resolve("Hi {user}!", ctx)).toBe("Hi wolfy!");
    expect(resolve("Got {amount} bits", ctx)).toBe("Got 150 bits");
  });

  test("nested path token", () => {
    expect(resolve("Tier {metadata.tier}", ctx)).toBe("Tier 1000");
  });

  test("ternary expression", () => {
    expect(resolve("{amount > 100 ? 'gold' : 'white'}", ctx)).toBe("gold");
    expect(resolve("{amount > 100 ? 'gold' : 'white'}", { ...ctx, amount: 5 })).toBe("white");
  });

  test("single-segment expression returns typed value (number)", () => {
    expect(resolve("{amount * 2}", ctx)).toBe(300);
  });

  test("single-segment expression returns typed value (boolean)", () => {
    expect(resolve("{amount > 100}", ctx)).toBe(true);
  });

  test("missing token resolves to empty in multi-segment string", () => {
    expect(resolve("Hello {missing}!", ctx)).toBe("Hello !");
  });

  test("expression error doesn't throw", () => {
    // Bare ')' is not valid — evaluator returns undefined → empty in
    // multi-segment context.
    expect(resolve("Hi {)} there", ctx)).toBe("Hi  there");
  });

  test("string concatenation in expression", () => {
    expect(resolve("{user + '!'}", ctx)).toBe("wolfy!");
  });

  test("logical operators", () => {
    expect(resolve("{user && amount > 0}", ctx)).toBe(true);
    expect(resolve("{!user || amount > 1000}", ctx)).toBe(false);
  });

  test("equality comparisons", () => {
    expect(resolve("{user === 'wolfy'}", ctx)).toBe(true);
    expect(resolve("{user !== 'other'}", ctx)).toBe(true);
  });

  test("safety: no global access", () => {
    // Identifiers that aren't in ctx resolve to undefined; there's no
    // way to reach `globalThis`, `window`, `process`, etc.
    expect(resolve("{globalThis}", ctx)).toBeUndefined();
    expect(resolve("{window}", ctx)).toBeUndefined();
  });

  test("safety: no method calls", () => {
    // `.toLowerCase()` would parse as a path lookup `toLowerCase`, then
    // a `(` which isn't valid in path mode → eval returns undefined.
    // This documents the safety boundary.
    expect(resolve("{user.toLowerCase()}", ctx)).toBeUndefined();
  });
});
