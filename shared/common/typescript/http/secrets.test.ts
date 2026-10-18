import { describe, expect, test } from "bun:test";
import { secretsMatch } from "./secrets";

describe("secretsMatch", () => {
  test("matches only the identical secret", () => {
    expect(secretsMatch("s3cret", "s3cret")).toBe(true);
    expect(secretsMatch("s3cret", "s3creT")).toBe(false);
    expect(secretsMatch("s3cret", "s3cre")).toBe(false);
    expect(secretsMatch("s3cret", "s3cret ")).toBe(false);
    expect(secretsMatch("s3cret", "")).toBe(false);
  });

  test("compares values of any length without throwing", () => {
    expect(secretsMatch("short", "x".repeat(10_000))).toBe(false);
  });
});
