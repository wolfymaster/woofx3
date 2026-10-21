import { describe, expect, it, mock } from "bun:test";
import { createMessage } from "@woofx3/nats/src/msg";
import type { Msg } from "@woofx3/nats/src/types";
import { subscribeJson } from "../src/nats-subscriptions";

function fakeBus() {
  const handlers = new Map<string, (msg: Msg) => unknown>();
  return {
    handlers,
    subscribe: async (subject: string, handler: (msg: Msg) => unknown) => {
      handlers.set(subject, handler);
      return {} as never;
    },
  };
}

const logger = () => ({ debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) });

describe("subscribeJson", () => {
  it("hands each message's JSON body to the handler", async () => {
    const bus = fakeBus();
    const seen: unknown[] = [];
    await subscribeJson<{ id: string }>(bus as never, logger() as never, "db.scene.updated.*", (body, msg) => {
      seen.push([body.id, msg.subject]);
    });
    await bus.handlers.get("db.scene.updated.*")!(createMessage("db.scene.updated.s1", '{"id":"s1"}'));
    expect(seen).toEqual([["s1", "db.scene.updated.s1"]]);
  });

  it("logs and drops a body that is not JSON, without calling the handler", async () => {
    const bus = fakeBus();
    const log = logger();
    const handle = mock(() => {});
    await subscribeJson(bus as never, log as never, "widget.event", handle);
    await bus.handlers.get("widget.event")!(createMessage("widget.event", "{not json"));
    expect(handle).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect((log.error.mock.calls[0] as unknown as [string])[0]).toBe("widget.event: malformed JSON body; dropped");
  });
});
