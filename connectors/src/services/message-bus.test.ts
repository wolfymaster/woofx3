import { describe, expect, test } from "bun:test";
import type NATSClient from "@woofx3/nats/src/client";
import { RecordingLogger } from "../host/testing";
import MessageBusService from "./message-bus";

type Status = { type: string };

/**
 * The slice of NATSClient the service uses. Its status stream, like the real
 * one, ends once the connection closes, but only after `endDelayMs`, so a
 * disconnect that does not wait for the loop returns before it ends.
 */
class FakeNats {
  closed = false;
  loopEnded = false;
  private wake: (() => void) | undefined;
  private readonly queued: Status[] = [];

  constructor(
    private readonly endDelayMs: number,
    private readonly failStream = false
  ) {}

  async connect(): Promise<void> {}

  async close(): Promise<void> {
    this.closed = true;
    this.wake?.();
  }

  emit(status: Status): void {
    this.queued.push(status);
    this.wake?.();
  }

  asNATS() {
    return {
      isClosed: () => this.closed,
      status: () => this.stream(),
    };
  }

  private async *stream(): AsyncGenerator<Status> {
    if (this.failStream) {
      throw new Error("status stream broke");
    }
    try {
      while (!this.closed) {
        const next = this.queued.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }
      await new Promise((resolve) => setTimeout(resolve, this.endDelayMs));
    } finally {
      this.loopEnded = true;
    }
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function service(nats: FakeNats, logger = new RecordingLogger()): MessageBusService {
  // The service reads only connect, close and asNATS, which the fake provides.
  return new MessageBusService(nats as unknown as NATSClient, logger);
}

describe("MessageBusService", () => {
  test("follows disconnect and reconnect status events", async () => {
    const nats = new FakeNats(0);
    const bus = service(nats);
    await bus.connect();
    expect(bus.isUp()).toBe(true);

    nats.emit({ type: "disconnect" });
    await flush();
    expect(bus.isUp()).toBe(false);

    nats.emit({ type: "reconnect" });
    await flush();
    expect(bus.isUp()).toBe(true);
    await bus.disconnect();
  });

  test("disconnect waits for the status loop to end", async () => {
    const nats = new FakeNats(20);
    const bus = service(nats);
    await bus.connect();

    await bus.disconnect();
    expect(nats.loopEnded).toBe(true);
    expect(bus.isUp()).toBe(false);
  });

  test("a status stream that fails is logged, reports the bus down, and does not fail disconnect", async () => {
    const nats = new FakeNats(0, true);
    const logger = new RecordingLogger();
    const bus = service(nats, logger);
    await bus.connect();
    await flush();

    expect(bus.isUp()).toBe(false);
    expect(logger.at("error").map((entry) => entry.message)).toEqual([
      "bus status stream failed; reporting the bus down from now on",
    ]);
    await bus.disconnect();
  });
});
