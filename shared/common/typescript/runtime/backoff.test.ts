import { describe, expect, test } from "bun:test";
import { createBackoff, type RandomSource } from "./backoff";

function seeded(values: number[]): RandomSource {
  let i = 0;
  return { next: () => values[i++ % values.length] };
}

const nearOne = 0.999999;

describe("createBackoff", () => {
  test("the ceiling doubles per failure and the delay is jittered below it", () => {
    const backoff = createBackoff({ baseMs: 100, maxMs: 10_000 }, seeded([nearOne, nearOne, nearOne, 0.5]));
    expect(backoff.next()).toBe(99);
    expect(backoff.next()).toBe(199);
    expect(backoff.next()).toBe(399);
    expect(backoff.next()).toBe(400);
  });

  test("full jitter reaches zero", () => {
    const backoff = createBackoff({ baseMs: 100, maxMs: 1000 }, seeded([0]));
    expect(backoff.next()).toBe(0);
  });

  test("stays at the cap without overflowing", () => {
    const backoff = createBackoff({ baseMs: 100, maxMs: 1000 }, seeded([nearOne]));
    let last = 0;
    for (let i = 0; i < 5000; i++) {
      last = backoff.next();
      expect(Number.isFinite(last)).toBe(true);
      expect(last).toBeLessThan(1000);
    }
    expect(last).toBe(999);
  });

  test("reset starts over from the base", () => {
    const backoff = createBackoff({ baseMs: 100, maxMs: 1000 }, seeded([nearOne]));
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(99);
  });

  test.each([
    ["zero base", { baseMs: 0, maxMs: 10 }],
    ["negative base", { baseMs: -1, maxMs: 10 }],
    ["max below base", { baseMs: 100, maxMs: 10 }],
    ["NaN base", { baseMs: Number.NaN, maxMs: 10 }],
    ["NaN max", { baseMs: 1, maxMs: Number.NaN }],
    ["infinite max", { baseMs: 1, maxMs: Number.POSITIVE_INFINITY }],
  ])("rejects %s", (_name, config) => {
    expect(() => createBackoff(config, seeded([0]))).toThrow("backoff requires");
  });

  test.each([
    ["one", 1],
    ["negative", -0.1],
    ["NaN", Number.NaN],
  ])("rejects a random source returning %s", (_name, value) => {
    const backoff = createBackoff({ baseMs: 10, maxMs: 100 }, seeded([value]));
    expect(() => backoff.next()).toThrow("RandomSource");
  });
});
