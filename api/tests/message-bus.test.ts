import { describe, expect, mock, test } from "bun:test";
import { connectMessageBus } from "../src/message-bus";

function logger() {
  return { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never;
}

/** Records the waits instead of taking them. */
function fakeSleep() {
  const waited: number[] = [];
  return { waited, sleep: async (ms: number) => void waited.push(ms) };
}

describe("connectMessageBus", () => {
  test("returns the client the first attempt gives", async () => {
    const connect = mock(async () => "client");

    const client = await connectMessageBus({ connect, logger: logger(), sleep: async () => {} });

    expect(client).toBe("client");
    expect(connect).toHaveBeenCalledTimes(1);
  });

  test("waits for a bus that is not listening yet", async () => {
    let attempts = 0;
    const { waited, sleep } = fakeSleep();
    const connect = mock(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("connection refused");
      }
      return "client";
    });

    const client = await connectMessageBus({ connect, logger: logger(), delayMs: 2000, sleep });

    expect(client).toBe("client");
    expect(attempts).toBe(3);
    expect(waited).toEqual([2000, 2000]);
  });

  test("gives up after its attempts, and says so", async () => {
    const log = logger();
    const connect = mock(async () => {
      throw new Error("connection refused");
    });

    const client = await connectMessageBus({ connect, logger: log, attempts: 3, sleep: async () => {} });

    expect(client).toBeNull();
    expect(connect).toHaveBeenCalledTimes(3);
    expect((log as never as { warn: ReturnType<typeof mock> }).warn).toHaveBeenCalledTimes(1);
  });
});
