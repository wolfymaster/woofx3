import { describe, expect, test } from "bun:test";
import type { StreamEventFrame } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { StreamEventBroadcaster } from "../src/stream-event-broadcaster";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as SharedLogger;

function fakeBus() {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    async subscribe(subject: string, handler: (msg: Msg) => void) {
      handlers.set(subject, handler);
    },
  } as unknown as NATSClient;
  const deliver = (subject: string, event: Record<string, unknown>) => {
    handlers.get(subject)?.({ json: () => event } as unknown as Msg);
  };
  return { nats, handlers, deliver };
}

describe("StreamEventBroadcaster", () => {
  test("forwards the ad-break events to browser subscribers", async () => {
    const { nats, handlers, deliver } = fakeBus();
    const broadcaster = new StreamEventBroadcaster(nats, logger);
    await broadcaster.start();

    for (const subject of ["channel.ad_break.upcoming", "channel.ad_break.begin", "channel.ad_break.end"]) {
      expect(handlers.has(subject)).toBe(true);
    }

    const frames: StreamEventFrame[] = [];
    broadcaster.subscribe({
      onStreamEvent: async (frame) => {
        frames.push(frame);
      },
    });

    deliver("channel.ad_break.upcoming", {
      id: "evt-1",
      type: "channel.ad_break.upcoming",
      source: "twitch",
      time: "2026-09-28T18:00:00.000Z",
      platform: "twitch",
      data: { nextAdAt: "2026-09-28T18:01:00.000Z", secondsUntil: 60, durationSeconds: 90 },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(frames).toEqual([
      {
        id: "evt-1",
        type: "channel.ad_break.upcoming",
        source: "twitch",
        time: "2026-09-28T18:00:00.000Z",
        platform: "twitch",
        data: { nextAdAt: "2026-09-28T18:01:00.000Z", secondsUntil: 60, durationSeconds: 90 },
      },
    ]);
  });
});
