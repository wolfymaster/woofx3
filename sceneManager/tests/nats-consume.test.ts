import { describe, expect, it, mock } from "bun:test";
import type { Msg as NatsCoreMsg } from "@nats-io/nats-core";
import { consumeMessages } from "@woofx3/nats/src/client";

function logger() {
  return { info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}), error: mock(() => {}) };
}

async function* messages(...subjects: string[]): AsyncIterable<NatsCoreMsg> {
  for (const subject of subjects) {
    yield { subject, data: new TextEncoder().encode("{}") } as unknown as NatsCoreMsg;
  }
}

describe("consumeMessages", () => {
  it("keeps the subscription going after a handler throws", async () => {
    const seen: string[] = [];
    const log = logger();

    await consumeMessages(
      "alerts.>",
      messages("alerts.a", "alerts.b", "alerts.c"),
      (msg) => {
        seen.push(msg.subject);
        if (msg.subject === "alerts.a") {
          throw new Error("bad message");
        }
      },
      log
    );

    expect(seen).toEqual(["alerts.a", "alerts.b", "alerts.c"]);
    expect(log.error).toHaveBeenCalledTimes(1);
    const [text, fields] = log.error.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(text).toBe("subscription handler failed");
    expect(fields.messageSubject).toBe("alerts.a");
  });

  it("logs a rejected handler with its subject instead of leaving it unhandled", async () => {
    const log = logger();

    await consumeMessages(
      "alerts.>",
      messages("alerts.a"),
      async () => {
        throw new Error("db down");
      },
      log
    );
    await Promise.resolve();

    expect(log.error).toHaveBeenCalledTimes(1);
    const [, fields] = log.error.mock.calls[0] as unknown as [string, { subject: string; error: { stack?: string } }];
    expect(fields.subject).toBe("alerts.>");
    expect(fields.error.stack).toContain("db down");
  });

  it("does not wait for one handler before starting the next", async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    await consumeMessages(
      "x",
      messages("x.slow", "x.fast"),
      async (msg) => {
        started.push(msg.subject);
        if (msg.subject === "x.slow") {
          await blocked;
        }
      },
      logger()
    );

    expect(started).toEqual(["x.slow", "x.fast"]);
    release();
  });
});
