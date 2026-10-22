import { describe, expect, test } from "bun:test";
import type { StreamEventFrame } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { EventCatalog, LoggedEvent } from "../src/event-catalog";
import { LEGACY_STREAM_EVENT_TYPES, StreamEventBroadcaster } from "../src/stream-event-broadcaster";

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
    new Map<string, LoggedEvent>(next.map((subject) => [subject, { subject, moduleId, onByDefault: false }]));
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

function collector() {
  const frames: StreamEventFrame[] = [];
  return {
    frames,
    subscriber: {
      onStreamEvent: async (frame: StreamEventFrame) => {
        frames.push(frame);
      },
    },
  };
}

function event(type: string, id = "evt-1") {
  return { id, type, source: "twitch", time: "2026-09-28T18:00:00.000Z", platform: "twitch", data: {} };
}

describe("StreamEventBroadcaster", () => {
  test("a subscriber that names no types gets the legacy set, ad breaks included", async () => {
    const { nats, handlers, deliver } = fakeBus();
    const { catalog } = fakeCatalog(["channel.follow", "goal.reached", ...AD_BREAKS]);
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();
    expect(handlers.size).toBe(0);

    const { frames, subscriber } = collector();
    await broadcaster.subscribe(subscriber, undefined, {});
    expect([...handlers.keys()].sort()).toEqual([...LEGACY_STREAM_EVENT_TYPES].sort());

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

  test("pushes each subscriber exactly the offered types it asked for", async () => {
    const { nats, handlers, deliver } = fakeBus();
    const { catalog } = fakeCatalog(["channel.follow", "goal.reached", ...AD_BREAKS]);
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();

    const widget = collector();
    const adBreaks = collector();
    await broadcaster.subscribe(widget.subscriber, ["goal.reached", "user.message", "not.installed"], {});
    await broadcaster.subscribe(adBreaks.subscriber, AD_BREAKS, {});
    expect([...handlers.keys()].sort()).toEqual(["goal.reached", ...AD_BREAKS].sort());

    deliver("goal.reached", event("goal.reached", "evt-1"));
    deliver("channel.ad_break.begin", event("channel.ad_break.begin", "evt-2"));
    await flush();

    expect(widget.frames.map((frame) => frame.id)).toEqual(["evt-1"]);
    expect(adBreaks.frames.map((frame) => frame.id)).toEqual(["evt-2"]);
  });

  test("a second call from one session replaces its first", async () => {
    const { nats, handlers, deliver } = fakeBus();
    const { catalog } = fakeCatalog(["channel.follow", "goal.reached"]);
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();
    const session = {};

    const first = collector();
    const second = collector();
    await broadcaster.subscribe(first.subscriber, ["channel.follow"], session);
    await broadcaster.subscribe(second.subscriber, ["goal.reached"], session);

    expect(broadcaster.subscriberCount).toBe(1);
    expect([...handlers.keys()]).toEqual(["goal.reached"]);
    deliver("goal.reached", event("goal.reached"));
    await flush();
    expect(first.frames).toEqual([]);
    expect(second.frames).toHaveLength(1);
  });

  test("a disconnected subscriber's types are unbound, and a replaced stub breaking changes nothing", async () => {
    const { nats, handlers } = fakeBus();
    const { catalog } = fakeCatalog(["channel.follow", "goal.reached"]);
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();
    const breakers: (() => void)[] = [];
    const stub = () => ({
      onStreamEvent: async () => {},
      onRpcBroken(callback: () => void) {
        breakers.push(callback);
      },
    });
    const session = {};

    await broadcaster.subscribe(stub(), ["channel.follow"], session);
    await broadcaster.subscribe(stub(), ["goal.reached"], session);
    await broadcaster.subscribe(stub(), ["goal.reached"], {});

    breakers[0]?.();
    await flush();
    expect(broadcaster.subscriberCount).toBe(2);

    breakers[1]?.();
    await flush();
    expect(broadcaster.subscriberCount).toBe(1);
    expect([...handlers.keys()]).toEqual(["goal.reached"]);

    breakers[2]?.();
    await flush();
    expect(broadcaster.subscriberCount).toBe(0);
    expect(handlers.size).toBe(0);
  });

  test("binds an asked-for type once a module offers it, and drops it when removed", async () => {
    const { nats, handlers } = fakeBus();
    const { catalog, change } = fakeCatalog([]);
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();
    await broadcaster.subscribe(collector().subscriber, ["goal.reached"], {});
    expect(handlers.size).toBe(0);

    await change(["goal.reached"]);
    expect([...handlers.keys()]).toEqual(["goal.reached"]);

    await change([]);
    expect(handlers.size).toBe(0);
  });

  test("gives a module event that names no platform its module's id, as the log records it", async () => {
    const { nats, deliver } = fakeBus();
    const { catalog } = fakeCatalog(["goal.reached"], "woofx3");
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();
    const { frames, subscriber } = collector();
    await broadcaster.subscribe(subscriber, ["goal.reached"], {});

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
  test("unsubscribe ends one session's registration and frees its subjects", async () => {
    const { nats, handlers, deliver } = fakeBus();
    const { catalog } = fakeCatalog(["channel.follow"]);
    const broadcaster = new StreamEventBroadcaster(nats, logger, catalog);
    await broadcaster.start();
    const revoked = collector();
    const session = {};
    await broadcaster.subscribe(revoked.subscriber, ["channel.follow"], session);

    broadcaster.unsubscribe(session);
    broadcaster.unsubscribe(session);
    await flush();
    deliver("channel.follow", event("channel.follow"));
    await flush();

    expect(revoked.frames).toEqual([]);
    expect(broadcaster.subscriberCount).toBe(0);
    expect(handlers.size).toBe(0);
  });
});
