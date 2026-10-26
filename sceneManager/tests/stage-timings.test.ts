import { describe, expect, it } from "bun:test";
import { StageTimings } from "../src/stage-timings";

/** A clock that reads each value of `times` in turn. */
function clockOf(times: number[]): () => number {
  let index = 0;
  return () => {
    const time = times[index];
    if (time === undefined) {
      throw new Error("clock read more often than the test expects");
    }
    index += 1;
    return time;
  };
}

describe("StageTimings", () => {
  it("adds up every run of a stage and reports the total since it was made", async () => {
    // made at 0; a: 1 -> 4; b: 4 -> 10; a: 10 -> 12; total read at 20
    const timings = new StageTimings<"a" | "b">(clockOf([0, 1, 4, 4, 10, 10, 12, 20, 20]));
    await timings.time("a", async () => "x");
    await timings.time("b", async () => "y");
    await timings.time("a", async () => "z");

    expect(timings.logFields()).toEqual({ aMs: 5, bMs: 6, totalMs: 20 });
    expect(timings.serverTiming()).toBe("a;dur=5, b;dur=6, total;dur=20");
  });

  it("counts a stage that throws, and passes the error on", async () => {
    const timings = new StageTimings<"a">(clockOf([0, 1, 3.04, 5]));
    await expect(
      timings.time("a", async () => {
        throw new Error("db down");
      })
    ).rejects.toThrow("db down");

    expect(timings.logFields()).toEqual({ aMs: 2, totalMs: 5 });
  });

  it("returns what the stage resolved to", async () => {
    const timings = new StageTimings<"a">(() => 0);
    expect(await timings.time("a", async () => 42)).toBe(42);
  });
});
