import { describe, expect, test } from "bun:test";
import { boundedBySignal } from "./bounded";

describe("boundedBySignal", () => {
  test("settles with the work's value when it finishes first", async () => {
    const controller = new AbortController();
    expect(await boundedBySignal(async () => 7, controller.signal)).toEqual({ kind: "done", value: 7 });
  });

  test("settles with the work's error when it fails first, a synchronous throw included", async () => {
    const controller = new AbortController();
    const boom = new Error("boom");
    expect(await boundedBySignal(() => Promise.reject(boom), controller.signal)).toEqual({
      kind: "failed",
      error: boom,
    });
    const throwing = () => {
      throw boom;
    };
    expect(await boundedBySignal(throwing, controller.signal)).toEqual({ kind: "failed", error: boom });
  });

  test("settles with timeout as soon as the signal aborts, leaving the work running", async () => {
    const controller = new AbortController();
    let finish: (value: number) => void = () => {};
    const work = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const run = boundedBySignal(() => work, controller.signal);
    controller.abort();
    expect(await run).toEqual({ kind: "timeout" });
    finish(1);
    expect(await work).toBe(1);
  });

  test("settles with timeout without starting the work when the signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;
    const run = await boundedBySignal(async () => {
      started = true;
    }, controller.signal);
    expect(run).toEqual({ kind: "timeout" });
    expect(started).toBe(false);
  });
});
