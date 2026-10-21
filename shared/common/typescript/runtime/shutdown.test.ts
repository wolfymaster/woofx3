import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { installShutdown, type ShutdownReason, type SignalSource } from "./shutdown";

function harness(stop: (reason: ShutdownReason) => Promise<void>, deadlineMs = 1000) {
  const emitter = new EventEmitter();
  const exits: number[] = [];
  const logs: string[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextHandle = 1;

  const handle = installShutdown({
    stop,
    deadlineMs,
    logger: {
      info: (message: string) => logs.push(`info: ${message}`),
      error: (message: string) => logs.push(`error: ${message}`),
    },
    exit: (code) => exits.push(code),
    process: emitter as unknown as SignalSource,
    timers: {
      setTimeout: (fn, ms) => {
        const id = nextHandle++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id as number);
      },
    },
  });

  return { emitter, exits, logs, timers, handle };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("installShutdown", () => {
  test.each(["SIGTERM", "SIGINT", "SIGBREAK"])("%s stops cleanly and exits 0 once", async (signal) => {
    const reasons: ShutdownReason[] = [];
    const h = harness(async (reason) => {
      reasons.push(reason);
    });
    h.emitter.emit(signal);
    await flush();
    expect(reasons).toEqual([signal as ShutdownReason]);
    expect(h.exits).toEqual([0]);
    expect(h.timers.size).toBe(0);
  });

  test("a throwing stop exits 1", async () => {
    const h = harness(async () => {
      throw new Error("boom");
    });
    h.emitter.emit("SIGTERM");
    await flush();
    expect(h.exits).toEqual([1]);
  });

  test("a synchronously throwing stop exits 1 with the stop-error log line", async () => {
    const h = harness((() => {
      throw new Error("sync boom");
    }) as unknown as () => Promise<void>);
    h.emitter.emit("SIGTERM");
    await flush();
    expect(h.exits).toEqual([1]);
    expect(h.logs.some((l) => l.includes("Error during graceful shutdown"))).toBe(true);
    expect(h.logs.some((l) => l.includes("during shutdown, exiting immediately"))).toBe(false);
  });

  test("a hung stop exits 1 at the deadline and says so", async () => {
    const h = harness(() => new Promise<void>(() => {}), 250);
    h.emitter.emit("SIGTERM");
    expect([...h.timers.values()].map((t) => t.ms)).toEqual([250]);
    [...h.timers.values()][0].fn();
    expect(h.exits).toEqual([1]);
    expect(h.logs.some((l) => l.includes("did not finish within 250ms"))).toBe(true);
  });

  test("a second signal exits 1 immediately and stop runs once", () => {
    let stops = 0;
    const h = harness(() => {
      stops++;
      return new Promise<void>(() => {});
    });
    h.emitter.emit("SIGINT");
    h.emitter.emit("SIGINT");
    expect(stops).toBe(1);
    expect(h.exits).toEqual([1]);
    expect(h.timers.size).toBe(0);
    expect(h.logs.some((l) => l.includes("during shutdown"))).toBe(true);
  });

  test("an uncaught exception shuts down and exits 1 even when stop succeeds", async () => {
    const reasons: ShutdownReason[] = [];
    const h = harness(async (reason) => {
      reasons.push(reason);
    });
    h.emitter.emit("uncaughtException", new Error("bad"));
    await flush();
    expect(reasons).toEqual(["uncaughtException"]);
    expect(h.exits).toEqual([1]);
  });

  test("an unhandled rejection is logged and does not exit", async () => {
    const h = harness(async () => {});
    h.emitter.emit("unhandledRejection", new Error("late"));
    await flush();
    expect(h.exits).toEqual([]);
    expect(h.logs.some((l) => l.includes("Unhandled rejection"))).toBe(true);
  });

  test("a stop settling after the deadline already exited does not exit again", async () => {
    let finish = () => {};
    const h = harness(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      250
    );
    h.emitter.emit("SIGTERM");
    [...h.timers.values()][0].fn();
    finish();
    await flush();
    expect(h.exits).toEqual([1]);
  });

  test("an uncaught exception during shutdown exits 1 once and stop runs once", async () => {
    let stops = 0;
    const h = harness(() => {
      stops++;
      return new Promise<void>(() => {});
    });
    h.emitter.emit("SIGTERM");
    h.emitter.emit("uncaughtException", new Error("bad"));
    await flush();
    expect(stops).toBe(1);
    expect(h.exits).toEqual([1]);
  });

  test("dispose removes listeners and cancels a pending deadline", () => {
    const h = harness(() => new Promise<void>(() => {}));
    h.emitter.emit("SIGTERM");
    h.handle.dispose();
    expect(h.timers.size).toBe(0);
    for (const event of ["SIGTERM", "SIGINT", "SIGBREAK", "uncaughtException", "unhandledRejection"]) {
      expect(h.emitter.listenerCount(event)).toBe(0);
    }
  });

  test("dispose suppresses the exit of a stop already in flight", async () => {
    let finish = () => {};
    const h = harness(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    h.emitter.emit("SIGTERM");
    h.handle.dispose();
    finish();
    await flush();
    expect(h.exits).toEqual([]);
  });

  test.each([0, -5, Number.NaN])("rejects deadline %p", (deadlineMs) => {
    expect(() => harness(async () => {}, deadlineMs)).toThrow("deadlineMs");
  });
});

test("process is assignable to SignalSource (checked by tsc)", () => {
  const source: SignalSource = process;
  expect(typeof source.on).toBe("function");
});
