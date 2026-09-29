import { describe, expect, mock, test } from "bun:test";
import type { HelixUser } from "@twurple/api";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { Context } from "src/types";
import { AdBreakAnnouncer, type AdBreakTimers } from "./onChannelAdBreakBegin";

interface Published {
  topic: string;
  type: string;
  platform: string;
  data: Record<string, unknown>;
}

function harness() {
  const published: Published[] = [];
  const ctx = {
    broadcaster: { id: "broadcaster-1" } as HelixUser,
    logger: { warn: mock(() => {}) } as unknown as Context["logger"],
    messageBus: {
      publish: mock((topic: string, bytes: Uint8Array) => {
        const event = JSON.parse(new TextDecoder().decode(bytes));
        published.push({ topic, type: event.type, platform: event.platform, data: event.data });
      }),
    } as unknown as Context["messageBus"],
    events: new EventFactory({ source: "twitch" }),
  } as Context;

  const scheduled: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const timers: AdBreakTimers = {
    setTimeout: (fn, ms) => {
      const entry = { fn, ms, cleared: false };
      scheduled.push(entry);
      return entry;
    },
    clearTimeout: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  return { announcer: new AdBreakAnnouncer(ctx, timers), published, scheduled };
}

const START = new Date("2026-09-28T18:00:00.000Z");

describe("AdBreakAnnouncer", () => {
  test("publishes channel.ad_break.begin with the break's timing", () => {
    const { announcer, published } = harness();

    announcer.begin({ durationSeconds: 90, isAutomatic: true, startDate: START });

    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({
      topic: "channel.ad_break.begin",
      type: "channel.ad_break.begin",
      platform: "twitch",
      data: {
        durationSeconds: 90,
        isAutomatic: true,
        startedAt: "2026-09-28T18:00:00.000Z",
        endsAt: "2026-09-28T18:01:30.000Z",
      },
    });
  });

  test("synthesizes channel.ad_break.end once the duration elapses", () => {
    const { announcer, published, scheduled } = harness();

    announcer.begin({ durationSeconds: 60, isAutomatic: false, startDate: START });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.ms).toBe(60_000);
    expect(published.map((p) => p.type)).toEqual(["channel.ad_break.begin"]);

    scheduled[0]?.fn();

    expect(published.map((p) => p.type)).toEqual(["channel.ad_break.begin", "channel.ad_break.end"]);
    expect(published[1]?.data).toEqual({
      durationSeconds: 60,
      isAutomatic: false,
      startedAt: "2026-09-28T18:00:00.000Z",
      endedAt: "2026-09-28T18:01:00.000Z",
    });
  });

  test("a new break publishes the previous break's pending end first", () => {
    const { announcer, published, scheduled } = harness();

    announcer.begin({ durationSeconds: 180, isAutomatic: true, startDate: START });
    announcer.begin({ durationSeconds: 30, isAutomatic: false, startDate: new Date(START.getTime() + 60_000) });

    expect(scheduled[0]?.cleared).toBe(true);
    expect(published.map((p) => p.type)).toEqual([
      "channel.ad_break.begin",
      "channel.ad_break.end",
      "channel.ad_break.begin",
    ]);
    expect(published[1]?.data.startedAt).toBe("2026-09-28T18:00:00.000Z");
  });

  test("coerces Twitch's raw values", () => {
    const { announcer, published } = harness();

    announcer.begin({ durationSeconds: "60", isAutomatic: "true", startDate: START });

    expect(published[0]?.data).toMatchObject({ durationSeconds: 60, isAutomatic: true });
  });

  test("an unreadable start time falls back to now", () => {
    const { announcer, published } = harness();
    const before = Date.now();

    announcer.begin({ durationSeconds: 30, isAutomatic: false, startDate: new Date("garbage") });

    const startedAt = Date.parse(String(published[0]?.data.startedAt));
    expect(startedAt).toBeGreaterThanOrEqual(before);
  });

  test("a redelivered begin for the pending break is ignored", () => {
    const { announcer, published, scheduled } = harness();

    announcer.begin({ durationSeconds: 90, isAutomatic: true, startDate: START });
    announcer.begin({ durationSeconds: 90, isAutomatic: true, startDate: new Date(START.getTime()) });

    expect(published.map((p) => p.type)).toEqual(["channel.ad_break.begin"]);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.cleared).toBe(false);
  });

  test("dispose drops the pending end without publishing it", () => {
    const { announcer, published, scheduled } = harness();

    announcer.begin({ durationSeconds: 90, isAutomatic: true, startDate: START });
    announcer.dispose();

    expect(scheduled[0]?.cleared).toBe(true);
    expect(published.map((p) => p.type)).toEqual(["channel.ad_break.begin"]);
  });
});
