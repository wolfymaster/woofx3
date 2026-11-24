import { describe, expect, test } from "bun:test";
import { type CallbackEvent, EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { EventCatalog } from "../src/event-catalog";
import type { EventLogSelectionSource } from "../src/event-log-selection";
import { LEGACY_STREAM_EVENT_TYPES } from "../src/stream-event-broadcaster";
import { StreamEventForwarder } from "../src/stream-event-forwarder";
import { ALWAYS_RECORDED_EVENT_TYPES } from "../src/user-event-recorder";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as SharedLogger;

function setup(enabled: string[]) {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    async subscribe(subject: string, handler: (msg: Msg) => void) {
      handlers.set(subject, handler);
      return { unsubscribe: () => handlers.delete(subject) };
    },
  } as unknown as NATSClient;
  let listener: ((settings: { enabled: string[] }) => Promise<void> | void) | undefined;
  const selection = {
    settings: { enabled },
    onChange(fn: typeof listener) {
      listener = fn;
    },
  } as unknown as EventLogSelectionSource;
  const catalog = { events: new Map([["goal.reached", { subject: "goal.reached", moduleId: "goals" }]]) };
  const sent: CallbackEvent[] = [];
  const forwarder = new StreamEventForwarder(
    nats,
    {
      send: async (event: CallbackEvent) => {
        sent.push(event);
      },
    },
    logger,
    catalog as unknown as EventCatalog,
    selection
  );
  const deliver = (subject: string, event: Record<string, unknown>) =>
    handlers.get(subject)?.({ json: () => event } as unknown as Msg);
  const change = async (next: string[]) => listener?.({ enabled: next });
  return { forwarder, handlers, deliver, sent, change };
}

describe("StreamEventForwarder", () => {
  test("binds the enabled, always-recorded and widget types", async () => {
    const { forwarder, handlers } = setup(["goal.reached"]);
    await forwarder.start();
    const expected = new Set(["goal.reached", ...ALWAYS_RECORDED_EVENT_TYPES, ...LEGACY_STREAM_EVENT_TYPES]);
    expect(new Set(handlers.keys())).toEqual(expected);
  });

  test("forwards a bus event as one pushed callback carrying its frame", async () => {
    const { forwarder, deliver, sent } = setup(["goal.reached"]);
    await forwarder.start();
    deliver("goal.reached", { id: "e1", source: "goals", time: "2026-11-24T00:00:00Z", data: { amount: 5 } });
    await Promise.resolve();
    expect(sent).toEqual([
      {
        type: EngineEventType.STREAM_EVENT_PUSHED,
        frame: {
          id: "e1",
          type: "goal.reached",
          source: "goals",
          time: "2026-11-24T00:00:00Z",
          platform: "goals",
          data: { amount: 5 },
        },
      },
    ]);
  });

  test("stops forwarding a type once the selection drops it", async () => {
    const { forwarder, handlers, change } = setup(["goal.reached"]);
    await forwarder.start();
    await change([]);
    expect(handlers.has("goal.reached")).toBe(false);
    expect(handlers.has(LEGACY_STREAM_EVENT_TYPES[0] as string)).toBe(true);
  });
});
