import { describe, expect, test } from "bun:test";
import type { StreamEventFrame } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { EventCatalog, LoggedEvent } from "../src/event-catalog";
import { StreamEventBroadcaster } from "../src/stream-event-broadcaster";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as SharedLogger;

function fakeBus() {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    async subscribe(subject: string, handler: (msg: Msg) => void) {
      handlers.set(subject, handler);
      return {
        unsubscribe: () => {
          handlers.delete(subject);
        },
      };
    },
  } as unknown as NATSClient;
  const deliver = (subject: string, event: Record<string, unknown>) => {
    handlers.get(subject)?.({ json: () => event } as unknown as Msg);
  };
  return { nats, handlers, deliver };
}

/** A catalog whose set the test changes by hand. */
function fakeCatalog(subjects: string[], moduleId = "woofx3_twitch") {
  let listener: ((events: ReadonlyMap<string, LoggedEvent>) => Promise<void> | void) | undefined;
  const toMap = (next: string[]) =>
    new Map(next.map((subject) => [subject, { subject, moduleId }])) as ReadonlyMap<string, LoggedEvent>;
  const catalog = {
    events: toMap(subjects),
    onChange(fn: typeof listener) {
      listener = fn;
    },
  };
  const change = async (next: string[]) => {
    catalog.events = toMap(next);
    await listener?.(catalog.events);
  };
  return { catalog: catalog as unknown as EventCatalog, change };
}

const AD_BREAKS = ["channel.ad_break.upcoming", "channel.ad_break.begin", "channel.ad_break.end"];

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("StreamEventBroadcaster", () => {
  test("forwards the ad-break events to browser subscribers", async () => {
    const { nats, handlers, deliver } = fakeBus();
    const { catalog } = fakeCatalog(["channel.follow", ...AD_BREAKS]);
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
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
    await flush();

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

  test("binds the catalog's subjects once its triggers are registered, and drops removed ones", async () => {
    const { nats, handlers } = fakeBus();
    const { catalog, change } = fakeCatalog([]);
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();
    expect(handlers.size).toBe(0);

    await change(["channel.follow", ...AD_BREAKS]);
    expect([...handlers.keys()].sort()).toEqual(["channel.follow", ...AD_BREAKS].sort());

    await change(AD_BREAKS);
    expect(handlers.has("channel.follow")).toBe(false);
    expect(handlers.size).toBe(3);
  });

  test("gives a module event that names no platform its module's id, as the log records it", async () => {
    const { nats, deliver } = fakeBus();
    const { catalog } = fakeCatalog(["goal.reached"], "woofx3");
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();
    const frames: StreamEventFrame[] = [];
    broadcaster.subscribe({
      onStreamEvent: async (frame) => {
        frames.push(frame);
      },
    });

    deliver("goal.reached", {
      id: "evt-2",
      type: "goal.reached",
      source: "counter",
      time: "2026-09-28T18:00:00.000Z",
      data: {},
    });
    await flush();

    expect(frames[0]?.platform).toBe("woofx3");
  });
});
